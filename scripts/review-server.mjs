#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { text as readText } from "node:stream/consumers";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { parseJsonResult } from "./lib/learner-core.mjs";
import { defaultBypassMinutes } from "./lib/daily-session.mjs";
import {
  createBackup,
  importDelimitedCatalog,
  mergeCatalogImport,
  readLearnerState,
  restoreBackup,
  writeLearnerState,
} from "./lib/data-transfer.mjs";
import {
  loadDailyContext,
  loadExtraContext,
  recordAnswerAlias,
  recordBypass,
  recordExtraReview,
  recordRedo,
  recordReview,
  startDailyLesson,
  startExtraSession,
} from "./lib/runtime.mjs";
import { createReadingCheck } from "./lib/review-service.mjs";
import { normalizeLearnerSettings } from "./lib/settings-core.mjs";
import { deriveStats } from "./lib/stats-core.mjs";
import { normalizeExternalSpeechEndpoint } from "./lib/speech-endpoint.mjs";

const home = process.env.HOME ?? ".";
const dataHome = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
const defaultStateDir = join(dataHome, "leo-sensei-no-nonsense-nihongo");
const defaultPublicDir = fileURLToPath(new URL("../public/", import.meta.url));
const defaultDecksDir = fileURLToPath(new URL("../decks/", import.meta.url));
const defaultWanakanaFile = fileURLToPath(new URL("../node_modules/wanakana/esm/index.js", import.meta.url));

const contentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
});

const sendJson = (response, status, payload) => (
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }),
  response.end(JSON.stringify(payload))
);

const sendAudio = (response, contentType, body) => (
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": body.length,
    "Content-Type": contentType,
  }),
  response.end(body)
);

const sendFile = (response, path) =>
  readFile(path, (readError, body) =>
    readError
      ? sendJson(response, 404, { error: "NOT_FOUND" })
      : (response.writeHead(200, { "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream" }), response.end(body)));

const speechRequest = (input) => ({
  input,
  response_format: "wav",
  stream: false,
});

const speechCachePath = (cacheDir, endpoint, requestBody) => join(
  cacheDir,
  `${createHash("sha256").update(JSON.stringify({ endpoint, requestBody })).digest("hex")}.wav`,
);

const fetchSpeech = ({ endpoint, fetchImpl, requestBody }) => fetchImpl(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(requestBody),
})
  .then((upstream) => {
    const contentType = upstream.headers.get("content-type") ?? "";
    return upstream.ok && contentType.startsWith("audio/")
      ? upstream.arrayBuffer().then((body) => ({ ok: true, body: Buffer.from(body), contentType }))
      : { ok: false };
  })
  .catch(() => ({ ok: false }));

const loadSpeech = ({ cacheDir, endpoint, fetchImpl, requestBody }, callback) => endpoint === null
  ? callback({ ok: false })
  : ((cacheFile) => readFile(cacheFile, (cacheError, cachedBody) => cacheError
      ? fetchSpeech({ endpoint, fetchImpl, requestBody }).then((result) => result.ok
        ? mkdir(cacheDir, { recursive: true }, (directoryError) => directoryError
          ? callback(result)
          : writeFile(cacheFile, result.body, () => callback(result)))
        : callback(result))
      : callback({ ok: true, body: cachedBody, contentType: "audio/wav" })))(
      speechCachePath(cacheDir, endpoint, requestBody),
    );

const cardSpeechText = (card) => (Array.isArray(card?.readings) ? card.readings : [card?.reading])
  .flatMap((reading) => String(reading ?? "").split(";"))
  .map((reading) => reading.trim())
  .find(Boolean) ?? String(card?.item ?? "").trim();

// ponytail: review queues cap at 100 cards; replace this scan with an index if that ceiling changes materially.
const queuedSpeechTexts = (context) => context.queue
  .map(({ id }) => context.catalog.cards.find((card) => card.id === id))
  .map(cardSpeechText)
  .filter(Boolean);

