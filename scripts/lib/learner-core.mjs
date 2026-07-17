import { Rating, State, createEmptyCard, fsrs, generatorParameters } from "ts-fsrs";

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const marumoriIntervals = Object.freeze([0, 4 * hour, 8 * hour, day, 2 * day, 7 * day, 14 * day, 30 * day, 120 * day]);
const answerEventTypes = new Set(["review_answered", "reactivation_answered", "extra_review_answered"]);
export const isLearningAnswerEvent = (event) => answerEventTypes.has(event?.type);
const eventsArray = (events) => Array.isArray(events) ? events : [];

const voidedAnswerIds = (events) => new Set(
  eventsArray(events)
    .filter((event) => event?.type === "review_answer_voided" && typeof event.targetEventId === "string")
    .map(({ targetEventId }) => targetEventId),
);

export const effectiveLearningEvents = (events) =>
  ((voidedIds) => eventsArray(events).filter(
    (event) => event?.type !== "review_answer_voided"
      && (!isLearningAnswerEvent(event) || !voidedIds.has(event?.eventId)),
  ))(voidedAnswerIds(events));

export const fsrsParameters = Object.freeze(generatorParameters({
  request_retention: 0.9,
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
}));
const scheduler = fsrs(fsrsParameters);

const validDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const clone = (value) => structuredClone(value);
const answerList = (...values) => [...new Set(
  values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .flatMap((value) => String(value ?? "").split(/[;,、]/u))
    .map((value) => value.trim())
    .filter(Boolean),
)];
const initialCardState = (cardId) => ({
  cardId,
  status: "unscheduled",
  dueAt: null,
  lastReviewedAt: null,
  reviewCount: 0,
  lastRating: null,
  fsrs: null,
  fsrsLog: null,
});

const serializeFsrsCard = (card) => ({
  ...card,
  due: card.due.toISOString(),
  last_review: card.last_review?.toISOString() ?? null,
});

const deserializeFsrsCard = (card) => ({
  ...card,
  due: new Date(card.due),
  ...(card.last_review ? { last_review: new Date(card.last_review) } : {}),
});

const serializeFsrsLog = (log) => ({
  ...log,
  due: log.due.toISOString(),
  review: log.review.toISOString(),
});

export const marumoriIntervalMs = (level) =>
  Number.isInteger(level) && level >= 1 && level <= marumoriIntervals.length ? marumoriIntervals[level - 1] : null;

const importedFsrsCard = (cardState) => {
  const intervalDays = Number(cardState.importedIntervalDays);
  const canSeedReview = cardState.status === "marumori"
    && intervalDays >= 1
    && validDate(cardState.lastReviewedAt)
    && validDate(cardState.dueAt);
  return canSeedReview
    ? {
        ...createEmptyCard(cardState.dueAt),
        stability: intervalDays / scheduler.intervalModifier,
        difficulty: 5,
        scheduled_days: Math.max(1, Math.round(intervalDays)),
        reps: 1,
        state: State.Review,
        last_review: new Date(cardState.lastReviewedAt),
      }
    : null;
};

const schedulableCard = (cardState, reviewDate) => cardState.status === "fsrs" && cardState.fsrs
  ? deserializeFsrsCard(cardState.fsrs)
  : importedFsrsCard(cardState) ?? createEmptyCard(reviewDate);

export const scheduleReview = (cardState, correct, reviewedAt) => {
  const reviewDate = new Date(reviewedAt);
  const fsrsCard = schedulableCard(cardState, reviewDate);
  const rating = correct ? Rating.Good : Rating.Again;
  const result = scheduler.next(fsrsCard, reviewDate, rating);

  return {
    ...cardState,
    status: "fsrs",
    dueAt: result.card.due.toISOString(),
    lastReviewedAt: reviewDate.toISOString(),
    reviewCount: Number(cardState.reviewCount ?? 0) + 1,
    lastRating: correct ? "good" : "again",
    fsrs: serializeFsrsCard(result.card),
    fsrsLog: serializeFsrsLog(result.log),
  };
};

const applyBaseline = (cardState, event) => ({
  ...cardState,
  status: event.scheduled ? "marumori" : "unscheduled",
  dueAt: event.scheduled ? event.dueAt : null,
  lastReviewedAt: event.scheduled ? event.reviewedAt : null,
  ...(event.scheduled
    ? {
        importedIntervalDays: (Date.parse(event.dueAt) - Date.parse(event.reviewedAt)) / day,
        importedLevel: event.marumoriLevel ?? null,
      }
    : {}),
});

const applicableBaseline = (event, cardsById) =>
  event?.type === "marumori_baseline"
  && typeof event.cardId === "string"
  && Object.hasOwn(cardsById, event.cardId)
  && typeof event.scheduled === "boolean"
  && (!event.scheduled || (validDate(event.reviewedAt) && validDate(event.dueAt)));

const applicableAnswer = (event, cardsById) =>
  isLearningAnswerEvent(event)
  && typeof event.cardId === "string"
  && Object.hasOwn(cardsById, event.cardId)
  && typeof event.correct === "boolean"
  && validDate(event.occurredAt);

const eventTime = (event) => Date.parse(event.type === "marumori_baseline" ? event.reviewedAt ?? event.occurredAt : event.occurredAt);

const foldCardEvents = (cardState, events, cardsById) => events.toSorted(
  (left, right) => eventTime(left) - eventTime(right),
).reduce(
  (state, event) =>
    applicableBaseline(event, cardsById)
      ? applyBaseline(state, event)
      : applicableAnswer(event, cardsById)
        ? scheduleReview(state, event.correct, event.occurredAt)
        : state,
  cardState,
);

