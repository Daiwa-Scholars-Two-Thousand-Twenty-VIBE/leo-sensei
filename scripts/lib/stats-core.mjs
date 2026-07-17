import { deriveDailyStatus, studyDate } from "./daily-session.mjs";
import { effectiveLearningEvents, foldLearningEvents, isLearningAnswerEvent } from "./learner-core.mjs";

const day = 24 * 60 * 60 * 1000;
const levelIntervals = Object.freeze([0, day, 2 * day, 4 * day, 7 * day, 14 * day, 30 * day, 60 * day, 120 * day]);

const cardsArray = (catalog) => Array.isArray(catalog?.cards) ? catalog.cards : [];

const statesArray = (cardStates) => Array.isArray(cardStates)
  ? cardStates
  : Object.values(cardStates?.cardsById ?? cardStates ?? {});

const eventStudyDate = (event, timeZone) => typeof event?.studyDate === "string"
  ? event.studyDate
  : studyDate(event?.occurredAt, timeZone);

const studyDays = (count, now, timeZone) => Array.from(
  { length: count },
  (_, index) => studyDate(new Date(Date.parse(now) - ((count - index - 1) * day)), timeZone),
);

const validTime = (value) => Number.isFinite(Date.parse(value ?? ""));

const levelFor = (state, card) => state?.status === "fsrs"
  && Number(state.reviewCount) === 1
  && card?.provenance?.marumori?.status === "lesson"
  ? 1
  : ((interval) => Array.from({ length: 9 }, (_, index) => index + 1)
      .filter((level) => interval >= levelIntervals[level - 1])
      .at(-1) ?? null)(validTime(state?.dueAt) && validTime(state?.lastReviewedAt)
      ? Date.parse(state.dueAt) - Date.parse(state.lastReviewedAt)
      : Number.NEGATIVE_INFINITY);

const answeredFor = (events) => effectiveLearningEvents(events).filter(isLearningAnswerEvent);

const accuracyFor = (events) => ({
  attempts: events.length,
  correct: events.filter((event) => event.correct).length,
  rate: events.length === 0 ? null : events.filter((event) => event.correct).length / events.length,
});

const sessionsByDate = (events, timeZone) => Object.fromEntries(
  events
    .filter((event) => event.type === "session_started" && event.session)
    .map((event) => [eventStudyDate(event, timeZone), event.session]),
);

const completionByDate = (events, sessions, now) => Object.fromEntries(
  Object.entries(sessions).map(([date, session]) => [
    date,
    deriveDailyStatus({ session, events, now }).complete,
  ]),
);

const streakFor = (completeByDate, now, timeZone) => ((days) => days.reduce(
  ({ count, open }, date) => open && completeByDate[date]
    ? { count: count + 1, open: true }
    : { count, open: false },
  { count: 0, open: true },
).count)(studyDays(
  365,
  completeByDate[studyDate(now, timeZone)] ? now : new Date(Date.parse(now) - day).toISOString(),
  timeZone,
).toReversed());

const activityFor = (days, answers, cardsById, completeByDate, timeZone) => days.map((date) => ((dayAnswers) => ({
  studyDate: date,
  attempts: dayAnswers.length,
  correct: dayAnswers.filter((event) => event.correct).length,
  cards: new Set(dayAnswers.map((event) => event.cardId)).size,
  kanji: dayAnswers.filter((event) => cardsById[event.cardId]?.type === "kanji").length,
  vocabulary: dayAnswers.filter((event) => cardsById[event.cardId]?.type === "vocabulary").length,
  complete: Boolean(completeByDate[date]),
}))(answers.filter((event) => eventStudyDate(event, timeZone) === date)));

const historyDays = (events, now) => Math.min(365, Math.max(1, Math.floor(
  (Date.parse(now) - Math.min(
    ...events.map((event) => Date.parse(event.occurredAt ?? now)).filter(Number.isFinite),
    Date.parse(now),
  )) / day,
) + 1));

const cardLevel = (card, state) => levelFor(state, card) ?? (
  Number.isInteger(card?.provenance?.marumori?.level)
    ? Math.min(9, Math.max(1, card.provenance.marumori.level))
    : null
);

const masteryHistory = (catalog, events, now, timeZone) => ((cards) => studyDays(
  historyDays(events, now),
  now,
  timeZone,
).map((date) => ((states) => ({
  studyDate: date,
  kanji: cards.filter((card) => card.type === "kanji" && cardLevel(card, states[card.id]) === 9).length,
  vocabulary: cards.filter((card) => card.type === "vocabulary" && cardLevel(card, states[card.id]) === 9).length,
}))(foldLearningEvents(
  catalog,
  events.filter((event) => event.type === "marumori_baseline" || eventStudyDate(event, timeZone) <= date),
).cardsById)))(cardsArray(catalog));

const progressFor = (type, cards, states, answeredIds, now) => ((typedCards) => ({
  total: typedCards.length,
  started: typedCards.filter((card) => answeredIds.has(card.id)).length,
  expert: typedCards.filter((card) => levelFor(states[card.id], card) === 9).length,
  dueNow: typedCards.filter((card) => states[card.id]?.status !== "unscheduled"
    && validTime(states[card.id]?.dueAt)
    && Date.parse(states[card.id].dueAt) <= Date.parse(now)).length,
  levels: Array.from(
    { length: 9 },
    (_, index) => typedCards.filter((card) => levelFor(states[card.id], card) === index + 1).length,
  ),
}))(cards.filter((card) => card.type === type));