const dueReviewCount = (context, now) => Object.values(context.cardStates.cardsById ?? {})
  .filter(({ cardId, dueAt, status }) => status === "fsrs"
    && Date.parse(dueAt ?? "") <= Date.parse(now)
    && ["kanji", "vocabulary"].includes((context.catalog.cards ?? []).find((card) => card.id === cardId)?.type))
  .length;

const availableReviewCount = (context, now) => {
  const states = context.cardStates.cardsById ?? {};
  return Math.min(500, (context.catalog.cards ?? [])
    .filter((card) => ["kanji", "vocabulary"].includes(card.type))
    .filter((card) => ((state) => state?.status === "fsrs" && Date.parse(state.dueAt ?? "") <= Date.parse(now)
      || state?.status === "marumori")(states[card.id]))
    .length);
};

const extraReviewsDoneCount = (context) => new Set(context.events
  .filter((event) => event.type === "extra_review_answered" && event.correct === true && event.studyDate === context.status.studyDate)
  .map((event) => event.cardId)).size;

const publicDaily = (context, mode, speechAvailable = false, now = new Date().toISOString(), bypassMinutes = defaultBypassMinutes) => ({
  studyDate: context.status.studyDate,
  complete: context.status.complete,
  accessAllowed: context.access.allowed,
  accessReason: context.access.reason,
  bypassUntil: context.access.expiresAt,
  bypassMinutes,
  makeupReviews: context.status.makeupReviews ?? 0,
  makeupTomorrow: context.status.makeupTomorrow ?? 0,
  failOpen: context.status.failOpen,
  error: context.status.error,
  mode: mode ?? context.settings?.gateMode ?? "off",
  speechAvailable,
  progress: context.status.progress,
  dueReviews: dueReviewCount(context, now),
  availableReviews: availableReviewCount(context, now),
  extraReviewsDone: extraReviewsDoneCount(context),
  todayLesson: ((lesson) => lesson
    ? {
        total: lesson.session.entries.length,
        completed: new Set(context.events
          .filter((event) => event.type === "extra_review_answered"
            && event.extraSessionId === lesson.extraSessionId
            && event.correct)
          .map(({ cardId }) => cardId)).size,
      }
    : { total: 0, completed: 0 })(context.events.find(
    (event) => event.type === "extra_session_started"
      && event.studyDate === context.status.studyDate
      && event.session?.lesson
      && event.session?.dailyPlan,
  )),
  queue: context.queue,
});

const publicExtra = (context, extra, mode, speechAvailable = false, now = new Date().toISOString(), bypassMinutes = defaultBypassMinutes) => ({
  ...publicDaily(context, mode, speechAvailable, now, bypassMinutes),
  complete: extra.queue.length === 0,
  dailyComplete: context.status.complete,
  accessAllowed: true,
  accessReason: "extra_review",
  extra: true,
  lesson: Boolean(extra.lesson),
  extraSessionId: extra.extraSessionId,
  progress: {
    scheduled: {
      required: extra.required,
      attempted: extra.reviewed,
      eventuallyCorrect: extra.reviewed,
      accuracy: extra.required === 0 ? 1 : extra.reviewed / extra.required,
    },
    reactivations: { required: 0, attempted: 0, eventuallyCorrect: 0, accuracy: 1 },
  },
  queue: extra.queue,
  lessonGroup: extra.lessonGroup,
  lessonCards: extra.lesson
    ? extra.lessonGroup.cardIds
      .map((id) => context.catalog.cards.find((card) => card.id === id))
      .filter(Boolean)
      .map((card) => ({
        id: card.id,
        type: card.type,
        item: card.item,
        readings: card.readings ?? [card.reading].filter(Boolean),
        meanings: card.meanings ?? [],
      }))
    : [],
});

const readJsonBody = (request, callback) =>
  readText(request)
    .then((body) => parseJsonResult(body || "{}", callback))
    .catch((bodyError) => callback({ ok: false, error: bodyError.message }));

const readJsonFile = (path, callback) => readFile(path, "utf8", (readError, source) => readError
  ? callback({ ok: false, error: readError.message })
  : parseJsonResult(source, callback));

