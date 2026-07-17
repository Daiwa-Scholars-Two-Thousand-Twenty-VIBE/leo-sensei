import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDailyView,
  buildExtraView,
  createAnswerAliasEvent,
  createExtraSessionEvent,
  createExtraReviewEvent,
  createReadingCheck,
  createRedoEvent,
  createReviewEvent,
} from "../scripts/lib/review-service.mjs";

const cards = [
  { id: "k-1", type: "kanji", item: "招", reading: "まねく", meanings: ["beckon"] },
  { id: "v-1", type: "vocabulary", item: "応募", reading: "おうぼ", meanings: ["application"] },
  { id: "v-new", type: "vocabulary", item: "抑える", reading: "おさえる", meanings: ["restrain"] },
];

const painCard = {
  id: "k-pain",
  type: "kanji",
  item: "痛",
  reading: "つう",
  readings: ["つう", "いた.む", "いた.い"],
  meanings: ["pain"],
  meaningAliases: ["ache", "hurt"],
};

const session = {
  studyDate: "2026-07-15",
  startedAt: "2026-07-15T00:00:00.000Z",
  scheduled: [
    { cardId: "k-1", type: "kanji", source: "due", promptDirection: "recognition" },
    { cardId: "v-1", type: "vocabulary", source: "due", promptDirection: "reverse" },
  ],
  reactivations: [
    { cardId: "v-new", type: "vocabulary", source: "reactivation", promptDirection: "recognition" },
  ],
};

const sessionEvent = {
  type: "session_started",
  studyDate: session.studyDate,
  occurredAt: session.startedAt,
  session,
};

test("buildDailyView exposes frozen unanswered cards without their answers", () => {
  const view = buildDailyView({ cards, cardStates: [], events: [sessionEvent], now: "2026-07-15T01:00:00.000Z" });

  assert.equal(view.ok, true);
  assert.deepEqual(view.value.queue.map(({ id, promptDirection }) => [id, promptDirection]), [
    ["k-1", "recognition"],
    ["v-1", "reverse"],
    ["v-new", "recognition"],
  ]);
  assert.equal("meanings" in view.value.queue[0], false);
  assert.equal("reading" in view.value.queue[0], false);
  assert.equal(view.value.queue[1].prompt, "application");
  assert.equal("item" in view.value.queue[1], false);
  assert.equal(view.value.queue[1].prompt.includes("おうぼ"), false);
  assert.equal(view.value.queue[1].prompt.includes("応募"), false);
});

test("createReviewEvent grades recognition reading and meaning as one retrieval", () => {
  const correct = createReviewEvent({
    cards,
    session,
    events: [sessionEvent],
    input: { cardId: "k-1", readingAnswer: "マネク", meaningAnswer: "beckon" },
    eventId: "answer-correct",
    now: "2026-07-15T01:01:00.000Z",
  });
  const wrong = createReviewEvent({
    cards,
    session,
    events: [sessionEvent],
    input: { cardId: "k-1", readingAnswer: "しょう", meaningAnswer: "beckon" },
    now: "2026-07-15T01:02:00.000Z",
  });

  assert.equal(correct.value.event.correct, true);
  assert.equal(wrong.value.event.correct, false);
  assert.equal(correct.value.event.type, "review_answered");
  assert.equal(correct.value.event.eventId, "answer-correct");
  assert.equal(correct.value.feedback.answerEventId, "answer-correct");
  assert.deepEqual(correct.value.feedback.expectedMeanings, ["beckon"]);
});

