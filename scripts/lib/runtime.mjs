import { readFile } from "node:fs";
import { randomUUID } from "node:crypto";

import { createEmergencyUnlockEvent, gateAccess } from "./daily-session.mjs";
import { effectiveLearningEvents, foldLearningEvents, parseJsonResult } from "./learner-core.mjs";
import {
  buildDailyView,
  buildExtraView,
  createAnswerAliasEvent,
  createExtraSessionEvent,
  createExtraReviewEvent,
  createRedoEvent,
  createReviewEvent,
} from "./review-service.mjs";
import { appendJsonLine, readJsonLines } from "./storage.mjs";
import { defaultLearnerSettings, normalizeLearnerSettings } from "./settings-core.mjs";

const error = (message) => ({ ok: false, error: message });

const emptyCatalog = Object.freeze({ version: 1, cards: Object.freeze([]) });

const readCatalog = (path, callback) =>
  readFile(path, "utf8", (readError, text) =>
    readError?.code === "ENOENT"
      ? callback({ ok: true, value: structuredClone(emptyCatalog) })
      : readError
        ? callback(error(readError.message))
        : parseJsonResult(text, (result) => callback(
            result.ok && Array.isArray(result.value?.cards)
              ? result
              : error(result.ok ? "Catalog cards must be an array." : result.error),
          )));

const readSettings = (path, callback) => path
  ? readFile(path, "utf8", (readError, text) =>
      readError?.code === "ENOENT"
        ? callback({ ok: true, value: defaultLearnerSettings() })
        : readError
          ? callback(error(readError.message))
          : parseJsonResult(text, (result) => ((normalized) => callback(
              result.ok && normalized.ok
                ? normalized
                : error(result.ok ? normalized.error.issues.map(({ message }) => message).join(" ") : result.error),
            ))(result.ok ? normalizeLearnerSettings(result.value) : result)))
  : callback({ ok: true, value: defaultLearnerSettings() });

const dailyContext = ({ catalog, events, now, settings }) => {
  const effectiveEvents = effectiveLearningEvents(events);
  const folded = foldLearningEvents(catalog, effectiveEvents);
  const view = buildDailyView({
    cards: catalog.cards,
    cardStates: folded,
    events: effectiveEvents,
    now,
    requiredDailyCount: settings.requiredDailyCount,
  });
  return view.ok
    ? {
        ok: true,
        value: {
          catalog,
          settings,
          events: effectiveEvents,
          cardStates: folded,
          ...view.value,
          access: gateAccess(view.value.status),
        },
      }
    : error(view.error);
};

export const loadDailyContext = ({ catalogFile, eventsFile, settingsFile, now = new Date().toISOString() }, callback) =>
  readCatalog(catalogFile, (catalogResult) =>
    catalogResult.ok
      ? readSettings(settingsFile, (settingsResult) => settingsResult.ok
          ? readJsonLines(eventsFile, (eventsResult) =>
              callback(
                eventsResult.ok
                  ? dailyContext({ catalog: catalogResult.value, events: eventsResult.value, now, settings: settingsResult.value })
                  : error(eventsResult.error.message),
              ))
          : callback(settingsResult))
      : callback(catalogResult));

const extraSessionFor = (events, extraSessionId) => [...events]
  .filter((event) => event.type === "extra_session_started" && event.extraSessionId === extraSessionId)
  .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
  .map((event) => event.session)
  .find((session) => session) ?? null;

export const loadExtraContext = ({ context, extraSessionId }, callback) => {
  const extraSession = extraSessionFor(context.events, extraSessionId);
  return callback(extraSession
    ? {
        ok: true,
        value: buildExtraView({
          cards: context.catalog.cards,
          extraSession,
          events: context.events,
        }),
      }
    : error("Extra-review batch is missing or invalid."));
};

export const startExtraSession = ({ context, eventsFile, limit = 100, now = new Date().toISOString() }, callback) => {
  const event = createExtraSessionEvent({
    cards: context.catalog.cards,
    cardStates: context.cardStates,
    session: context.session,
    now,
    limit,
  });
  return appendJsonLine(eventsFile, event, (appendResult) => callback(
    appendResult.ok
      ? {
          ok: true,
          value: buildExtraView({
            cards: context.catalog.cards,
            extraSession: event.session,
            events: [...context.events, event],
          }),
        }
      : error(appendResult.error.message),
  ));
};

const dailyLessonEvent = ({ cards, studyDate, now }) => ((occurredAt) => ((extraSessionId) => ((entries) => ({
  type: "extra_session_started",
  studyDate,
  occurredAt,
  extraSessionId,
  session: {
    sessionVersion: 1,
    extraSessionId,
    lesson: true,
    dailyPlan: true,
    studyDate,
    startedAt: occurredAt,
    entries,
    presentationOrder: entries.map(({ cardId }) => cardId),
  },
}))(cards.map(({ id, type }) => ({ cardId: id, type, source: "extra", promptDirection: "recognition" }))))(
  `lesson:${studyDate}:${occurredAt}`
))(new Date(now).toISOString());

const cardDeckIds = (card) => [
  ...(Array.isArray(card?.provenance?.jlpt?.deckIds) ? card.provenance.jlpt.deckIds : []),
  ...(card?.provenance?.customListId ? [card.provenance.customListId] : []),
];