const publicDeckManifest = (manifest) => ({
  version: manifest.version,
  disclaimer: manifest.disclaimer,
  source: manifest.source,
  decks: (manifest.decks ?? []).map((deck, index, decks) => ({
    ...deck,
    cumulativeCards: decks.slice(0, index + 1).reduce((total, candidate) => total + Number(candidate.cards ?? 0), 0),
    includedDeckIds: decks.slice(0, index + 1).map(({ id }) => id),
  })),
});

const safeDeckFile = (file) => typeof file === "string"
  && normalize(file) === file
  && !file.startsWith("..")
  && !file.includes("/")
  && !file.includes("\\");

const readDeckDocuments = (decksDir, decks, callback, documents = []) => decks.length === 0
  ? callback({ ok: true, value: documents })
  : safeDeckFile(decks[0].file)
    ? readJsonFile(join(decksDir, decks[0].file), (result) => result.ok
        ? readDeckDocuments(decksDir, decks.slice(1), callback, [...documents, result.value])
        : callback(result))
    : callback({ ok: false, error: "Deck manifest contains an unsafe file path." });

const targetDecks = (manifest, deckId) => ((index) => index < 0
  ? { ok: false, error: "Unknown bundled deck." }
  : { ok: true, value: manifest.decks.slice(0, index + 1) })(
  (manifest.decks ?? []).findIndex(({ id }) => id === deckId),
);

const installedDeckState = (state, deckEntries, documents, studyListDailyNew) => ((cards, deckIds) => ((settings) => settings.ok
  ? {
      ok: true,
      value: {
        ...state,
        settings: settings.value,
        catalog: {
          ...state.catalog,
          cards: [...new Map([
            ...(state.catalog.cards ?? []),
            ...cards,
          ].map((card) => [card.id, card])).values()],
          jlpt: {
            decks: [
              ...(state.catalog.jlpt?.decks ?? []).filter(({ id }) => !deckIds.has(id)),
              ...documents.map((deck) => ({
                id: deck.id,
                level: deck.level,
                type: deck.type,
                total: deck.cards.length,
                knownAtImport: 0,
              })),
            ],
          },
        },
      },
    }
  : { ok: false, error: "Bundled deck settings are invalid." })(normalizeLearnerSettings({
  ...state.settings,
  studyListDailyNew,
})))(documents.flatMap((deck) => deck.cards ?? []), new Set(deckEntries.map(({ id }) => id)));

const selectedStudyListDecks = (manifest, dailyLimits) => ((entries, unknown) => unknown
  ? { ok: false, error: `Unknown bundled deck: ${unknown}` }
  : { ok: true, value: entries.filter(({ id }) => Number(dailyLimits[id] ?? 0) > 0) })(
  manifest.decks ?? [],
  Object.keys(dailyLimits ?? {}).find((id) => !id.startsWith("custom:")
    && !(manifest.decks ?? []).some((deck) => deck.id === id)),
);

const deckProgress = (context, deck) => ((cards) => ((states) => ((started) => ({
  known: started,
  learning: started,
  unstarted: Math.max(0, Number(deck.cards ?? 0) - started),
  total: Number(deck.cards ?? cards.length),
}))(cards.filter((card) => states[card.id]?.status !== "unscheduled").length))(context.cardStates.cardsById ?? {}))(
  context.catalog.cards.filter((card) => card.provenance?.jlpt?.deckIds?.includes(deck.id)
    || card.provenance?.customListId === deck.id),
);

const publicStudyLists = (context, manifest, customLists = []) => ({
  lists: [...(manifest.decks ?? []), ...customLists.map((list) => ({
    id: list.id,
    title: list.label,
    cards: list.cardIds.length,
    custom: true,
  }))].map((deck) => ({
    id: deck.id,
    label: deck.title,
    custom: Boolean(deck.custom),
    dailyNew: Number(context.settings.studyListDailyNew?.[deck.id] ?? 0),
    progress: deckProgress(context, deck),
  })),
});

