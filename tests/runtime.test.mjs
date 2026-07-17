import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
} from "../scripts/lib/runtime.mjs";

const card = (id, type, item, reading, meaning) => ({ id, type, item, reading, meanings: [meaning], provenance: { marumori: { level: 4 } } });

const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "language-runtime-"));
  const catalogFile = join(directory, "catalog.json");
  const eventsFile = join(directory, "events.jsonl");
  const catalog = {
    version: 1,
    cards: [card("k-1", "kanji", "招", "まねく", "beckon"), card("v-1", "vocabulary", "応募", "おうぼ", "application")],
  };
  const events = catalog.cards.map(({ id }) => ({
    type: "marumori_baseline",
    cardId: id,
    occurredAt: "2026-07-01T00:00:00.000Z",
    reviewedAt: "2026-07-01T00:00:00.000Z",
    dueAt: "2026-07-02T00:00:00.000Z",
    scheduled: true,
  }));
  writeFileSync(catalogFile, `${JSON.stringify(catalog)}\n`);
  writeFileSync(eventsFile, `${events.map(JSON.stringify).join("\n")}\n`);
  return { directory, catalogFile, eventsFile, baselineCount: events.length };
};

test("loadDailyContext derives one status and queue from catalog plus events", (_, done) => {
  const files = fixture();
  loadDailyContext({ ...files, now: "2026-07-15T01:00:00.000Z" }, (result) => {
    assert.equal(result.ok, true);
    assert.equal(result.value.status.complete, false);
    assert.equal(result.value.access.allowed, false);
    assert.deepEqual(result.value.queue.map(({ id }) => id), ["k-1", "v-1"]);
    rmSync(files.directory, { recursive: true, force: true });
    done();
  });
});

test("loadDailyContext returns safe empty defaults on first run", (_, done) => {
  const directory = mkdtempSync(join(tmpdir(), "language-first-run-"));
  loadDailyContext({
    catalogFile: join(directory, "catalog.json"),
    eventsFile: join(directory, "events.jsonl"),
    settingsFile: join(directory, "settings.json"),
    now: "2026-07-15T01:00:00.000Z",
  }, (result) => {
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.catalog, { version: 1, cards: [] });
    assert.equal(result.value.settings.onboardingComplete, false);
    assert.equal(result.value.status.complete, true);
    assert.deepEqual(result.value.queue, []);
    rmSync(directory, { recursive: true, force: true });
    done();
  });
});

test("recordReview freezes the session before appending its answer", (_, done) => {
  const files = fixture();
  loadDailyContext({ ...files, now: "2026-07-15T01:00:00.000Z" }, (loaded) =>
    recordReview(
      {
        context: loaded.value,
        eventsFile: files.eventsFile,
        input: { cardId: "k-1", readingAnswer: "まねく", meaningAnswer: "beckon" },
        now: "2026-07-15T01:01:00.000Z",
      },
      (recorded) => {
        const appended = readFileSync(files.eventsFile, "utf8").trim().split("\n").map(JSON.parse);
        assert.equal(recorded.ok, true);
        assert.match(recorded.value.event.eventId, /^[0-9a-f-]{36}$/u);
        assert.deepEqual(appended.slice(files.baselineCount).map(({ type }) => type), ["session_started", "review_answered"]);
        rmSync(files.directory, { recursive: true, force: true });
        done();
      },
    ));
});

test("recordRedo appends a void marker and restores the answered card to the queue", (_, done) => {
  const files = fixture();
  const firstNow = "2026-07-15T01:00:00.000Z";
  loadDailyContext({ ...files, now: firstNow }, (loaded) =>
    recordReview(
      {
        context: loaded.value,
        eventsFile: files.eventsFile,
        input: { cardId: "k-1", readingAnswer: "まねく", meaningAnswer: "beckon" },
        now: "2026-07-15T01:01:00.000Z",
      },
      (recorded) =>
        loadDailyContext({ ...files, now: "2026-07-15T01:02:00.000Z" }, (afterAnswer) =>
          recordRedo(
            {
              context: afterAnswer.value,
              eventsFile: files.eventsFile,
              input: { answerEventId: recorded.value.event.eventId },
              now: "2026-07-15T01:03:00.000Z",
            },
            (redone) =>
              loadDailyContext({ ...files, now: "2026-07-15T01:04:00.000Z" }, (afterRedo) => {
                const appended = readFileSync(files.eventsFile, "utf8").trim().split("\n").map(JSON.parse);
                assert.equal(redone.ok, true);
                assert.equal(redone.value.target.cardId, "k-1");
                assert.equal(appended.at(-1).type, "review_answer_voided");
                assert.equal(appended.at(-1).targetEventId, recorded.value.event.eventId);
                assert.equal(afterRedo.value.queue.some(({ id }) => id === "k-1"), true);
                assert.equal(afterRedo.value.cardStates.cardsById["k-1"].reviewCount, 0);
                rmSync(files.directory, { recursive: true, force: true });
                done();
              }),
          )),
    ));
});