const cappedStages = (stages, known) => stages.toReversed().reduce(
  ({ remaining, values }, count) => ({
    remaining: remaining - Math.min(count, remaining),
    values: [...values, Math.min(count, remaining)],
  }),
  { remaining: known, values: [] },
).values.toReversed();

export const jlptDeckProgress = ({ catalog, cardStates }) => ((cards, states) => (
  Array.isArray(catalog?.jlpt?.decks) ? catalog.jlpt.decks : []
).map((deck) => ((deckCards) => ((laterKnown, known, started) => ((measuredStages) => ({
  id: deck.id,
  known,
  started,
  unstarted: Math.max(0, Number(deck.total ?? 0) - started),
  learning: Math.max(0, started - known),
  total: Number(deck.total ?? 0),
  unseen: Math.max(0, Number(deck.total ?? 0) - known),
  stages: measuredStages.map((count, index) => index === 0
    ? count + Math.max(0, known - measuredStages.reduce((total, stage) => total + stage, 0))
    : count),
}))(cappedStages(
  Array.from(
    { length: 9 },
    (_, index) => deckCards.filter((card) => cardLevel(card, states[card.id]) === index + 1).length,
  ),
  known,
)))(
  deckCards
    .filter((card) => !card?.provenance?.jlpt?.baselineKnown)
    .filter((card) => Number(states[card.id]?.reviewCount ?? 0) > 0).length,
  Math.min(
    Number(deck.knownAtImport ?? 0) + deckCards
      .filter((card) => !card?.provenance?.jlpt?.baselineKnown)
      .filter((card) => Number(states[card.id]?.reviewCount ?? 0) > 0).length,
    Number(deck.total ?? 0),
  ),
  Math.min(
    Number(deck.knownAtImport ?? 0) + deckCards
      .filter((card) => !card?.provenance?.jlpt?.baselineKnown)
      .filter((card) => Number(states[card.id]?.reviewCount ?? 0) > 0).length
      + deckCards.filter((card) => !card?.provenance?.jlpt?.baselineKnown && Number(states[card.id]?.reviewCount ?? 0) === 0).length,
    Number(deck.total ?? 0),
  ),
))(cards.filter((card) => card?.provenance?.jlpt?.deckIds?.includes(deck.id)))))(
  cardsArray(catalog),
  Object.fromEntries(statesArray(cardStates).map((state) => [state.cardId ?? state.id, state])),
);

const jlptProgress = (catalog, states) => ((decks, progressByDeck) => ["N5", "N4", "N3", "N2", "N1"].map((level) => ((progressForDeck) => ({
  level,
  kanji: progressForDeck(decks.find((deck) => String(deck?.level ?? "").toUpperCase() === level && deck.type === "kanji") ?? {}),
  vocabulary: progressForDeck(decks.find((deck) => String(deck?.level ?? "").toUpperCase() === level && deck.type === "vocabulary") ?? {}),
}))((deck) => (({ known, total, unseen, stages }) => ({ known, total, unseen, stages }))(
  progressByDeck[deck.id] ?? { known: 0, total: 0, unseen: 0, stages: Array(9).fill(0) },
))))(
  Array.isArray(catalog?.jlpt?.decks) ? catalog.jlpt.decks : [],
  Object.fromEntries(jlptDeckProgress({ catalog, cardStates: states }).map((progress) => [progress.id, progress])),
);

export const deriveStats = ({
  catalog,
  cardStates,
  events = [],
  now = new Date().toISOString(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}) => ((cards, states, answers, completeByDate, activityDays) => ((answeredIds, within) => ({
  activity: { days: activityFor(activityDays, answers, Object.fromEntries(cards.map((card) => [card.id, card])), completeByDate, timeZone) },
  mastery: masteryHistory(catalog, effectiveLearningEvents(events), now, timeZone),
  streak: streakFor(completeByDate, now, timeZone),
  accuracy: {
    sevenDays: accuracyFor(answers.filter((event) => within(7).has(eventStudyDate(event, timeZone)))),
    thirtyDays: accuracyFor(answers.filter((event) => within(30).has(eventStudyDate(event, timeZone)))),
  },
  progress: {
    kanji: progressFor("kanji", cards, states, answeredIds, now),
    vocabulary: progressFor("vocabulary", cards, states, answeredIds, now),
  },
  jlpt: jlptProgress(catalog, states),
}))(
  new Set(answers.map((event) => event.cardId)),
  (count) => new Set(studyDays(count, now, timeZone)),
))(
  cardsArray(catalog),
  Object.fromEntries(statesArray(cardStates).map((state) => [state.cardId ?? state.id, state])),
  answeredFor(events),
  completionByDate(answeredFor(events), sessionsByDate(effectiveLearningEvents(events), timeZone), now),
  studyDays(historyDays(effectiveLearningEvents(events), now), now, timeZone),
);