const routeKey = (request, url) => `${request.method ?? "GET"} ${url.pathname}`;
const mutationRoutes = new Set([
  "POST /api/alias",
  "POST /api/bypass",
  "POST /api/decks/select",
  "POST /api/extra",
  "POST /api/extra-review",
  "POST /api/import",
  "POST /api/lesson/today",
  "POST /api/restore",
  "POST /api/review",
  "POST /api/review/redo",
  "POST /api/study-lists",
  "PUT /api/settings",
]);

const mutationTokenMatches = (request, expected) => ((received) => (
  typeof received === "string"
  && Buffer.byteLength(received) === Buffer.byteLength(expected)
  && timingSafeEqual(Buffer.from(received), Buffer.from(expected))
))(request.headers["x-leo-sensei-mutation-token"]);

const apiHandler = ({
  catalogFile,
  customListsFile,
  decksDir,
  eventsFile,
  settingsFile,
  now,
  mode,
  bypassMinutes,
  mutationToken,
  speechCacheDir,
  ttsEndpoint,
  ttsFetch,
}) => (request, response, url) => {
  const files = { catalogFile, customListsFile, eventsFile, settingsFile };
  const dailyPayload = (context) => publicDaily(context, mode, ttsEndpoint !== null, now(), bypassMinutes);
  const extraPayload = (context, extra) => publicExtra(context, extra, mode, ttsEndpoint !== null, now(), bypassMinutes);
  const load = (callback) => loadDailyContext({ catalogFile, eventsFile, settingsFile, now: now() }, callback);
  const requestSpeech = (text, callback) => loadSpeech({
    cacheDir: speechCacheDir,
    endpoint: ttsEndpoint,
    fetchImpl: ttsFetch,
    requestBody: speechRequest(text),
  }, callback);
  const prewarmSpeechQueue = (context) => queuedSpeechTexts(context).reduce(
    (ready, text) => ready.then(() => new Promise((resolve) => requestSpeech(text, resolve))),
    Promise.resolve(),
  );
  const getDaily = () => load((result) =>
    result.ok
      ? (sendJson(response, 200, dailyPayload(result.value)), prewarmSpeechQueue(result.value))
      : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: result.error, failOpen: true }));
  const getSettings = () => load((result) => result.ok
    ? sendJson(response, 200, result.value.settings)
    : sendJson(response, 503, { error: "SETTINGS_UNAVAILABLE", message: result.error }));
  const getDecks = () => readJsonFile(join(decksDir, "manifest.json"), (manifestResult) => manifestResult.ok
    ? sendJson(response, 200, publicDeckManifest(manifestResult.value))
    : sendJson(response, 503, { error: "DECKS_UNAVAILABLE", message: manifestResult.error }));
  const getStudyLists = () => load((contextResult) => contextResult.ok
    ? readJsonFile(join(decksDir, "manifest.json"), (manifestResult) => manifestResult.ok
        ? readLearnerState({ files }, (stateResult) => stateResult.ok
            ? sendJson(response, 200, publicStudyLists(contextResult.value, manifestResult.value, stateResult.value.customLists))
            : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: stateResult.error.message }))
        : sendJson(response, 503, { error: "DECKS_UNAVAILABLE", message: manifestResult.error }))
    : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: contextResult.error }));
  const postStudyLists = () => readJsonBody(request, (bodyResult) => bodyResult.ok
    ? readJsonFile(join(decksDir, "manifest.json"), (manifestResult) => ((selection) => !manifestResult.ok
        ? sendJson(response, 503, { error: "DECKS_UNAVAILABLE", message: manifestResult.error })
        : !selection.ok
          ? sendJson(response, 400, { error: "INVALID_STUDY_LISTS", message: selection.error })
          : readDeckDocuments(decksDir, selection.value, (documentsResult) => documentsResult.ok
              ? readLearnerState({ files }, (stateResult) => stateResult.ok
                  ? ((installed) => installed.ok
                    ? writeLearnerState({ files, state: installed.value }, (writeResult) => writeResult.ok
                        ? sendJson(response, 200, {
                            installedCards: installed.value.catalog.cards.length - stateResult.value.catalog.cards.length,
                            settings: installed.value.settings,
                          })
                        : sendJson(response, 500, { error: "DECK_INSTALL_FAILED", message: writeResult.error.message }))
                    : sendJson(response, 400, { error: "INVALID_STUDY_LISTS", message: installed.error }))(
                    installedDeckState(stateResult.value, selection.value, documentsResult.value, bodyResult.value.dailyLimits),
                  )
                  : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: stateResult.error.message }))
              : sendJson(response, 503, { error: "DECKS_UNAVAILABLE", message: documentsResult.error })))
    (manifestResult.ok ? selectedStudyListDecks(manifestResult.value, bodyResult.value.dailyLimits ?? {}) : manifestResult))
    : sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error }));
  const postDeckSelection = () => readJsonBody(request, (bodyResult) => bodyResult.ok
    ? readJsonFile(join(decksDir, "manifest.json"), (manifestResult) => ((selection) => !manifestResult.ok
        ? sendJson(response, 503, { error: "DECKS_UNAVAILABLE", message: manifestResult.error })
        : !selection.ok
          ? sendJson(response, 400, { error: "INVALID_DECK", message: selection.error })
          : readDeckDocuments(decksDir, selection.value, (documentsResult) => documentsResult.ok
              ? readLearnerState({ files }, (stateResult) => stateResult.ok
                  ? ((installed) => installed.ok
                    ? writeLearnerState({ files, state: installed.value }, (writeResult) => writeResult.ok
                        ? sendJson(response, 200, {
                            deckId: bodyResult.value.deckId,
                            includedDeckIds: selection.value.map(({ id }) => id),
                            installedCards: installed.value.catalog.cards.length - stateResult.value.catalog.cards.length,
                          })
                        : sendJson(response, 500, { error: "DECK_INSTALL_FAILED", message: writeResult.error.message }))
                    : sendJson(response, 400, { error: "INVALID_DECK", message: installed.error }))(
                    installedDeckState(stateResult.value, selection.value, documentsResult.value, { [bodyResult.value.deckId]: 10 }),
                  )
                  : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: stateResult.error.message }))
              : sendJson(response, 503, { error: "DECKS_UNAVAILABLE", message: documentsResult.error })))
    (manifestResult.ok ? targetDecks(manifestResult.value, bodyResult.value.deckId) : manifestResult))
    : sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error }));
  const getLesson = () => load((loaded) => loaded.ok
    ? ((event) => event
        ? loadExtraContext({ context: loaded.value, extraSessionId: event.extraSessionId }, (lesson) => lesson.ok
            ? sendJson(response, 200, extraPayload(loaded.value, lesson.value))
            : sendJson(response, 404, { error: "LESSON_NOT_FOUND", message: lesson.error }))
        : sendJson(response, 404, { error: "LESSON_NOT_FOUND" }))(loaded.value.events.find(
        (event) => event.type === "extra_session_started"
          && event.studyDate === loaded.value.session.studyDate
          && event.session?.lesson
          && event.session?.dailyPlan,
      ))
    : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: loaded.error }));
  const postTodayLesson = () => load((loaded) => loaded.ok
    ? startDailyLesson(
        { context: loaded.value, eventsFile, now: now() },
        (lesson) => lesson.ok
          ? (sendJson(response, lesson.created ? 201 : 200, extraPayload(loaded.value, lesson.value)),
            prewarmSpeechQueue({ catalog: loaded.value.catalog, queue: lesson.value.queue }))
          : sendJson(response, 400, { error: "LESSON_UNAVAILABLE", message: lesson.error }),
      )
    : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: loaded.error }));
  const putSettings = () => readJsonBody(request, (bodyResult) => ((settingsResult) => !bodyResult.ok
    ? sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error })
    : !settingsResult.ok
      ? sendJson(response, 400, { error: settingsResult.error.code, details: settingsResult.error.issues })
      : readLearnerState({ files }, (stateResult) => stateResult.ok
          ? writeLearnerState(
              { files, state: { ...stateResult.value, settings: settingsResult.value } },
              (writeResult) => writeResult.ok
                ? sendJson(response, 200, settingsResult.value)
                : sendJson(response, 500, { error: "SETTINGS_WRITE_FAILED", message: writeResult.error.message }),
            )
          : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: stateResult.error.message })))
  (bodyResult.ok ? normalizeLearnerSettings(bodyResult.value) : bodyResult));
  const getBackup = () => readLearnerState({ files }, (stateResult) => stateResult.ok
    ? sendJson(response, 200, createBackup({ ...stateResult.value, exportedAt: now() }))
    : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: stateResult.error.message }));
  const postRestore = () => readJsonBody(request, (bodyResult) => bodyResult.ok
    ? restoreBackup({ backup: bodyResult.value, files, now: now() }, (restoreResult) => restoreResult.ok
        ? sendJson(response, 200, {
            restored: true,
            preRestoreBackupFile: restoreResult.value.preRestoreBackupFile,
          })
        : sendJson(response, 400, { error: restoreResult.error.code, message: restoreResult.error.message }))
    : sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error }));
  const postImport = () => readJsonBody(request, (bodyResult) => ((importResult) => !bodyResult.ok
    ? sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error })
    : !importResult.ok
      ? sendJson(response, 400, { error: importResult.error.code, message: importResult.error.message, details: importResult.error.details })
      : readLearnerState({ files }, (stateResult) => stateResult.ok
          ? ((merged) => writeLearnerState(
              { files, state: { ...stateResult.value, ...merged } },
              (writeResult) => writeResult.ok
                ? sendJson(response, 201, {
                    importedCards: importResult.value.cards.length,
                    customList: importResult.value.customList,
                  })
                : sendJson(response, 500, { error: "IMPORT_WRITE_FAILED", message: writeResult.error.message }),
            ))(mergeCatalogImport({
              catalog: stateResult.value.catalog,
              customLists: stateResult.value.customLists,
              imported: importResult.value,
            }))
          : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: stateResult.error.message })))
  (bodyResult.ok ? importDelimitedCatalog(bodyResult.value.table, { label: bodyResult.value.label }) : bodyResult));
  const getStats = () => load((result) => result.ok
    ? sendJson(response, 200, deriveStats({ ...result.value, now: now() }))
    : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: result.error }));
  const getSpeech = () => ((text) => text && [...text].length <= 100
    ? requestSpeech(text, (result) => result.ok && result.body.length > 0
        ? sendAudio(response, result.contentType, result.body)
        : sendJson(response, 502, { error: "SPEECH_UPSTREAM_FAILED" }))
    : sendJson(response, 400, { error: "INVALID_SPEECH_TEXT" }))(String(url.searchParams.get("text") ?? "").trim());
  const postReview = () => readJsonBody(request, (bodyResult) =>
    bodyResult.ok
      ? load((loaded) =>
          loaded.ok
            ? recordReview(
                { context: loaded.value, eventsFile, input: bodyResult.value, now: now() },
                (recorded) =>
                  recorded.ok
                    ? load((updated) =>
                        updated.ok
                          ? sendJson(response, 200, { ...recorded.value.feedback, daily: dailyPayload(updated.value) })
                          : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: updated.error, failOpen: true }))
                    : sendJson(response, 400, { error: "INVALID_REVIEW", message: recorded.error }),
              )
            : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: loaded.error, failOpen: true }))
      : sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error }));
  const postReadingCheck = () => readJsonBody(request, (bodyResult) =>
    bodyResult.ok
      ? load((loaded) => {
          const checked = loaded.ok
            ? createReadingCheck({ cards: loaded.value.catalog.cards, events: loaded.value.events, input: bodyResult.value })
            : loaded;
          return !loaded.ok
            ? sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: loaded.error, failOpen: true })
            : checked.ok
              ? sendJson(response, 200, { correct: checked.value.correct })
              : sendJson(response, 400, { error: "INVALID_READING", message: checked.error });
        })
      : sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error }));
  const postExtra = () => load((loaded) =>
    loaded.ok
      ? startExtraSession(
          { context: loaded.value, eventsFile, limit: 100, now: now() },
          (extra) => extra.ok
            ? ((view) => (
                sendJson(response, 201, view),
                prewarmSpeechQueue({ catalog: loaded.value.catalog, queue: view.queue })
              ))(extraPayload(loaded.value, extra.value))
            : sendJson(response, 500, { error: "EXTRA_SESSION_WRITE_FAILED", message: extra.error }),
        )
      : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: loaded.error, failOpen: true }));
  const postExtraReview = () => readJsonBody(request, (bodyResult) =>
    bodyResult.ok
      ? load((loaded) =>
          loaded.ok
            ? recordExtraReview(
                { context: loaded.value, eventsFile, input: bodyResult.value, now: now() },
                (recorded) =>
                  recorded.ok
                    ? load((updated) =>
                        updated.ok
                          ? loadExtraContext(
                              { context: updated.value, extraSessionId: bodyResult.value.extraSessionId },
                              (extra) => extra.ok
                                ? sendJson(response, 200, { ...recorded.value.feedback, daily: extraPayload(updated.value, extra.value) })
                                : sendJson(response, 400, { error: "INVALID_EXTRA_SESSION", message: extra.error }),
                            )
                          : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: updated.error, failOpen: true }))
                    : sendJson(response, 400, { error: "INVALID_EXTRA_REVIEW", message: recorded.error }),
              )
            : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: loaded.error, failOpen: true }))
      : sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error }));
  const postRedo = () => readJsonBody(request, (bodyResult) =>
    bodyResult.ok
      ? load((loaded) => loaded.ok
        ? recordRedo(
            { context: loaded.value, eventsFile, input: bodyResult.value, now: now() },
            (redone) => redone.ok
              ? load((updated) => updated.ok
                ? redone.value.target.type === "extra_review_answered"
                  ? loadExtraContext(
                      { context: updated.value, extraSessionId: redone.value.target.extraSessionId },
                      (extra) => extra.ok
                        ? sendJson(response, 200, {
                            redone: true,
                            cardId: redone.value.target.cardId,
                            daily: extraPayload(updated.value, extra.value),
                          })
                        : sendJson(response, 400, { error: "INVALID_EXTRA_SESSION", message: extra.error }),
                    )
                  : sendJson(response, 200, {
                      redone: true,
                      cardId: redone.value.target.cardId,
                      daily: dailyPayload(updated.value),
                    })
                : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: updated.error, failOpen: true }))
              : sendJson(response, redone.conflict ? 409 : 400, { error: "REDO_CONFLICT", message: redone.error }),
          )
        : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: loaded.error, failOpen: true }))
      : sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error }));
  const postBypass = () => readJsonBody(request, (bodyResult) =>
    bodyResult.ok
      ? load((loaded) =>
          loaded.ok
            ? (() => {
                const bypass = recordBypass(
                  { context: loaded.value, eventsFile, reason: bodyResult.value.reason, durationMinutes: bypassMinutes, now: now() },
                  (recorded) =>
                    recorded.ok
                      ? sendJson(response, recorded.value.alreadyRecorded ? 200 : 201, {
                          bypassUntil: recorded.value.event.expiresAt,
                          targetStudyDate: recorded.value.event.targetStudyDate,
                          carryoverCount: recorded.value.event.carryoverCount,
                          durationMinutes: recorded.value.event.durationMinutes ?? bypassMinutes,
                          alreadyRecorded: recorded.value.alreadyRecorded,
                        })
                      : sendJson(response, 500, { error: "BYPASS_WRITE_FAILED", message: recorded.error }),
                );
                return bypass.ok
                  ? bypass
                  : sendJson(response, 400, { error: "INVALID_BYPASS", message: bypass.error });
              })()
            : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: loaded.error, failOpen: true }))
      : sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error }));
  const postAlias = () => readJsonBody(request, (bodyResult) =>
    bodyResult.ok
      ? load((loaded) =>
          loaded.ok
            ? recordAnswerAlias(
                { context: loaded.value, eventsFile, input: bodyResult.value, now: now() },
                (recorded) => recorded.ok
                  ? sendJson(response, 201, { saved: true, alias: recorded.value.event })
                  : sendJson(response, 400, { error: "INVALID_ALIAS", message: recorded.error }),
              )
            : sendJson(response, 503, { error: "STATE_UNAVAILABLE", message: loaded.error, failOpen: true }))
      : sendJson(response, 400, { error: "INVALID_JSON", message: bodyResult.error }));
  const routes = {
    "GET /api/backup": getBackup,
    "GET /api/daily": getDaily,
    "GET /api/decks": getDecks,
    "GET /api/lesson": getLesson,
    "GET /api/settings": getSettings,
    "GET /api/speech": getSpeech,
    "GET /api/stats": getStats,
    "GET /api/status": getDaily,
    "GET /api/study-lists": getStudyLists,
    "POST /api/extra": postExtra,
    "POST /api/review": postReview,
    "POST /api/review/redo": postRedo,
    "POST /api/reading-check": postReadingCheck,
    "POST /api/extra-review": postExtraReview,
    "POST /api/bypass": postBypass,
    "POST /api/decks/select": postDeckSelection,
    "POST /api/import": postImport,
    "POST /api/lesson/today": postTodayLesson,
    "POST /api/restore": postRestore,
    "POST /api/study-lists": postStudyLists,
    "POST /api/alias": postAlias,
    "PUT /api/settings": putSettings,
  };
  return ((key) => mutationToken && mutationRoutes.has(key) && !mutationTokenMatches(request, mutationToken)
    ? sendJson(response, 403, { error: "MUTATION_FORBIDDEN" })
    : (routes[key] ?? (() => sendJson(response, 404, { error: "NOT_FOUND" })))())(routeKey(request, url));
};