const genuinelyNew = (context, card) => context.cardStates.cardsById?.[card.id]?.status === "unscheduled"
  && card?.provenance?.jlpt?.baselineKnown !== true;

const dailyLessonCards = (context) => Object.entries(context.settings.studyListDailyNew ?? {}).reduce(
  ({ cards, selectedIds }, [deckId, dailyNew]) => ((selected) => ({
    cards: [...cards, ...selected],
    selectedIds: new Set([...selectedIds, ...selected.map(({ id }) => id)]),
  }))(context.catalog.cards
    .filter((card) => !selectedIds.has(card.id)
      && cardDeckIds(card).includes(deckId)
      && genuinelyNew(context, card))
    .slice(0, dailyNew)),
  { cards: [], selectedIds: new Set() },
).cards;

const existingDailyLesson = (context) => context.events.find(
  (event) => event.type === "extra_session_started"
    && event.studyDate === context.session.studyDate
    && event.session?.lesson
    && event.session?.dailyPlan,
);

const lessonView = (context, session, events) => buildExtraView({
  cards: context.catalog.cards,
  extraSession: session,
  events,
});

export const startDailyLesson = ({ context, eventsFile, now = new Date().toISOString() }, callback) =>
  ((existing) => existing
    ? callback({ ok: true, created: false, value: lessonView(context, existing.session, context.events) })
    : ((cards) => cards.length === 0
        ? callback(error("No genuinely new cards remain in the enabled study lists."))
        : ((event) => appendJsonLine(eventsFile, event, (appendResult) => callback(
            appendResult.ok
              ? { ok: true, created: true, value: lessonView(context, event.session, [...context.events, event]) }
              : error(appendResult.error.message),
          )))(dailyLessonEvent({ cards, studyDate: context.session.studyDate, now })))(dailyLessonCards(context)))(
    existingDailyLesson(context),
  );

const hasFrozenSession = (context) => context.events.some(
  (event) => event.type === "session_started" && event.studyDate === context.session.studyDate,
);

const appendReview = ({ context, eventsFile, review, callback }) =>
  appendJsonLine(eventsFile, review.event, (appendResult) =>
    callback(
      appendResult.ok
        ? { ok: true, value: review }
        : error(appendResult.error.message),
    ));

export const recordReview = ({ context, eventsFile, input, now = new Date().toISOString() }, callback) => {
  const reviewResult = createReviewEvent({
    cards: context.catalog.cards,
    session: context.session,
    events: context.events,
    eventId: randomUUID(),
    input,
    now,
  });
  const append = () => appendReview({ context, eventsFile, review: reviewResult.value, callback });
  return !reviewResult.ok
    ? callback(reviewResult)
    : hasFrozenSession(context)
      ? append()
      : appendJsonLine(
          eventsFile,
          {
            type: "session_started",
            studyDate: context.session.studyDate,
            occurredAt: context.session.startedAt,
            session: context.session,
          },
          (sessionResult) =>
            sessionResult.ok
              ? append()
              : callback(error(sessionResult.error.message)),
        );
};

export const recordBypass = ({ context, eventsFile, reason, now = new Date().toISOString() }, callback) => {
  const bypass = createEmergencyUnlockEvent({
    reason,
    requiredDailyCount: context.settings.requiredDailyCount,
    now,
  });
  const existing = bypass.ok
    ? context.events.find((event) => event.type === "emergency_unlock_granted"
      && event.studyDate === bypass.event.studyDate)
    : null;
  return bypass.ok
    ? existing
      ? (callback({ ok: true, value: { event: existing, alreadyRecorded: true } }), bypass)
      : (appendJsonLine(eventsFile, bypass.event, (appendResult) =>
          callback(
            appendResult.ok
              ? { ok: true, value: { event: bypass.event, alreadyRecorded: false } }
              : error(appendResult.error.message),
          )), bypass)
    : bypass;
};

export const recordExtraReview = ({ context, eventsFile, input, now = new Date().toISOString() }, callback) => {
  const extraSession = extraSessionFor(context.events, input?.extraSessionId);
  const review = createExtraReviewEvent({
    cards: context.catalog.cards,
    events: context.events,
    eventId: randomUUID(),
    extraSession,
    input,
    studyDate: extraSession?.studyDate,
    now,
  });
  return extraSession && review.ok
    ? appendReview({ context, eventsFile, review: review.value, callback })
    : callback(extraSession ? review : error("Extra-review batch is missing or invalid."));
};

export const recordRedo = ({ context, eventsFile, input, now = new Date().toISOString() }, callback) =>
  ((redo) => redo.ok
    ? appendJsonLine(eventsFile, redo.value.event, (appendResult) => callback(
        appendResult.ok ? redo : error(appendResult.error.message),
      ))
    : callback(redo))(createRedoEvent({
      events: context.events,
      input,
      studyDate: context.session.studyDate,
      now,
    }));

export const recordAnswerAlias = ({ context, eventsFile, input, now = new Date().toISOString() }, callback) => {
  const alias = createAnswerAliasEvent({
    cards: context.catalog.cards,
    input,
    studyDate: context.session.studyDate,
    now,
  });
  return alias.ok
    ? appendJsonLine(eventsFile, alias.value.event, (appendResult) => callback(
        appendResult.ok
          ? alias
          : error(appendResult.error.message),
      ))
    : callback(alias);
};
