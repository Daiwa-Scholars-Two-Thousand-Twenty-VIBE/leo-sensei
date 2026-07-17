import assert from "node:assert/strict";
import test from "node:test";

import { deriveStats } from "../scripts/lib/stats-core.mjs";

const cards = [
  { id: "k-1", type: "kanji", item: "日" },
  { id: "v-1", type: "vocabulary", item: "日本" },
];

const cardStates = {
  cardsById: {
    "k-1": { cardId: "k-1", status: "fsrs", reviewCount: 2, lastReviewedAt: "2026-02-16T00:00:00.000Z", dueAt: "2026-07-16T00:00:00.000Z" },
    "v-1": { cardId: "v-1", status: "fsrs", reviewCount: 1, lastReviewedAt: "2026-07-15T00:00:00.000Z", dueAt: "2026-07-16T00:00:00.000Z" },
  },
};

test("deriveStats projects effective activity, current levels, and required-queue streaks", () => {
  const session = { sessionVersion: 2, studyDate: "2026-07-15", scheduled: [{ cardId: "k-1", type: "kanji" }], reactivations: [] };
  const stats = deriveStats({
    catalog: { cards },
    cardStates,
    now: "2026-07-16T12:00:00.000Z",
    timeZone: "Asia/Tokyo",
    events: [
      { type: "session_started", studyDate: "2026-07-15", occurredAt: "2026-07-15T00:00:00.000Z", session },
      { type: "review_answered", eventId: "correct", studyDate: "2026-07-15", occurredAt: "2026-07-15T00:30:00.000Z", cardId: "k-1", correct: true },
      { type: "extra_review_answered", eventId: "voided", studyDate: "2026-07-15", occurredAt: "2026-07-15T01:00:00.000Z", cardId: "v-1", correct: false },
      { type: "review_answer_voided", targetEventId: "voided", occurredAt: "2026-07-15T01:01:00.000Z" },
      { type: "extra_review_answered", eventId: "today", studyDate: "2026-07-16", occurredAt: "2026-07-16T02:00:00.000Z", cardId: "v-1", correct: true },
    ],
  });

  assert.equal(stats.streak, 1);
  assert.deepEqual(stats.activity.days.slice(-2), [
    { studyDate: "2026-07-15", attempts: 1, correct: 1, cards: 1, kanji: 1, vocabulary: 0, complete: true },
    { studyDate: "2026-07-16", attempts: 1, correct: 1, cards: 1, kanji: 0, vocabulary: 1, complete: false },
  ]);
  assert.equal(stats.progress.kanji.expert, 1);
  assert.deepEqual(stats.accuracy.sevenDays, { attempts: 2, correct: 2, rate: 1 });
});

test("deriveStats retains approximate JLPT deck totals while measuring local progress", () => {
  const stats = deriveStats({
    catalog: {
      cards: [{ id: "v-new", type: "vocabulary", provenance: { jlpt: { deckIds: ["n2-vocabulary"], baselineKnown: false } } }],
      jlpt: { decks: [{ id: "n2-vocabulary", level: "N2", type: "vocabulary", total: 1799, knownAtImport: 519 }] },
    },
    cardStates: { cardsById: { "v-new": { cardId: "v-new", reviewCount: 1 } } },
    events: [],
  });

  assert.deepEqual(stats.jlpt.find(({ level }) => level === "N2")?.vocabulary, {
    known: 520,
    total: 1799,
    unseen: 1279,
    stages: [520, 0, 0, 0, 0, 0, 0, 0, 0],
  });
});