export const foldLearningEvents = (catalog, events) => {
  const cards = Array.isArray(catalog?.cards) ? catalog.cards : [];
  const sourceEvents = effectiveLearningEvents(events);
  const initialCardsById = Object.fromEntries(cards.map(({ id }) => [id, initialCardState(id)]));
  const eventsByCardId = Object.groupBy(
    sourceEvents.filter(({ cardId }) => typeof cardId === "string"),
    ({ cardId }) => cardId,
  );

  return {
    cardsById: Object.fromEntries(
      cards.map(({ id }) => [
        id,
        foldCardEvents(
          initialCardsById[id],
          eventsByCardId[id] ?? [],
          initialCardsById,
        ),
      ]),
    ),
    ignoredEvents: sourceEvents
      .filter((event) => !applicableBaseline(event, initialCardsById) && !applicableAnswer(event, initialCardsById))
      .map(clone),
  };
};

const migratedCard = (item) => ({
  id: item.id,
  type: item.type,
  item: item.item,
  reading: item.reading ?? null,
  readings: answerList(item.reading, item.readings, item.readingAliases),
  meanings: clone(Array.isArray(item.meanings) ? item.meanings : []),
  meaningAliases: answerList(item.meaningAliases),
  currentForm: item.currentForm ?? null,
  priority: Number(item.priority ?? 0),
  provenance: {
    marumoriKey: item.marumoriKey ?? null,
    marumori: clone(item.marumori ?? {}),
  },
});

const baselineEvent = (item, state, migratedAt) => {
  const interval = marumoriIntervalMs(item.marumori?.level);
  const reviewedAt = validDate(item.marumori?.lastSeenAt) ? new Date(item.marumori.lastSeenAt).toISOString() : null;
  const scheduled = interval !== null && reviewedAt !== null;

  return {
    type: "marumori_baseline",
    cardId: item.id,
    occurredAt: validDate(state.sourceExportedAt) ? new Date(state.sourceExportedAt).toISOString() : migratedAt,
    reviewedAt,
    dueAt: scheduled ? new Date(Date.parse(reviewedAt) + interval).toISOString() : null,
    scheduled,
    marumoriLevel: Number.isInteger(item.marumori?.level) ? item.marumori.level : null,
    provenance: {
      source: "marumori",
      sourceFile: state.sourceFile ?? null,
      sourceExportedAt: state.sourceExportedAt ?? null,
    },
  };
};

const validLegacyEvent = (event, cardIds) =>
  typeof event?.id === "string"
  && cardIds.has(event.id)
  && typeof event.correct === "boolean"
  && validDate(event.reviewedAt);

const migratedLegacyEvent = (event) => ({
  type: "review_answered",
  cardId: event.id,
  occurredAt: new Date(event.reviewedAt).toISOString(),
  correct: event.correct,
  provenance: {
    source: "legacy-review-log",
    legacy: clone(event),
  },
});

export const migrateMarumoriState = (state, legacyEvents = [], now = new Date().toISOString()) => {
  const migratedAt = validDate(now) ? new Date(now).toISOString() : new Date(0).toISOString();
  const sourceItems = Array.isArray(state?.items) ? state.items : [];
  const includedItems = sourceItems
    .filter(({ type }) => type === "kanji" || type === "vocabulary")
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const cardIds = new Set(includedItems.map(({ id }) => id));
  const baselines = includedItems.map((item) => baselineEvent(item, state, migratedAt));
  const sourceLegacyEvents = Array.isArray(legacyEvents) ? legacyEvents : [];
  const validLegacyEvents = sourceLegacyEvents
    .filter((event) => validLegacyEvent(event, cardIds))
    .toSorted((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt));
  const catalog = {
    version: 1,
    generatedAt: migratedAt,
    source: {
      kind: "marumori",
      sourceFile: state?.sourceFile ?? null,
      sourceExportedAt: state?.sourceExportedAt ?? null,
    },
    cards: includedItems.map(migratedCard),
  };

  return {
    catalog,
    events: [...baselines, ...validLegacyEvents.map(migratedLegacyEvent)],
    report: {
      importedCards: includedItems.length,
      scheduledCards: baselines.filter(({ scheduled }) => scheduled).length,
      unscheduledCards: baselines.filter(({ scheduled }) => !scheduled).length,
      excludedGrammar: sourceItems.filter(({ type }) => type === "grammar").length,
      legacyEvents: validLegacyEvents.length,
      ignoredLegacyEvents: sourceLegacyEvents.length - validLegacyEvents.length,
    },
  };
};

export const parseJsonResult = (text, callback) =>
  (Promise.resolve(String(text))
    .then(JSON.parse)
    .then(
      (value) => callback({ ok: true, value }),
      () => callback({ ok: false, error: "Invalid JSON" }),
    ), undefined);

export const parseJsonLinesResult = (text, callback) => {
  const lines = String(text)
    .split(/\r?\n/u)
    .map((value, index) => ({ value, line: index + 1 }))
    .filter(({ value }) => value.trim().length > 0);

  return (Promise.all(
    lines.map(({ value, line }) =>
      Promise.resolve(value).then(
        (json) => ({ ok: true, value: JSON.parse(json), line }),
        () => ({ ok: false, line }),
      ).catch(() => ({ ok: false, line })),
    ),
  ).then((results) => {
    const invalid = results.find(({ ok }) => !ok);
    return callback(
      invalid
        ? { ok: false, error: `Invalid JSON on line ${invalid.line}` }
        : { ok: true, value: results.map(({ value }) => value) },
    );
  }), undefined);
};