test("recordBypass persists one emergency unlock per source day", (_, done) => {
  const files = fixture();
  loadDailyContext({ ...files, now: "2026-07-15T01:00:00.000Z" }, (loaded) => {
    const invalid = recordBypass({ context: loaded.value, eventsFile: files.eventsFile, reason: " ", now: "2026-07-15T01:00:00.000Z" }, () => null);
    assert.deepEqual(invalid, { ok: false, error: "Bypass reason is required." });
    recordBypass(
      { context: loaded.value, eventsFile: files.eventsFile, reason: "Client call", now: "2026-07-15T01:00:00.000Z" },
      (recorded) => {
        assert.equal(recorded.ok, true);
        assert.equal(recorded.value.event.type, "emergency_unlock_granted");
        assert.equal(recorded.value.event.targetStudyDate, "2026-07-16");
        assert.equal(recorded.value.event.carryoverCount, 50);
        assert.equal(recorded.value.event.expiresAt, "2026-07-15T01:30:00.000Z");
        loadDailyContext({ ...files, now: "2026-07-15T01:01:00.000Z" }, (reloaded) =>
          recordBypass(
            { context: reloaded.value, eventsFile: files.eventsFile, reason: "Second request", now: "2026-07-15T01:01:00.000Z" },
            (repeated) => {
              const appended = readFileSync(files.eventsFile, "utf8").trim().split("\n").map(JSON.parse);
              const unlocks = appended.filter(({ type }) => type === "emergency_unlock_granted");
              assert.equal(repeated.ok, true);
              assert.equal(repeated.value.alreadyRecorded, true);
              assert.equal(repeated.value.event.reason, "Client call");
              assert.equal(unlocks.length, 1);
              rmSync(files.directory, { recursive: true, force: true });
              done();
            },
          ));
      },
    );
  });
});

test("extra review context and events remain outside daily completion", (_, done) => {
  const files = fixture();
  const catalog = JSON.parse(readFileSync(files.catalogFile, "utf8"));
  const extra = card("v-extra", "vocabulary", "支える", "ささえる", "support");
  writeFileSync(files.catalogFile, JSON.stringify({ ...catalog, cards: [...catalog.cards, extra] }));
  writeFileSync(files.eventsFile, `${readFileSync(files.eventsFile, "utf8")}${JSON.stringify({
    type: "marumori_baseline",
    cardId: extra.id,
    occurredAt: "2026-07-01T00:00:00.000Z",
    reviewedAt: "2026-07-01T00:00:00.000Z",
    dueAt: "2026-07-02T00:00:00.000Z",
    scheduled: true,
  })}\n`);
  loadDailyContext({ ...files, now: "2026-07-15T01:00:00.000Z" }, (daily) => {
    const context = {
      ...daily.value,
      session: {
        ...daily.value.session,
        scheduled: daily.value.session.scheduled.filter(({ cardId }) => cardId !== extra.id),
        reactivations: daily.value.session.reactivations.filter(({ cardId }) => cardId !== extra.id),
      },
    };
    startExtraSession({ context, eventsFile: files.eventsFile, limit: 40, now: "2026-07-15T01:00:00.000Z" }, (started) =>
      loadDailyContext({ ...files, now: "2026-07-15T01:01:00.000Z" }, (updated) =>
        loadExtraContext({ context: updated.value, extraSessionId: started.value.extraSessionId }, (loaded) => {
          assert.equal(loaded.ok, true);
          assert.deepEqual(loaded.value.queue.map(({ id }) => id), [extra.id]);
          recordExtraReview(
            {
              context: updated.value,
              eventsFile: files.eventsFile,
              input: {
                extraSessionId: started.value.extraSessionId,
                cardId: extra.id,
                readingAnswer: extra.reading,
                meaningAnswer: "support",
              },
              now: "2026-07-15T01:05:00.000Z",
            },
            (recorded) => {
              assert.equal(recorded.value.event.type, "extra_review_answered");
              assert.equal(recorded.value.event.extraSessionId, started.value.extraSessionId);
              loadDailyContext({ ...files, now: "2026-07-15T01:06:00.000Z" }, (afterAnswer) =>
                recordRedo(
                  {
                    context: afterAnswer.value,
                    eventsFile: files.eventsFile,
                    input: { answerEventId: recorded.value.event.eventId },
                    now: "2026-07-15T01:07:00.000Z",
                  },
                  (redone) =>
                    loadDailyContext({ ...files, now: "2026-07-15T01:08:00.000Z" }, (afterRedo) =>
                      loadExtraContext({ context: afterRedo.value, extraSessionId: started.value.extraSessionId }, (retried) => {
                        assert.equal(redone.ok, true);
                        assert.deepEqual(retried.value.queue.map(({ id }) => id), [extra.id]);
                        rmSync(files.directory, { recursive: true, force: true });
                        done();
                      })),
                ));
            },
          );
        })));
  });
});

