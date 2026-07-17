import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  effectiveLearningEvents,
  foldLearningEvents,
  marumoriIntervalMs,
  migrateMarumoriState,
  parseJsonLinesResult,
  parseJsonResult,
  scheduleReview,
} from "../scripts/lib/learner-core.mjs";

const hour = 60 * 60 * 1000;
const day = 24 * hour;

const sourceState = (items) => ({
  generatedAt: "2026-07-07T15:23:33.236Z",
  sourceFile: "data/marumori/raw/account-test.json",
  sourceExportedAt: "2026-07-07T05:30:39.540Z",
  items,
});

const sourceItem = ({
  id = "Vocabulary/1",
  type = "vocabulary",
  level = 4,
  lastSeenAt = "2026-07-01T00:00:00.000Z",
} = {}) => ({
  id,
  marumoriKey: id.split("/")[1],
  type,
  item: type === "kanji" ? "日" : "日本",
  reading: "にほん",
  meanings: ["Japan"],
  currentForm: null,
  marumori: {
    level,
    status: 1,
    studyLists: ["list-1"],
    sources: ["studyList:list-1"],
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    lastSeenAt,
    actionCounts: { "level-up": 2 },
    lessonCount: 1,
    reviewCount: 2,
    failedReviewCount: 0,
    totalAttempts: 2,
    wrongAttempts: 0,
    accuracy: 1,
    leech: false,
  },
  localSrs: {
    intervalDays: 999,
    dueAt: "2099-01-01T00:00:00.000Z",
  },
  priority: 42,
});

test("maps MaruMori levels 1-9 to the published intervals", () =>
  assert.deepEqual(
    Array.from({ length: 9 }, (_, index) => marumoriIntervalMs(index + 1)),
    [0, 4 * hour, 8 * hour, day, 2 * day, 7 * day, 14 * day, 30 * day, 120 * day],
  ));

test("returns no interval for unusable MaruMori levels", () =>
  assert.deepEqual([marumoriIntervalMs(null), marumoriIntervalMs(0), marumoriIntervalMs(10)], [null, null, null]));

test("migration keeps only kanji and vocabulary while preserving MaruMori provenance", () => {
  const vocabulary = sourceItem();
  const kanji = sourceItem({ id: "Kanji/2", type: "kanji", level: 9 });
  const grammar = sourceItem({ id: "GrammarPoints/3", type: "grammar" });
  const result = migrateMarumoriState(sourceState([vocabulary, kanji, grammar]), [], "2026-07-15T00:00:00.000Z");

  assert.deepEqual(result.catalog.cards.map(({ id }) => id), ["Kanji/2", "Vocabulary/1"]);
  assert.deepEqual(result.catalog.cards.find(({ id }) => id === vocabulary.id)?.provenance.marumori, vocabulary.marumori);
  assert.notStrictEqual(result.catalog.cards.find(({ id }) => id === vocabulary.id)?.provenance.marumori, vocabulary.marumori);
  assert.equal(result.report.importedCards, 2);
  assert.equal(result.report.excludedGrammar, 1);
});

test("migration preserves explicit reading and meaning aliases", () => {
  const pain = {
    ...sourceItem({ id: "Kanji/3963273", type: "kanji" }),
    item: "痛",
    reading: "つう",
    readings: ["つう", "いた.む", "いた.い"],
    readingAliases: ["いた"],
    meanings: ["pain"],
    meaningAliases: ["ache", "hurt"],
  };
  const migrated = migrateMarumoriState(sourceState([pain]), [], "2026-07-15T00:00:00.000Z").catalog.cards[0];

  assert.deepEqual(migrated.readings, ["つう", "いた.む", "いた.い", "いた"]);
  assert.deepEqual(migrated.meaningAliases, ["ache", "hurt"]);
});

test("migration derives the baseline due date from last seen time and MaruMori level", () => {
  const result = migrateMarumoriState(sourceState([sourceItem({ level: 4 })]), [], "2026-07-15T00:00:00.000Z");
  const baseline = result.events[0];

  assert.equal(baseline.type, "marumori_baseline");
  assert.equal(baseline.reviewedAt, "2026-07-01T00:00:00.000Z");
  assert.equal(baseline.dueAt, "2026-07-02T00:00:00.000Z");
  assert.equal(baseline.scheduled, true);
});

