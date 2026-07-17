import assert from "node:assert/strict";
import test from "node:test";

import { initialUiState, reduceUi, requiredPhase } from "../public/ui-core.mjs";

const daily = {
  complete: false,
  queue: [
    { id: "k-1", promptDirection: "recognition", requiresReading: true },
    { id: "v-1", promptDirection: "reverse", requiresReading: false },
  ],
};

test("requiredPhase distinguishes recognition reading from reverse production", () => {
  assert.equal(requiredPhase(daily.queue[0]), "reading");
  assert.equal(requiredPhase(daily.queue[1]), "reverse");
});

test("UI reducer carries an immutable reading answer into the meaning phase", () => {
  const initial = initialUiState(daily);
  const next = reduceUi(initial, { type: "reading_entered", answer: "まねく" });

  assert.equal(initial.phase, "reading");
  assert.equal(initial.readingAnswer, "");
  assert.equal(next.phase, "meaning");
  assert.equal(next.readingAnswer, "まねく");
});

test("UI reducer keeps feedback separate from the refreshed daily queue", () => {
  const initial = initialUiState(daily);
  const refreshed = { ...daily, queue: [daily.queue[1]] };
  const next = reduceUi(initial, { type: "review_recorded", daily: refreshed, feedback: { correct: false } });

  assert.equal(next.feedback.correct, false);
  assert.equal(next.currentId, "k-1");
  assert.deepEqual(next.daily.queue.map(({ id }) => id), ["v-1"]);
});

test("continuing after feedback selects the next queue card", () => {
  const withFeedback = reduceUi(initialUiState(daily), {
    type: "review_recorded",
    daily: { ...daily, queue: [daily.queue[1]] },
    feedback: { correct: true },
  });
  const next = reduceUi(withFeedback, { type: "continue" });

  assert.equal(next.currentId, "v-1");
  assert.equal(next.phase, "reverse");
  assert.equal(next.feedback, null);
});

test("continuing after a wrong answer does not immediately repeat it when other cards remain", () => {
  const withFeedback = reduceUi(initialUiState(daily), {
    type: "review_recorded",
    daily,
    feedback: { correct: false },
  });
  const next = reduceUi(withFeedback, { type: "continue" });

  assert.equal(next.currentId, "v-1");
  assert.deepEqual(next.daily.queue.map(({ id }) => id), ["v-1", "k-1"]);
});

test("successive wrong answers stay behind the entire remaining queue", () => {
  const fourCards = {
    ...daily,
    queue: [
      daily.queue[0],
      daily.queue[1],
      { id: "v-2", promptDirection: "recognition", requiresReading: false },
      { id: "v-3", promptDirection: "recognition", requiresReading: false },
    ],
  };
  const afterFirstWrong = reduceUi(initialUiState(fourCards), {
    type: "review_recorded",
    daily: fourCards,
    feedback: { correct: false },
  });
  const reviewingSecond = reduceUi(afterFirstWrong, { type: "continue" });
  const serverPrioritizesFirstWrong = {
    ...fourCards,
    queue: [fourCards.queue[0], fourCards.queue[2], fourCards.queue[3], fourCards.queue[1]],
  };
  const afterSecondWrong = reduceUi(reviewingSecond, {
    type: "review_recorded",
    daily: serverPrioritizesFirstWrong,
    feedback: { correct: false },
  });
  const next = reduceUi(afterSecondWrong, { type: "continue" });

  assert.equal(next.currentId, "v-2");
  assert.deepEqual(next.daily.queue.map(({ id }) => id), ["v-2", "v-3", "k-1", "v-1"]);
});

test("redo returns directly to the voided card even when another card leads the queue", () => {
  const withFeedback = reduceUi(initialUiState(daily), {
    type: "review_recorded",
    daily: { ...daily, queue: [daily.queue[1]] },
    feedback: { correct: false, answerEventId: "answer-1" },
  });
  const redoneDaily = { ...daily, queue: [daily.queue[1], daily.queue[0]] };
  const redone = reduceUi(
    reduceUi(withFeedback, { type: "request_started" }),
    { type: "review_redone", daily: redoneDaily, cardId: "k-1" },
  );

  assert.equal(redone.currentId, "k-1");
  assert.equal(redone.phase, "reading");
  assert.equal(redone.feedback, null);
  assert.equal(redone.readingAnswer, "");
  assert.equal(redone.submitting, false);
});

test("UI reducer records a saved personal answer without mutating prior state", () => {
  const withFeedback = reduceUi(initialUiState(daily), {
    type: "review_recorded",
    daily: { ...daily, queue: [daily.queue[1]] },
    feedback: { correct: false, submittedReading: "しょう" },
  });
  const saving = reduceUi(withFeedback, { type: "alias_started" });
  const saved = reduceUi(saving, { type: "alias_saved", kind: "reading" });

  assert.equal(withFeedback.feedback.aliasSaved, undefined);
  assert.equal(saving.aliasSaving, true);
  assert.equal(saved.aliasSaving, false);
  assert.equal(saved.feedback.aliasSaved, "reading");
});