const staticHandler = (publicDir, wanakanaFile) => (_request, response, url) => {
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const relative = normalize(requested);
  return relative.startsWith("..")
    ? sendJson(response, 404, { error: "NOT_FOUND" })
    : sendFile(response, url.pathname === "/vendor/wanakana.mjs" ? wanakanaFile : join(publicDir, relative));
};

const positiveMinutes = (value, fallback) => ((minutes) => Number.isFinite(minutes) && minutes > 0 ? minutes : fallback)(Number(value));

export const createReviewServer = ({
  catalogFile = process.env.LEARNER_CATALOG_FILE ?? join(defaultStateDir, "catalog.json"),
  eventsFile = process.env.LEARNER_EVENTS_FILE ?? join(defaultStateDir, "events.jsonl"),
  settingsFile = process.env.LEARNER_SETTINGS_FILE ?? join(defaultStateDir, "settings.json"),
  customListsFile = process.env.LEARNER_CUSTOM_LISTS_FILE ?? join(dirname(settingsFile), "custom-lists.json"),
  decksDir = process.env.LEARNER_DECKS_DIR ?? defaultDecksDir,
  publicDir = process.env.LEARNER_PUBLIC_DIR ?? defaultPublicDir,
  wanakanaFile = process.env.LEARNER_WANAKANA_FILE ?? defaultWanakanaFile,
  now = () => new Date().toISOString(),
  mode = process.env.LANGUAGE_GATE_MODE,
  bypassMinutes = positiveMinutes(process.env.LEARNER_BYPASS_MINUTES, defaultBypassMinutes),
  mutationToken = "",
  speechCacheDir = process.env.LEARNER_SPEECH_CACHE_DIR ?? join(defaultStateDir, "speech-cache"),
  ttsEndpoint = process.env.LEARNER_TTS_ENDPOINT,
  ttsFetch = globalThis.fetch,
} = {}) => {
  const handleApi = apiHandler({
    catalogFile,
    customListsFile,
    decksDir,
    eventsFile,
    settingsFile,
    now,
    mode,
    bypassMinutes,
    mutationToken,
    speechCacheDir,
    ttsEndpoint: normalizeExternalSpeechEndpoint(ttsEndpoint),
    ttsFetch,
  });
  const handleStatic = staticHandler(publicDir, wanakanaFile);
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    return url.pathname.startsWith("/api/")
      ? handleApi(request, response, url)
      : handleStatic(request, response, url);
  });
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

isMain
  ? createReviewServer().listen(
      Number.parseInt(process.env.PORT ?? "8787", 10),
      process.env.HOST ?? "127.0.0.1",
      () => console.log(`Japanese review: http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? "8787"}`),
    )
  : null;
