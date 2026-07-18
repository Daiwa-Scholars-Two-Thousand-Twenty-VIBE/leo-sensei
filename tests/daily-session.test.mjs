import test from "node:test";
import assert from "node:assert/strict";

import {
  carryoverForStudyDate,
  createBypassEvent,
  createEmergencyUnlockEvent,
  dailyLimits,
  deriveDailyStatus,
  gateAccess,
  selectDailySession,
  studyDate,
} from "../scripts/lib/daily-session.mjs";

const makeCard = (type, index, overrides = {}) => ({
  id: `${type}-${String(index).padStart(2, "0")}`,
  type,
  item: `${type} ${index}`,
  meanings: [`meaning ${index}`],
  marumori: { level: 5, leech: false },
  ...overrides,
});

const makeState = (card, dueAt, overrides = {}) => ({
  cardId: card.id,
  dueAt,
  stability: 5,
  ...overrides,
});

test("studyDate uses a 04:00 boundary in the injected local timezone", () => {
  assert.equal(studyDate("2026-07-14T18:59:59.999Z", "Asia/Tokyo"), "2026-07-14");
  assert.equal(studyDate("2026-07-14T19:00:00.000Z", "Asia/Tokyo"), "2026-07-15");
});

test("daily limits scale 25/50/10/15 proportions with deterministic largest remainders", () => {
  assert.deepEqual(dailyLimits(100), {
    scheduled: { kanji: 25, vocabulary: 50 },
    reactivations: { kanji: 10, vocabulary: 15 },
  });
  assert.deepEqual(dailyLimits(7), {
    scheduled: { kanji: 2, vocabulary: 3 },
    reactivations: { kanji: 1, vocabulary: 1 },
  });
  assert.equal(Object.values(dailyLimits(23)).flatMap(Object.values).reduce((sum, count) => sum + count, 0), 23);
});

test("selectDailySession honors a configurable total and freezes that scaled contract", () => {
  const cards = [
    ...Array.from({ length: 20 }, (_, index) => makeCard("kanji", index)),
    ...Array.from({ length: 30 }, (_, index) => makeCard("vocabulary", index)),
  ];
  const selected = selectDailySession({
    cards,
    cardStates: cards.map((card) => makeState(card, "2026-07-01T00:00:00.000Z")),
    events: [],
    now: "2026-07-15T03:00:00.000Z",
    requiredDailyCount: 20,
    timeZone: "Asia/Tokyo",
  });

  assert.equal(selected.scheduled.length, 15);
  assert.equal(selected.reactivations.length, 5);
});

test("custom and JLPT cards stay out of Reviews until learned", () => {
  const cards = [
    makeCard("kanji", 1, { provenance: { jlpt: { deckIds: ["n5-kanji"], baselineKnown: false } }, marumori: undefined }),
    makeCard("vocabulary", 1, { provenance: { customListId: "custom:paperwork" }, marumori: undefined }),
  ];
  const unlearned = selectDailySession({
    cards,
    cardStates: [],
    events: [],
    now: "2026-07-15T03:00:00.000Z",
    requiredDailyCount: 4,
    timeZone: "Asia/Tokyo",
  });
  const learnedAndDue = selectDailySession({
    cards,
    cardStates: cards.map((card) => makeState(card, "2026-07-01T00:00:00.000Z", { status: "fsrs" })),
    events: [],
    now: "2026-07-15T03:00:00.000Z",
    requiredDailyCount: 4,
    timeZone: "Asia/Tokyo",
  });

  assert.deepEqual(unlearned.scheduled, []);
  assert.deepEqual(new Set(learnedAndDue.scheduled.map(({ cardId }) => cardId)), new Set(cards.map(({ id }) => id)));
});