test("createRedoEvent voids only the latest effective answer from the current study day", () => {
  const earlier = {
    type: "review_answered",
    eventId: "answer-1",
    cardId: "k-1",
    studyDate: session.studyDate,
    occurredAt: "2026-07-15T01:00:00.000Z",
    correct: false,
  };
  const latest = {
    ...earlier,
    eventId: "answer-2",
    occurredAt: "2026-07-15T01:01:00.000Z",
    correct: true,
  };
  const redone = createRedoEvent({
    events: [sessionEvent, earlier, latest],
    input: { answerEventId: latest.eventId },
    studyDate: session.studyDate,
    now: "2026-07-15T01:02:00.000Z",
  });
  const stale = createRedoEvent({
    events: [sessionEvent, earlier, latest],
    input: { answerEventId: earlier.eventId },
    studyDate: session.studyDate,
    now: "2026-07-15T01:02:00.000Z",
  });

  assert.deepEqual(redone, {
    ok: true,
    value: {
      event: {
        type: "review_answer_voided",
        studyDate: session.studyDate,
        occurredAt: "2026-07-15T01:02:00.000Z",
        targetEventId: latest.eventId,
        cardId: latest.cardId,
        targetType: latest.type,
      },
      target: latest,
    },
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true);
});

test("createReviewEvent accepts alternate readings and meaning aliases", () => {
  const result = createExtraReviewEvent({
    cards: [painCard],
    input: { cardId: painCard.id, readingAnswer: "いた", meaningAnswer: "ache" },
    studyDate: "2026-07-15",
    now: "2026-07-15T01:02:00.000Z",
  });

  assert.equal(result.value.event.correct, true);
  assert.equal(result.value.event.readingCorrect, true);
  assert.equal(result.value.event.meaningCorrect, true);
  assert.equal(result.value.feedback.expectedReading, "つう; いたむ; いたい");
  assert.deepEqual(result.value.feedback.expectedMeanings, ["pain", "ache", "hurt"]);
});

test("createReadingCheck decides whether recognition should continue to meaning", () => {
  const correct = createReadingCheck({
    cards: [painCard],
    events: [],
    input: { cardId: painCard.id, readingAnswer: "いたい" },
  });
  const wrong = createReadingCheck({
    cards: [painCard],
    events: [],
    input: { cardId: painCard.id, readingAnswer: "ちがう" },
  });

  assert.equal(correct.ok, true);
  assert.equal(correct.value.correct, true);
  assert.equal(wrong.ok, true);
  assert.equal(wrong.value.correct, false);
});

test("answer alias events teach the grader a missing reading or meaning", () => {
  const readingAlias = createAnswerAliasEvent({
    cards: [cards[0]],
    input: { cardId: "k-1", kind: "reading", value: "しょう" },
    studyDate: "2026-07-15",
    now: "2026-07-15T01:01:00.000Z",
  });
  const meaningAlias = createAnswerAliasEvent({
    cards: [cards[0]],
    input: { cardId: "k-1", kind: "meaning", value: "invite" },
    studyDate: "2026-07-15",
    now: "2026-07-15T01:02:00.000Z",
  });
  const learned = createExtraReviewEvent({
    cards: [cards[0]],
    events: [readingAlias.value.event, meaningAlias.value.event],
    input: { cardId: "k-1", readingAnswer: "しょう", meaningAnswer: "invite" },
    studyDate: "2026-07-15",
    now: "2026-07-15T01:03:00.000Z",
  });

  assert.equal(readingAlias.value.event.type, "reading_alias_added");
  assert.equal(meaningAlias.value.event.type, "meaning_alias_added");
  assert.equal(learned.value.event.correct, true);
});

test("answer aliases reject blank values and unknown cards", () => {
  assert.equal(createAnswerAliasEvent({ cards, input: { cardId: "k-1", kind: "meaning", value: " " } }).ok, false);
  assert.equal(createAnswerAliasEvent({ cards, input: { cardId: "missing", kind: "reading", value: "み" } }).ok, false);
});

test("createReviewEvent grades reverse vocabulary against the Japanese surface", () => {
  const result = createReviewEvent({
    cards,
    session,
    events: [sessionEvent],
    input: { cardId: "v-1", reverseAnswer: "応募" },
    now: "2026-07-15T01:03:00.000Z",
  });

  assert.equal(result.value.event.correct, true);
  assert.equal(result.value.event.promptDirection, "reverse");
});

test("createReviewEvent accepts the hiragana reading for reverse vocabulary", () => {
  const result = createReviewEvent({
    cards,
    session,
    events: [sessionEvent],
    input: { cardId: "v-1", reverseAnswer: "おうぼ" },
    now: "2026-07-15T01:03:00.000Z",
  });

  assert.equal(result.value.event.correct, true);
});

test("createReviewEvent preserves an incorrect reverse answer for feedback", () => {
  const result = createReviewEvent({
    cards,
    session,
    events: [sessionEvent],
    input: { cardId: "v-1", reverseAnswer: "おぼ" },
    now: "2026-07-15T01:03:00.000Z",
  });

  assert.equal(result.value.event.correct, false);
  assert.equal(result.value.feedback.submittedReverse, "おぼ");
});

test("createReviewEvent distinguishes required reactivations from scheduled reviews", () => {
  const result = createReviewEvent({
    cards,
    session,
    events: [sessionEvent],
    input: { cardId: "v-new", readingAnswer: "おさえる", meaningAnswer: "restrain" },
    now: "2026-07-15T01:04:00.000Z",
  });

  assert.equal(result.value.event.type, "reactivation_answered");
});

test("buildDailyView queues missed cards only when retries are needed for 80 percent", () => {
  const scheduled = Array.from({ length: 5 }, (_, index) => ({
    cardId: `v-${index}`,
    type: "vocabulary",
    source: "due",
    promptDirection: "recognition",
  }));
  const retryCards = scheduled.map(({ cardId }, index) => ({
    id: cardId,
    type: "vocabulary",
    item: `語${index}`,
    reading: `ご${index}`,
    meanings: [`word ${index}`],
  }));
  const retrySession = { ...session, scheduled, reactivations: [] };
  const attempts = scheduled.map(({ cardId }, index) => ({
    type: "review_answered",
    studyDate: session.studyDate,
    occurredAt: `2026-07-15T01:0${index}:00.000Z`,
    cardId,
    correct: index < 3,
  }));
  const view = buildDailyView({
    cards: retryCards,
    cardStates: [],
    events: [{ ...sessionEvent, session: retrySession }, ...attempts],
    now: "2026-07-15T02:00:00.000Z",
  });

  assert.deepEqual(view.value.queue.map(({ id }) => id), ["v-3", "v-4"]);
});

test("buildDailyView keeps every missed v2 card queued until correct", () => {
  const strictSession = {
    ...session,
    sessionVersion: 2,
    scheduled: [session.scheduled[0]],
    reactivations: [session.reactivations[0]],
    presentationOrder: ["v-new", "k-1"],
  };
  const attempts = [
    { type: "review_answered", studyDate: strictSession.studyDate, occurredAt: "2026-07-15T01:00:00.000Z", cardId: "k-1", correct: false },
    { type: "reactivation_answered", studyDate: strictSession.studyDate, occurredAt: "2026-07-15T01:01:00.000Z", cardId: "v-new", correct: false },
  ];
  const missed = buildDailyView({ cards, cardStates: [], events: [{ ...sessionEvent, session: strictSession }, ...attempts], now: "2026-07-15T02:00:00.000Z" });
  const cleared = buildDailyView({
    cards,
    cardStates: [],
    events: [
      { ...sessionEvent, session: strictSession },
      ...attempts,
      { ...attempts[0], occurredAt: "2026-07-15T01:02:00.000Z", correct: true },
      { ...attempts[1], occurredAt: "2026-07-15T01:03:00.000Z", correct: true },
    ],
    now: "2026-07-15T02:00:00.000Z",
  });

  assert.deepEqual(missed.value.queue.map(({ id }) => id), ["k-1", "v-new"]);
  assert.equal(cleared.value.status.complete, true);
  assert.deepEqual(cleared.value.queue, []);
});

test("buildDailyView rotates the most recently missed v2 card behind other retries", () => {
  const retrySession = {
    ...session,
    sessionVersion: 2,
    scheduled: [
      { ...session.scheduled[0], cardId: "k-1" },
      { ...session.scheduled[0], cardId: "v-1", type: "vocabulary" },
      { ...session.scheduled[0], cardId: "v-new", type: "vocabulary" },
    ],
    reactivations: [],
    presentationOrder: ["k-1", "v-1", "v-new"],
  };
  const view = buildDailyView({
    cards,
    cardStates: [],
    events: [
      { ...sessionEvent, session: retrySession },
      { type: "review_answered", studyDate: retrySession.studyDate, occurredAt: "2026-07-15T01:01:00.000Z", cardId: "v-1", correct: false },
      { type: "review_answered", studyDate: retrySession.studyDate, occurredAt: "2026-07-15T01:02:00.000Z", cardId: "v-new", correct: false },
      { type: "review_answered", studyDate: retrySession.studyDate, occurredAt: "2026-07-15T01:03:00.000Z", cardId: "k-1", correct: false },
    ],
    now: "2026-07-15T02:00:00.000Z",
  });

  assert.deepEqual(view.value.queue.map(({ id }) => id), ["v-1", "v-new", "k-1"]);
});

test("buildDailyView places missed v2 cards after cards not yet attempted", () => {
  const deferredSession = {
    ...session,
    sessionVersion: 2,
    scheduled: session.scheduled,
    reactivations: [],
    presentationOrder: ["k-1", "v-1"],
  };
  const view = buildDailyView({
    cards,
    cardStates: [],
    events: [
      { ...sessionEvent, session: deferredSession },
      { type: "review_answered", studyDate: deferredSession.studyDate, occurredAt: "2026-07-15T01:00:00.000Z", cardId: "k-1", correct: false },
    ],
    now: "2026-07-15T02:00:00.000Z",
  });

  assert.deepEqual(view.value.queue.map(({ id }) => id), ["v-1", "k-1"]);
});

test("buildExtraView selects additional due cards outside the frozen daily session", () => {
  const extraCards = [
    ...cards,
    { id: "k-extra", type: "kanji", item: "支", reading: "ささえる", meanings: ["support"] },
  ];
  const view = buildExtraView({
    cards: extraCards,
    cardStates: [
      { cardId: "k-1", status: "fsrs", dueAt: "2026-07-01T00:00:00.000Z", stability: 1 },
      { cardId: "k-extra", status: "marumori", dueAt: "2026-06-01T00:00:00.000Z", stability: 1 },
    ],
    session,
    now: "2026-07-15T03:00:00.000Z",
    limit: 40,
  });

  assert.deepEqual(view.queue.map(({ id }) => id), ["k-extra"]);
  assert.equal(view.queue[0].source, "extra");
});

test("extra sessions freeze their members and never top up after an answer", () => {
  const extraCards = [
    ...cards,
    { id: "extra-1", type: "vocabulary", item: "一", reading: "いち", meanings: ["one"] },
    { id: "extra-2", type: "vocabulary", item: "二", reading: "に", meanings: ["two"] },
    { id: "extra-3", type: "vocabulary", item: "三", reading: "さん", meanings: ["three"] },
  ];
  const cardStates = ["extra-1", "extra-2", "extra-3"].map((cardId, index) => ({
    cardId,
    status: "marumori",
    dueAt: `2026-07-0${index + 1}T00:00:00.000Z`,
    importedIntervalDays: 1,
  }));
  const started = createExtraSessionEvent({
    cards: extraCards,
    cardStates,
    session,
    now: "2026-07-15T03:00:00.000Z",
    limit: 2,
  });
  const answeredCardId = started.session.entries[0].cardId;
  const view = buildExtraView({
    cards: extraCards,
    extraSession: started.session,
    events: [{
      type: "extra_review_answered",
      studyDate: session.studyDate,
      extraSessionId: started.session.extraSessionId,
      cardId: answeredCardId,
      correct: true,
    }],
  });

  assert.equal(started.type, "extra_session_started");
  assert.equal(started.session.entries.length, 2);
  assert.deepEqual(view.queue.map(({ id }) => id), [started.session.entries[1].cardId]);
  assert.equal(view.queue.some(({ id }) => id === "extra-3"), false);
});

test("createExtraReviewEvent updates scheduling without counting toward the gate", () => {
  const result = createExtraReviewEvent({
    cards,
    input: { cardId: "k-1", readingAnswer: "まねく", meaningAnswer: "beckon" },
    studyDate: "2026-07-15",
    now: "2026-07-15T03:00:00.000Z",
  });

  assert.equal(result.value.event.type, "extra_review_answered");
  assert.equal(result.value.event.correct, true);
});

test("daily lessons stay inside five-card groups and resume incorrect cards", () => {
  const lessonCards = Array.from({ length: 8 }, (_, index) => ({
    id: `lesson-${index + 1}`,
    type: "vocabulary",
    item: `word ${index + 1}`,
    readings: [`word-${index + 1}`],
    meanings: [`meaning ${index + 1}`],
  }));
  const extraSession = {
    extraSessionId: "lesson-1",
    lesson: true,
    studyDate: "2026-07-15",
    presentationOrder: lessonCards.map(({ id }) => id),
    entries: lessonCards.map(({ id, type }) => ({ cardId: id, type, source: "extra", promptDirection: "recognition" })),
  };
  const oneWrong = buildExtraView({
    cards: lessonCards,
    extraSession,
    events: lessonCards.slice(0, 5).map(({ id }, index) => ({
      type: "extra_review_answered",
      extraSessionId: "lesson-1",
      cardId: id,
      correct: index !== 2,
      occurredAt: `2026-07-15T01:0${index}:00.000Z`,
    })),
  });
  const firstGroupCleared = buildExtraView({
    cards: lessonCards,
    extraSession,
    events: lessonCards.slice(0, 5).map(({ id }, index) => ({
      type: "extra_review_answered",
      extraSessionId: "lesson-1",
      cardId: id,
      correct: true,
      occurredAt: `2026-07-15T01:0${index}:00.000Z`,
    })),
  });

  assert.deepEqual(oneWrong.queue.map(({ id }) => id), ["lesson-3"]);
  assert.deepEqual(oneWrong.lessonGroup, { index: 0, total: 2, cardIds: lessonCards.slice(0, 5).map(({ id }) => id) });
  assert.deepEqual(firstGroupCleared.queue.map(({ id }) => id), lessonCards.slice(5).map(({ id }) => id));
});