test("migration leaves cards with missing MaruMori state unscheduled", () => {
  const missing = sourceItem({ level: null, lastSeenAt: null });
  const result = migrateMarumoriState(sourceState([missing]), [], "2026-07-15T00:00:00.000Z");
  const state = foldLearningEvents(result.catalog, result.events).cardsById[missing.id];

  assert.equal(result.report.unscheduledCards, 1);
  assert.deepEqual(state, {
    cardId: missing.id,
    status: "unscheduled",
    dueAt: null,
    lastReviewedAt: null,
    reviewCount: 0,
    lastRating: null,
    fsrs: null,
    fsrsLog: null,
  });
});

test("migration replays legacy reviews chronologically after the MaruMori baseline", () => {
  const item = sourceItem();
  const later = { reviewedAt: "2026-07-09T00:00:00.000Z", id: item.id, correct: true, nextDueAt: "2099-01-01T00:00:00.000Z" };
  const earlier = { reviewedAt: "2026-07-08T00:00:00.000Z", id: item.id, correct: false, answer: "wrong" };
  const result = migrateMarumoriState(sourceState([item]), [later, earlier], "2026-07-15T00:00:00.000Z");
  const reviewEvents = result.events.filter(({ type }) => type === "review_answered");
  const folded = foldLearningEvents(result.catalog, result.events).cardsById[item.id];

  assert.deepEqual(reviewEvents.map(({ occurredAt }) => occurredAt), [earlier.reviewedAt, later.reviewedAt]);
  assert.deepEqual(reviewEvents.map(({ correct }) => correct), [false, true]);
  assert.deepEqual(reviewEvents[0].provenance.legacy, earlier);
  assert.equal(folded.status, "fsrs");
  assert.equal(folded.lastReviewedAt, later.reviewedAt);
  assert.equal(folded.reviewCount, 2);
  assert.equal(folded.lastRating, "good");
  assert.notEqual(folded.dueAt, later.nextDueAt);
});

test("FSRS maps an incorrect answer to Again and a correct answer to Good", () => {
  const initial = {
    cardId: "Vocabulary/1",
    status: "marumori",
    dueAt: "2026-07-01T00:00:00.000Z",
    lastReviewedAt: "2026-06-30T00:00:00.000Z",
    reviewCount: 0,
    lastRating: null,
    fsrs: null,
    fsrsLog: null,
  };
  const again = scheduleReview(initial, false, "2026-07-08T00:00:00.000Z");
  const good = scheduleReview(again, true, "2026-07-08T00:10:00.000Z");

  assert.equal(again.lastRating, "again");
  assert.equal(good.lastRating, "good");
  assert.equal(good.reviewCount, 2);
  assert.equal(good.fsrsLog.rating > again.fsrsLog.rating, true);
  assert.equal(again.fsrs.state, 2);
  assert.equal(good.fsrs.state, 2);
  assert.equal(Date.parse(again.dueAt) - Date.parse("2026-07-08T00:00:00.000Z") >= day, true);
  assert.doesNotThrow(() => JSON.stringify(good));
});

test("first local review preserves a mature imported interval", () => {
  const item = sourceItem({ level: 9, lastSeenAt: "2026-03-01T00:00:00.000Z" });
  const migrated = migrateMarumoriState(sourceState([item]), [], "2026-07-15T00:00:00.000Z");
  const reviewed = foldLearningEvents(migrated.catalog, [
    ...migrated.events,
    {
      type: "review_answered",
      cardId: item.id,
      studyDate: "2026-07-15",
      occurredAt: "2026-07-15T00:00:00.000Z",
      correct: true,
    },
  ]).cardsById[item.id];

  assert.equal(reviewed.fsrs.state, 2);
  assert.equal(reviewed.fsrs.scheduled_days >= 120, true);
  assert.equal(reviewed.fsrs.stability >= 120, true);
});

test("event folding orders reviews chronologically rather than trusting input order", () => {
  const item = sourceItem();
  const migrated = migrateMarumoriState(sourceState([item]), [], "2026-07-15T00:00:00.000Z");
  const later = { type: "review_answered", cardId: item.id, occurredAt: "2026-07-10T00:00:00.000Z", correct: true };
  const earlier = { type: "review_answered", cardId: item.id, occurredAt: "2026-07-08T00:00:00.000Z", correct: false };
  const folded = foldLearningEvents(migrated.catalog, [...migrated.events, later, earlier]).cardsById[item.id];

  assert.equal(folded.lastReviewedAt, later.occurredAt);
  assert.equal(folded.lastRating, "good");
});