test("selectDailySession caps, prioritizes, and separates studied reactivations", () => {
  const now = "2026-07-15T03:00:00.000Z";
  const dueKanji = Array.from({ length: 30 }, (_, index) => makeCard("kanji", index));
  const dueVocabulary = Array.from({ length: 60 }, (_, index) => makeCard("vocabulary", index));
  const poolKanji = Array.from({ length: 15 }, (_, index) => makeCard("kanji", index + 30));
  const poolVocabulary = Array.from({ length: 30 }, (_, index) => makeCard("vocabulary", index + 60));
  const grammar = makeCard("grammar", 1);
  const cards = [...dueKanji, ...dueVocabulary, ...poolKanji, ...poolVocabulary, grammar];
  const cardStates = [
    ...dueKanji.map((card) => makeState(card, "2026-07-01T00:00:00.000Z")),
    ...dueVocabulary.map((card) => makeState(card, "2026-06-01T00:00:00.000Z")),
    makeState(grammar, "2025-01-01T00:00:00.000Z"),
  ];
  const session = selectDailySession({ cards, cardStates, events: [], now });

  assert.equal(session.studyDate, "2026-07-15");
  assert.equal(session.scheduled.filter(({ type }) => type === "kanji").length, 25);
  assert.equal(session.scheduled.filter(({ type }) => type === "vocabulary").length, 50);
  assert.deepEqual(session.scheduled.slice(0, 25).map(({ cardId }) => cardId), dueKanji.slice(0, 25).map(({ id }) => id));
  assert.equal(session.reactivations.filter(({ type }) => type === "kanji").length, 5);
  assert.equal(session.reactivations.filter(({ type }) => type === "vocabulary").length, 10);
  assert.equal(new Set([...session.scheduled, ...session.reactivations].map(({ cardId }) => cardId)).size, 90);
  assert.equal(session.scheduled.filter(({ type, promptDirection }) => type === "vocabulary" && promptDirection === "reverse").length, 5);
  assert.equal(session.reactivations.every(({ promptDirection }) => promptDirection === "recognition"), true);
});

test("selectDailySession ranks due cards by overdue time, weakness, leech status, then id", () => {
  const cards = [
    makeCard("kanji", 1),
    makeCard("kanji", 2, { marumori: { level: 1, leech: false } }),
    makeCard("kanji", 3, { marumori: { level: 1, leech: true } }),
    makeCard("kanji", 4, { marumori: { level: 1, leech: true } }),
  ];
  const cardStates = [
    makeState(cards[0], "2026-07-01T00:00:00.000Z", { stability: 100 }),
    makeState(cards[1], "2026-07-02T00:00:00.000Z", { stability: 1 }),
    makeState(cards[2], "2026-07-02T00:00:00.000Z", { stability: 1 }),
    makeState(cards[3], "2026-07-02T00:00:00.000Z", { stability: 2 }),
  ];
  const session = selectDailySession({ cards, cardStates, events: [], now: "2026-07-15T03:00:00.000Z" });

  assert.deepEqual(session.scheduled.map(({ cardId }) => cardId), ["kanji-01", "kanji-03", "kanji-02", "kanji-04"]);
});

test("selectDailySession does not fill required reviews from never-studied imports", () => {
  const dueKanji = Array.from({ length: 20 }, (_, index) => makeCard("kanji", index));
  const unseenKanji = Array.from({ length: 20 }, (_, index) => makeCard("kanji", index + 30));
  const session = selectDailySession({
    cards: [...dueKanji, ...unseenKanji],
    cardStates: dueKanji.map((card) => makeState(card, "2026-07-01T00:00:00.000Z")),
    events: [],
    now: "2026-07-15T03:00:00.000Z",
  });

  assert.equal(session.scheduled.length, 20);
  assert.equal(session.reactivations.length, 0);
  assert.deepEqual(session.scheduled.map(({ cardId }) => cardId), dueKanji.map(({ id }) => id));
});

