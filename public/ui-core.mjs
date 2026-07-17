export const requiredPhase = (card) =>
  card?.promptDirection === "reverse"
    ? "reverse"
    : card?.requiresReading
      ? "reading"
      : "meaning";

const selectedCard = (daily, currentId) => daily?.queue?.find(({ id }) => id === currentId) ?? null;

const reconciledReviewQueue = (previousDaily, refreshedDaily, currentId, correct) => ((entriesById) => ((preservedIds) => [
  ...(previousDaily?.queue ?? [])
    .filter(({ id }) => id !== currentId && entriesById.has(id))
    .map(({ id }) => entriesById.get(id)),
  ...(refreshedDaily?.queue ?? [])
    .filter(({ id }) => id !== currentId && !preservedIds.has(id)),
  ...(!correct && entriesById.has(currentId) ? [entriesById.get(currentId)] : []),
])(new Set((previousDaily?.queue ?? [])
  .map(({ id }) => id)
  .filter((id) => id !== currentId && entriesById.has(id)))))(
  new Map((refreshedDaily?.queue ?? []).map((entry) => [entry.id, entry])),
);

const reconcileDailyReview = (previousDaily, refreshedDaily, currentId, correct) => ({
  ...refreshedDaily,
  queue: reconciledReviewQueue(previousDaily, refreshedDaily, currentId, correct),
});

export const initialUiState = (daily = null) => ({
  daily,
  currentId: daily?.queue?.[0]?.id ?? null,
  phase: requiredPhase(daily?.queue?.[0]),
  readingAnswer: "",
  feedback: null,
  bypassOpen: false,
  submitting: false,
  aliasSaving: false,
  error: null,
});

const reducers = Object.freeze({
  daily_loaded: (_state, event) => initialUiState(event.daily),
  selected: (state, event) => ({
    ...state,
    currentId: event.cardId,
    phase: requiredPhase(selectedCard(state.daily, event.cardId)),
    readingAnswer: "",
    feedback: null,
    error: null,
  }),
  reading_entered: (state, event) => ({ ...state, phase: "meaning", readingAnswer: event.answer, error: null }),
  request_started: (state) => ({ ...state, submitting: true, error: null }),
  review_recorded: (state, event) => ({
    ...state,
    daily: reconcileDailyReview(state.daily, event.daily, state.currentId, event.feedback.correct),
    feedback: {
      ...event.feedback,
      cardType: selectedCard(state.daily, state.currentId)?.type ?? "vocabulary",
    },
    submitting: false,
    error: null,
  }),
  review_redone: (state, event) => ({
    ...state,
    daily: event.daily,
    currentId: event.cardId,
    phase: requiredPhase(selectedCard(event.daily, event.cardId)),
    readingAnswer: "",
    feedback: null,
    submitting: false,
    error: null,
  }),
  alias_started: (state) => ({ ...state, aliasSaving: true, error: null }),
  alias_saved: (state, event) => ({
    ...state,
    aliasSaving: false,
    feedback: { ...state.feedback, aliasSaved: event.kind },
    error: null,
  }),
  continue: (state) => ({
    ...state,
    currentId: state.daily?.queue?.[0]?.id ?? null,
    phase: requiredPhase(state.daily?.queue?.[0]),
    readingAnswer: "",
    feedback: null,
    error: null,
  }),
  bypass_opened: (state) => ({ ...state, bypassOpen: true, error: null }),
  bypass_closed: (state) => ({ ...state, bypassOpen: false, error: null }),
  request_failed: (state, event) => ({ ...state, submitting: false, aliasSaving: false, error: event.error }),
});

export const reduceUi = (state, event) => (reducers[event.type] ?? ((value) => value))(state, event);