test("recordAnswerAlias appends a personal accepted answer", (_, done) => {
  const files = fixture();
  const now = "2026-07-15T01:00:00.000Z";
  loadDailyContext({ ...files, now }, (loaded) =>
    recordAnswerAlias(
      {
        context: loaded.value,
        eventsFile: files.eventsFile,
        input: { cardId: "k-1", kind: "reading", value: "しょう" },
        now,
      },
      (recorded) => {
        const events = readFileSync(files.eventsFile, "utf8").trim().split("\n").map(JSON.parse);
        assert.equal(recorded.ok, true);
        assert.equal(events.at(-1).type, "reading_alias_added");
        assert.equal(events.at(-1).value, "しょう");
        rmSync(files.directory, { recursive: true, force: true });
        done();
      },
    ));
});

test("startDailyLesson combines per-list quotas, excludes known cards, and resumes today's frozen lesson", (_, done) => {
  const directory = mkdtempSync(join(tmpdir(), "language-lesson-"));
  const files = {
    directory,
    catalogFile: join(directory, "catalog.json"),
    eventsFile: join(directory, "events.jsonl"),
    settingsFile: join(directory, "settings.json"),
  };
  const lessonCard = (id, deckId, baselineKnown = false) => ({
    id,
    type: "vocabulary",
    item: id,
    reading: id,
    meanings: [id],
    provenance: { jlpt: { deckIds: [deckId], baselineKnown } },
  });
  const catalog = { version: 1, cards: [
    lessonCard("a-known", "list-a"),
    lessonCard("a-one", "list-a"),
    lessonCard("a-two", "list-a"),
    lessonCard("a-three", "list-a"),
    lessonCard("b-known-at-import", "list-b", true),
    lessonCard("b-one", "list-b"),
    { ...lessonCard("custom-one", "unused"), provenance: { customListId: "custom-list" } },
  ] };
  const knownEvent = {
    type: "review_answered",
    studyDate: "2026-07-14",
    occurredAt: "2026-07-14T01:00:00.000Z",
    cardId: "a-known",
    correct: true,
  };
  writeFileSync(files.catalogFile, JSON.stringify(catalog));
  writeFileSync(files.eventsFile, `${JSON.stringify(knownEvent)}\n`);
  writeFileSync(files.settingsFile, JSON.stringify({
    version: 2,
    requiredDailyCount: 100,
    studyListDailyNew: { "list-a": 2, "list-b": 1, "custom-list": 1 },
    gateMode: "off",
    gatedApplications: [],
    onboardingComplete: true,
  }));

  loadDailyContext({ ...files, now: "2026-07-15T01:00:00.000Z" }, (loaded) =>
    startDailyLesson({ context: loaded.value, eventsFile: files.eventsFile, now: "2026-07-15T01:00:00.000Z" }, (started) =>
      loadDailyContext({ ...files, now: "2026-07-15T02:00:00.000Z" }, (reloaded) =>
        startDailyLesson({ context: reloaded.value, eventsFile: files.eventsFile, now: "2026-07-15T02:00:00.000Z" }, (resumed) => {
          assert.equal(started.ok, true);
          assert.equal(started.created, true);
          assert.deepEqual(started.value.presentationOrder, ["a-one", "a-two", "b-one", "custom-one"]);
          assert.equal(resumed.created, false);
          assert.deepEqual(resumed.value.presentationOrder, started.value.presentationOrder);
          rmSync(directory, { recursive: true, force: true });
          done();
        }))));
});