test("selectDailySession falls back to unused due imports when the unscheduled reactivation pool is exhausted", () => {
  const dueKanji = Array.from({ length: 35 }, (_, index) => makeCard("kanji", index));
  const session = selectDailySession({
    cards: dueKanji,
    cardStates: dueKanji.map((card) => makeState(card, "2026-07-01T00:00:00.000Z")),
    events: [],
    now: "2026-07-15T03:00:00.000Z",
  });

  assert.deepEqual(session.scheduled.map(({ cardId }) => cardId), dueKanji.slice(0, 25).map(({ id }) => id));
  assert.deepEqual(session.reactivations.map(({ cardId }) => cardId), dueKanji.slice(25, 35).map(({ id }) => id));
  assert.equal(new Set([...session.scheduled, ...session.reactivations].map(({ cardId }) => cardId)).size, 35);
});

test("selectDailySession prioritizes due local FSRS cards over older imported backlog", () => {
  const local = Array.from({ length: 25 }, (_, index) => makeCard("kanji", index));
  const imported = makeCard("kanji", 99);
  const session = selectDailySession({
    cards: [...local, imported],
    cardStates: [
      ...local.map((card) => makeState(card, "2026-07-14T00:00:00.000Z", { status: "fsrs", fsrs: { stability: 2 } })),
      makeState(imported, "2025-01-01T00:00:00.000Z", { status: "marumori", importedIntervalDays: 120 }),
    ],
    events: [],
    now: "2026-07-15T03:00:00.000Z",
  });

  assert.deepEqual(new Set(session.scheduled.map(({ cardId }) => cardId)), new Set(local.map(({ id }) => id)));
  assert.equal(session.reactivations.some(({ cardId }) => cardId === imported.id), true);
});