test("folding answer events is deterministic and does not mutate the catalog or events", () => {
  const catalog = migrateMarumoriState(sourceState([sourceItem()]), [], "2026-07-15T00:00:00.000Z").catalog;
  const events = [
    {
      type: "reactivation_answered",
      cardId: "Vocabulary/1",
      occurredAt: "2026-07-08T00:00:00.000Z",
      correct: true,
    },
    {
      type: "extra_review_answered",
      cardId: "Vocabulary/1",
      occurredAt: "2026-07-09T00:00:00.000Z",
      correct: false,
    },
  ];
  const before = JSON.stringify({ catalog, events });
  const first = foldLearningEvents(catalog, events);
  const second = foldLearningEvents(catalog, events);

  assert.deepEqual(first, second);
  assert.equal(first.cardsById["Vocabulary/1"].reviewCount, 2);
  assert.equal(first.cardsById["Vocabulary/1"].lastRating, "again");
  assert.equal(JSON.stringify({ catalog, events }), before);
});

test("voided answers are excluded from effective history and FSRS replay", () => {
  const item = sourceItem();
  const migrated = migrateMarumoriState(sourceState([item]), [], "2026-07-15T00:00:00.000Z");
  const accidental = {
    type: "review_answered",
    eventId: "answer-1",
    cardId: item.id,
    studyDate: "2026-07-15",
    occurredAt: "2026-07-15T01:00:00.000Z",
    correct: false,
  };
  const voided = {
    type: "review_answer_voided",
    targetEventId: accidental.eventId,
    cardId: item.id,
    studyDate: "2026-07-15",
    occurredAt: "2026-07-15T01:01:00.000Z",
  };
  const corrected = {
    ...accidental,
    eventId: "answer-2",
    occurredAt: "2026-07-15T01:02:00.000Z",
    correct: true,
  };
  const withRedo = [...migrated.events, accidental, voided, corrected];
  const expected = [...migrated.events, corrected];

  assert.deepEqual(effectiveLearningEvents(withRedo), expected);
  assert.deepEqual(foldLearningEvents(migrated.catalog, withRedo), foldLearningEvents(migrated.catalog, expected));
});

test("Result parsers report invalid JSON without throwing", (_, done) =>
  parseJsonResult('{"valid":true}', (valid) =>
    parseJsonResult("{", (invalid) =>
      parseJsonLinesResult('{"id":1}\n\n{"id":2}\n', (validLines) =>
        parseJsonLinesResult('{"id":1}\n{', (invalidLines) => {
          assert.equal(valid.ok, true);
          assert.deepEqual(invalid, { ok: false, error: "Invalid JSON" });
          assert.deepEqual(validLines, {
            ok: true,
            value: [{ id: 1 }, { id: 2 }],
          });
          assert.deepEqual(invalidLines, {
            ok: false,
            error: "Invalid JSON on line 2",
          });
          done();
        }),
      ),
    ),
  ));

test("migration CLI composes stdin to stdout unless output paths are explicit", () => {
  const state = sourceState([sourceItem()]);
  const stdoutRun = spawnSync(process.execPath, ["scripts/migrate-marumori.mjs"], {
    cwd: process.cwd(),
    input: JSON.stringify(state),
    encoding: "utf8",
  });
  const output = JSON.parse(stdoutRun.stdout);
  const directory = mkdtempSync(join(tmpdir(), "language-learning-migration-"));
  const catalogFile = join(directory, "catalog.json");
  const incompleteRun = spawnSync(
    process.execPath,
    ["scripts/migrate-marumori.mjs", "--state", "data/learner-state/items.json", "--catalog-out", catalogFile],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(stdoutRun.status, 0, stdoutRun.stderr);
  assert.equal(output.catalog.cards.length, 1);
  assert.equal(output.events.length, 1);
  assert.equal(incompleteRun.status, 2);
  assert.match(incompleteRun.stderr, /both --catalog-out and --events-out/u);
  assert.throws(() => readFileSync(catalogFile), /ENOENT/u);
  rmSync(directory, { recursive: true, force: true });
});