test("selectDailySession ranks imported backlog by overdue intervals rather than calendar age", () => {
  const established = Array.from({ length: 25 }, (_, index) => makeCard("kanji", index, { marumori: { level: 9, leech: false } }));
  const fragile = makeCard("kanji", 99, { marumori: { level: 1, leech: false } });
  const session = selectDailySession({
    cards: [...established, fragile],
    cardStates: [
      ...established.map((card, index) => makeState(card, `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, { status: "marumori", importedIntervalDays: 120 })),
      makeState(fragile, "2026-07-13T00:00:00.000Z", { status: "marumori", importedIntervalDays: 1 / 24 }),
    ],
    events: [],
    now: "2026-07-15T03:00:00.000Z",
  });

  assert.equal(session.scheduled.some(({ cardId }) => cardId === fragile.id), true);
});

test("new daily contracts require every scheduled and reactivation card to become correct", () => {
  const session = {
    sessionVersion: 2,
    studyDate: "2026-07-15",
    startedAt: "2026-07-15T01:00:00.000Z",
    scheduled: Array.from({ length: 5 }, (_, index) => ({ cardId: `v-${index}`, type: "vocabulary" })),
    reactivations: [{ cardId: "k-new", type: "kanji" }],
  };
  const attempts = [
    ...session.scheduled.map(({ cardId }, index) => ({
      type: "review_answered",
      studyDate: session.studyDate,
      occurredAt: `2026-07-15T01:0${index}:00.000Z`,
      cardId,
      correct: index < 4,
    })),
    { type: "reactivation_answered", studyDate: session.studyDate, occurredAt: "2026-07-15T01:06:00.000Z", cardId: "k-new", correct: false },
  ];
  const incomplete = deriveDailyStatus({ session, events: attempts, now: "2026-07-15T03:00:00.000Z" });
  const complete = deriveDailyStatus({
    session,
    events: [
      ...attempts,
      { type: "review_answered", studyDate: session.studyDate, occurredAt: "2026-07-15T01:07:00.000Z", cardId: "v-4", correct: true },
      { type: "reactivation_answered", studyDate: session.studyDate, occurredAt: "2026-07-15T01:08:00.000Z", cardId: "k-new", correct: true },
    ],
    now: "2026-07-15T03:00:00.000Z",
  });

  assert.equal(incomplete.state, "incomplete");
  assert.equal(complete.state, "complete");
});

test("new daily contracts persist a deterministic mixed presentation order", () => {
  const kanji = Array.from({ length: 35 }, (_, index) => makeCard("kanji", index));
  const vocabulary = Array.from({ length: 65 }, (_, index) => makeCard("vocabulary", index));
  const cards = [...kanji, ...vocabulary];
  const input = {
    cards,
    cardStates: cards.map((card) => makeState(card, "2026-07-01T00:00:00.000Z", { status: "marumori", importedIntervalDays: 7 })),
    events: [],
    now: "2026-07-15T03:00:00.000Z",
  };
  const first = selectDailySession(input);
  const second = selectDailySession(input);
  const types = first.presentationOrder.map((id) => cards.find((card) => card.id === id)?.type);
  const transitions = types.slice(1).filter((type, index) => type !== types[index]).length;

  assert.equal(first.sessionVersion, 2);
  assert.deepEqual(first.presentationOrder, second.presentationOrder);
  assert.equal(new Set(first.presentationOrder).size, 100);
  assert.equal(transitions > 1, true);
});

test("selectDailySession returns the frozen session from today's session_started event", () => {
  const frozen = {
    studyDate: "2026-07-15",
    startedAt: "2026-07-15T01:00:00.000Z",
    scheduled: [{ cardId: "kanji-frozen", type: "kanji", source: "due", promptDirection: "recognition" }],
    reactivations: [],
  };
  const selected = selectDailySession({
    cards: [makeCard("kanji", 99)],
    cardStates: [],
    events: [{ type: "session_started", studyDate: "2026-07-15", occurredAt: frozen.startedAt, session: frozen }],
    now: "2026-07-15T03:00:00.000Z",
  });

  assert.deepEqual(selected, frozen);
});

test("deriveDailyStatus requires attempts, eventual 80 percent accuracy, and reactivations", () => {
  const session = {
    studyDate: "2026-07-15",
    startedAt: "2026-07-15T01:00:00.000Z",
    scheduled: Array.from({ length: 5 }, (_, index) => ({ cardId: `v-${index}`, type: "vocabulary" })),
    reactivations: [{ cardId: "k-new", type: "kanji" }],
  };
  const attempts = [
    ...session.scheduled.map(({ cardId }, index) => ({
      type: "review_answered",
      studyDate: session.studyDate,
      occurredAt: `2026-07-15T01:0${index}:00.000Z`,
      cardId,
      correct: index < 3,
    })),
    { type: "reactivation_answered", studyDate: session.studyDate, occurredAt: "2026-07-15T01:06:00.000Z", cardId: "k-new", correct: false },
  ];
  const incomplete = deriveDailyStatus({ session, events: attempts, now: "2026-07-15T03:00:00.000Z" });
  const complete = deriveDailyStatus({
    session,
    events: [...attempts, { type: "review_answered", studyDate: session.studyDate, occurredAt: "2026-07-15T01:07:00.000Z", cardId: "v-3", correct: true }],
    now: "2026-07-15T03:00:00.000Z",
  });

  assert.equal(incomplete.state, "incomplete");
  assert.deepEqual(incomplete.progress.scheduled, { required: 5, attempted: 5, eventuallyCorrect: 3, accuracy: 0.6 });
  assert.equal(complete.state, "complete");
  assert.equal(complete.progress.scheduled.accuracy, 0.8);
  assert.equal(gateAccess(complete).allowed, true);
});

test("extra review events never count toward the frozen gate queue", () => {
  const session = {
    studyDate: "2026-07-15",
    startedAt: "2026-07-15T01:00:00.000Z",
    scheduled: [{ cardId: "v-1", type: "vocabulary" }],
    reactivations: [],
  };
  const status = deriveDailyStatus({
    session,
    events: [{ type: "extra_review_answered", studyDate: session.studyDate, occurredAt: "2026-07-15T02:00:00.000Z", cardId: "v-1", correct: true }],
    now: "2026-07-15T03:00:00.000Z",
  });

  assert.equal(status.state, "incomplete");
  assert.equal(status.progress.scheduled.attempted, 0);
});

test("bypass requires a reason, unlocks immediately, and expires after 4 hours", () => {
  const invalid = createBypassEvent({ reason: "  ", now: "2026-07-15T03:00:00.000Z" });
  const valid = createBypassEvent({ reason: "Client call", now: "2026-07-15T03:00:00.000Z" });
  const session = {
    studyDate: "2026-07-15",
    startedAt: "2026-07-15T01:00:00.000Z",
    scheduled: [{ cardId: "v-1", type: "vocabulary" }],
    reactivations: [],
  };
  const active = deriveDailyStatus({ session, events: [valid.event], now: "2026-07-15T06:59:59.999Z" });
  const expired = deriveDailyStatus({ session, events: [valid.event], now: "2026-07-15T07:00:00.000Z" });

  assert.deepEqual(invalid, { ok: false, error: "Bypass reason is required." });
  assert.equal(valid.ok, true);
  assert.equal(valid.event.durationMinutes, 240);
  assert.equal(valid.event.expiresAt, "2026-07-15T07:00:00.000Z");
  assert.deepEqual(gateAccess(active), { allowed: true, reason: "temporary_bypass", expiresAt: valid.event.expiresAt });
  assert.deepEqual(gateAccess(expired), { allowed: false, reason: "study_incomplete", expiresAt: null });
});

test("emergency unlock snapshots a ceiling-half carryover for the literal next study day", () => {
  const invalid = createEmergencyUnlockEvent({
    reason: " ",
    requiredDailyCount: 21,
    now: "2026-07-15T03:00:00.000Z",
    timeZone: "Asia/Tokyo",
  });
  const valid = createEmergencyUnlockEvent({
    reason: "Client call",
    requiredDailyCount: 21,
    now: "2026-07-15T03:00:00.000Z",
    timeZone: "Asia/Tokyo",
  });

  assert.deepEqual(invalid, { ok: false, error: "Bypass reason is required." });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.event, {
    type: "emergency_unlock_granted",
    studyDate: "2026-07-15",
    targetStudyDate: "2026-07-16",
    occurredAt: "2026-07-15T03:00:00.000Z",
    reason: "Client call",
    baseRequiredCount: 21,
    carryoverCount: 11,
    durationMinutes: 240,
    expiresAt: "2026-07-15T07:00:00.000Z",
  });
});

test("emergency unlock duration is configurable in minutes", () => {
  const valid = createEmergencyUnlockEvent({
    reason: "Client call",
    requiredDailyCount: 21,
    durationMinutes: 90,
    now: "2026-07-15T03:00:00.000Z",
    timeZone: "Asia/Tokyo",
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.event.durationMinutes, 90);
  assert.equal(valid.event.expiresAt, "2026-07-15T04:30:00.000Z");
});

test("emergency unlock replay deduplicates each source day and increases only the target day", () => {
  const first = createEmergencyUnlockEvent({
    reason: "Client call",
    requiredDailyCount: 7,
    now: "2026-07-15T03:00:00.000Z",
    timeZone: "Asia/Tokyo",
  }).event;
  const duplicate = { ...first, occurredAt: "2026-07-15T03:01:00.000Z", carryoverCount: 99 };
  const cards = [
    ...Array.from({ length: 10 }, (_, index) => makeCard("kanji", index)),
    ...Array.from({ length: 20 }, (_, index) => makeCard("vocabulary", index)),
  ];
  const cardStates = cards.map((card) => makeState(card, "2026-07-01T00:00:00.000Z"));

  assert.equal(carryoverForStudyDate([first, duplicate], "2026-07-16"), 4);
  assert.equal(selectDailySession({
    cards,
    cardStates,
    events: [first, duplicate],
    now: "2026-07-16T03:00:00.000Z",
    requiredDailyCount: 7,
    timeZone: "Asia/Tokyo",
  }).presentationOrder.length, 11);
  assert.equal(selectDailySession({
    cards,
    cardStates,
    events: [first],
    now: "2026-07-17T03:00:00.000Z",
    requiredDailyCount: 7,
    timeZone: "Asia/Tokyo",
  }).presentationOrder.length, 7);
});

test("emergency carryover never changes an already frozen target-day session", () => {
  const unlock = createEmergencyUnlockEvent({
    reason: "Client call",
    requiredDailyCount: 7,
    now: "2026-07-15T03:00:00.000Z",
    timeZone: "Asia/Tokyo",
  }).event;
  const frozen = {
    sessionVersion: 2,
    studyDate: "2026-07-16",
    startedAt: "2026-07-16T01:00:00.000Z",
    scheduled: [{ cardId: "kanji-frozen", type: "kanji", source: "due", promptDirection: "recognition" }],
    reactivations: [],
    presentationOrder: ["kanji-frozen"],
  };

  assert.deepEqual(selectDailySession({
    cards: Array.from({ length: 20 }, (_, index) => makeCard("kanji", index)),
    cardStates: [],
    events: [
      unlock,
      { type: "session_started", studyDate: frozen.studyDate, occurredAt: frozen.startedAt, session: frozen },
    ],
    now: "2026-07-16T03:00:00.000Z",
    requiredDailyCount: 7,
    timeZone: "Asia/Tokyo",
  }), frozen);
});

test("emergency unlock preserves the local 4-hour access duration", () => {
  const unlock = createEmergencyUnlockEvent({
    reason: "Client call",
    requiredDailyCount: 21,
    now: "2026-07-15T03:00:00.000Z",
    timeZone: "Asia/Tokyo",
  }).event;
  const session = {
    sessionVersion: 2,
    studyDate: "2026-07-15",
    startedAt: "2026-07-15T01:00:00.000Z",
    scheduled: [{ cardId: "v-1", type: "vocabulary" }],
    reactivations: [],
  };
  const active = deriveDailyStatus({ session, events: [unlock], now: "2026-07-15T06:59:59.999Z" });
  const expired = deriveDailyStatus({ session, events: [unlock], now: "2026-07-15T07:00:00.000Z" });

  assert.deepEqual(gateAccess(active), { allowed: true, reason: "emergency_unlock", expiresAt: unlock.expiresAt });
  assert.deepEqual(gateAccess(expired), { allowed: false, reason: "study_incomplete", expiresAt: null });
});

test("deriveDailyStatus exposes current and tomorrow emergency carryover counts", () => {
  const session = { studyDate: "2026-07-15", startedAt: "2026-07-15T01:00:00.000Z", scheduled: [], reactivations: [] };
  const status = deriveDailyStatus({
    session,
    events: [
      { type: "emergency_unlock_granted", studyDate: "2026-07-14", occurredAt: "2026-07-14T05:00:00.000Z", targetStudyDate: "2026-07-15", carryoverCount: 50, expiresAt: "2026-07-14T09:00:00.000Z" },
      { type: "emergency_unlock_granted", studyDate: "2026-07-15", occurredAt: "2026-07-15T02:00:00.000Z", targetStudyDate: "2026-07-16", carryoverCount: 50, expiresAt: "2026-07-15T06:00:00.000Z" },
    ],
    now: "2026-07-15T03:00:00.000Z",
  });

  assert.equal(status.makeupReviews, 50);
  assert.equal(status.makeupTomorrow, 50);
});

test("invalid session state fails open for gate consumers", () => {
  const status = deriveDailyStatus({ session: null, events: [], now: "2026-07-15T03:00:00.000Z" });

  assert.equal(status.state, "error");
  assert.equal(status.failOpen, true);
  assert.deepEqual(gateAccess(status), { allowed: true, reason: "fail_open", expiresAt: null });
});
