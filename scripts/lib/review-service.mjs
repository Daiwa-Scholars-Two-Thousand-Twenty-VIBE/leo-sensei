import { deriveDailyStatus, selectDailySession } from "./daily-session.mjs";
import { gradeMeaning, gradeReading, gradeReverseVocabulary, normalizeKana } from "./grading.mjs";
import { effectiveLearningEvents, isLearningAnswerEvent } from "./learner-core.mjs";

const cardsArray = (cards) => (Array.isArray(cards) ? cards : cards?.cards ?? []);

const cardIndex = (cards) => Object.fromEntries(cardsArray(cards).map((card) => [card.id, card]));

const statesArray = (cardStates) => Array.isArray(cardStates)
  ? cardStates
  : Object.values(cardStates?.cardsById ?? cardStates ?? {});

const hasKanji = (value) => /[\u4e00-\u9fff]/u.test(String(value ?? ""));

const eventAliases = (events, cardId, type) => events
  .filter((event) => event.type === type && event.cardId === cardId)
  .map(({ value }) => value);

const acceptedReadings = (card, events = []) => [...new Set([
  ...(Array.isArray(card?.readings) && card.readings.length > 0
    ? card.readings
    : card?.reading
      ? [card.reading]
      : []),
  ...(Array.isArray(card?.readingAliases) ? card.readingAliases : []),
  ...eventAliases(events, card?.id, "reading_alias_added"),
])];

const acceptedMeanings = (card, events = []) => [...new Set([
  ...(Array.isArray(card?.meanings) ? card.meanings : []),
  ...(Array.isArray(card?.meaningAliases) ? card.meaningAliases : []),
  ...eventAliases(events, card?.id, "meaning_alias_added"),
])];

const displayReadings = (readings) => readings.map((reading) => String(reading).replaceAll(".", ""));

const requiresReading = (card) => acceptedReadings(card).length > 0 && hasKanji(card?.item);

const eventStudyDateMatches = (event, session) => event.studyDate === session.studyDate;

const answers = (events, session, type) => events.filter(
  (event) => event.type === type && eventStudyDateMatches(event, session),
);

const attempted = (eventsForType, cardId) => eventsForType.some((event) => event.cardId === cardId);

const eventuallyCorrect = (eventsForType, cardId) => eventsForType.some(
  (event) => event.cardId === cardId && event.correct === true,
);

const eventTime = (event) => Number.isFinite(Date.parse(event.occurredAt))
  ? Date.parse(event.occurredAt)
  : Number.NEGATIVE_INFINITY;

const latestAttemptTime = (eventsForType, cardId) => eventsForType
  .filter((event) => event.cardId === cardId)
  .map(eventTime)
  .reduce((latest, occurredAt) => Math.max(latest, occurredAt), Number.NEGATIVE_INFINITY);

const lessonGroup = (entries, answered) => Array.from(
  { length: Math.ceil(entries.length / 5) },
  (_, index) => entries.slice(index * 5, index * 5 + 5),
).find((group) => group.some(({ cardId }) => !eventuallyCorrect(answered, cardId))) ?? [];

const lessonQueue = (entries, answered) => [
  ...entries.filter(({ cardId }) => !attempted(answered, cardId)),
  ...entries
    .filter(({ cardId }) => attempted(answered, cardId) && !eventuallyCorrect(answered, cardId))
    .toSorted((left, right) => latestAttemptTime(answered, left.cardId) - latestAttemptTime(answered, right.cardId)),
];

const orderedSessionEntries = (session) => {
  const entries = [...session.scheduled, ...session.reactivations];
  const ranks = new Map((session.presentationOrder ?? []).map((cardId, index) => [cardId, index]));
  return entries.toSorted((left, right) =>
    (ranks.get(left.cardId) ?? Number.POSITIVE_INFINITY) - (ranks.get(right.cardId) ?? Number.POSITIVE_INFINITY));
};

const publicQueueCard = (cardsById) => (entry) => ({
  id: entry.cardId,
  type: entry.type,
  ...(entry.promptDirection === "recognition"
    ? { item: cardsById[entry.cardId]?.item ?? entry.cardId }
    : {}),
  prompt:
    entry.promptDirection === "reverse"
      ? cardsById[entry.cardId]?.meanings?.[0] ?? "Meaning"
      : cardsById[entry.cardId]?.item ?? entry.cardId,
  promptDirection: entry.promptDirection,
  requiresReading: entry.promptDirection === "recognition" && requiresReading(cardsById[entry.cardId]),
  source: entry.source,
});

const queuedEntries = ({ session, events, status }) => {
  const scheduledAnswers = answers(events, session, "review_answered");
  const reactivationAnswers = answers(events, session, "reactivation_answered");
  const answersForEntry = (entry) => entry.source === "reactivation" ? reactivationAnswers : scheduledAnswers;
  const strictEntries = orderedSessionEntries(session).filter((entry) => !eventuallyCorrect(answersForEntry(entry), entry.cardId));
  const retryEntries = strictEntries
    .map((entry, index) => ({ entry, index, latestAttempt: latestAttemptTime(answersForEntry(entry), entry.cardId) }))
    .filter(({ entry }) => attempted(answersForEntry(entry), entry.cardId))
    .toSorted((left, right) => left.latestAttempt - right.latestAttempt || left.index - right.index)
    .map(({ entry }) => entry);
  const strictQueue = [
    ...strictEntries.filter((entry) => !attempted(answersForEntry(entry), entry.cardId)),
    ...retryEntries,
  ];
  const scheduled =
    status.progress.scheduled.attempted < status.progress.scheduled.required
      ? session.scheduled.filter(({ cardId }) => !attempted(scheduledAnswers, cardId))
      : status.progress.scheduled.accuracy < 0.8
        ? session.scheduled.filter(({ cardId }) => !eventuallyCorrect(scheduledAnswers, cardId))
        : [];
  const reactivations = session.reactivations.filter(({ cardId }) => !attempted(reactivationAnswers, cardId));
  return status.complete
    ? []
    : Number(session.sessionVersion ?? 1) >= 2
      ? strictQueue
      : [...scheduled, ...reactivations];
};

const dailyResult = ({ cards, events }) => (session) => (status) => ({
  ok: status.state !== "error",
  value: {
    session,
    status,
    queue: queuedEntries({ session, events, status }).map(publicQueueCard(cardIndex(cards))),
  },
  error: status.state === "error" ? status.error : null,
});

export const buildDailyView = ({ cards, cardStates, events = [], now, requiredDailyCount, timeZone }) =>
  ((session) => dailyResult({ cards, events })(session)(deriveDailyStatus({ session, events, now })))(
    selectDailySession({ cards, cardStates, events, now, requiredDailyCount, timeZone }),
  );

const extraEntries = ({ cards, cardStates, session, now, limit }) => {
  const excluded = new Set([...(session?.scheduled ?? []), ...(session?.reactivations ?? [])].map(({ cardId }) => cardId));
  const cardsById = cardIndex(cards);
  return statesArray(cardStates)
    .filter(({ cardId, status, dueAt }) =>
      !excluded.has(cardId) &&
      status !== "unscheduled" &&
      Number.isFinite(Date.parse(dueAt ?? "")) &&
      Date.parse(dueAt) <= Date.parse(now) &&
      ["kanji", "vocabulary"].includes(cardsById[cardId]?.type))
    .toSorted((left, right) =>
      Date.parse(left.dueAt) - Date.parse(right.dueAt) ||
      Number(left.fsrs?.stability ?? left.stability ?? Number.POSITIVE_INFINITY) - Number(right.fsrs?.stability ?? right.stability ?? Number.POSITIVE_INFINITY) ||
      left.cardId.localeCompare(right.cardId))
    .slice(0, Math.max(0, Number(limit) || 0))
    .map(({ cardId }) => ({ cardId, type: cardsById[cardId].type, source: "extra", promptDirection: "recognition" }));
};

export const createExtraSessionEvent = ({ cards, cardStates, session, now, limit = 100 }) => {
  const occurredAt = new Date(now).toISOString();
  const extraSessionId = `extra:${session.studyDate}:${occurredAt}`;
  const entries = extraEntries({ cards, cardStates, session, now, limit });
  return {
    type: "extra_session_started",
    studyDate: session.studyDate,
    occurredAt,
    extraSessionId,
    session: {
      sessionVersion: 1,
      extraSessionId,
      studyDate: session.studyDate,
      startedAt: occurredAt,
      entries,
      presentationOrder: entries.map(({ cardId }) => cardId),
    },
  };
};

export const buildExtraView = ({ cards, cardStates, session, extraSession, events = [], now, limit = 100 }) => {
  const cardsById = cardIndex(cards);
  const entries = extraSession?.entries ?? extraEntries({ cards, cardStates, session, now, limit });
  const answered = extraSession
    ? events.filter((event) => event.type === "extra_review_answered" && event.extraSessionId === extraSession.extraSessionId)
    : [];
  const lesson = Boolean(extraSession?.lesson);
  const activeGroup = lesson ? lessonGroup(entries, answered) : [];
  const queue = (lesson
    ? lessonQueue(activeGroup, answered)
    : entries.filter(({ cardId }) => !attempted(answered, cardId)))
    .map(publicQueueCard(cardsById));
  return {
    extraSessionId: extraSession?.extraSessionId ?? null,
    lesson,
    presentationOrder: extraSession?.presentationOrder ?? [],
    required: entries.length,
    reviewed: lesson
      ? entries.filter(({ cardId }) => eventuallyCorrect(answered, cardId)).length
      : entries.length - queue.length,
    lessonGroup: lesson
      ? {
          index: activeGroup.length === 0 ? Math.ceil(entries.length / 5) : Math.floor(entries.indexOf(activeGroup[0]) / 5),
          total: Math.ceil(entries.length / 5),
          cardIds: activeGroup.map(({ cardId }) => cardId),
        }
      : null,
    queue,
  };
};

const sessionEntry = (session, cardId) =>
  session.scheduled.find((entry) => entry.cardId === cardId) ??
  session.reactivations.find((entry) => entry.cardId === cardId) ??
  null;

const recognitionGrade = (card, input) => {
  const reading = requiresReading(card)
    ? gradeReading(input.readingAnswer, acceptedReadings(card))
    : { correct: true, normalizedAnswer: "" };
  const meaning = gradeMeaning(input.meaningAnswer, acceptedMeanings(card));
  return { correct: reading.correct && meaning.correct, reading, meaning };
};

const reverseGrade = (card, input) => ({
  correct: gradeReverseVocabulary(input.reverseAnswer, card.item, acceptedReadings(card)).correct,
  reading: { correct: true, normalizedAnswer: "" },
  meaning: { correct: true, score: 1, matchedMeaning: card.meanings?.[0] ?? null },
});

const answerEventType = (source) => ({
  reactivation: "reactivation_answered",
  extra: "extra_review_answered",
}[source] ?? "review_answered");

const successfulReview = ({ card, entry, eventId, events = [], input, now, studyDay }) => {
  const reviewCard = {
    ...card,
    readings: acceptedReadings(card, events),
    meanings: acceptedMeanings(card, events),
  };
  const grade = entry.promptDirection === "reverse" ? reverseGrade(reviewCard, input) : recognitionGrade(reviewCard, input);
  const event = {
    type: answerEventType(entry.source),
    ...(eventId ? { eventId } : {}),
    studyDate: studyDay,
    occurredAt: new Date(now).toISOString(),
    cardId: card.id,
    correct: grade.correct,
    readingCorrect: grade.reading.correct,
    meaningCorrect: grade.meaning.correct,
    promptDirection: entry.promptDirection,
    answers: {
      reading: input.readingAnswer ?? null,
      meaning: input.meaningAnswer ?? null,
      reverse: input.reverseAnswer ?? null,
    },
  };
  return {
    ok: true,
    value: {
      event,
      feedback: {
        answerEventId: event.eventId ?? null,
        correct: grade.correct,
        readingCorrect: grade.reading.correct,
        meaningCorrect: grade.meaning.correct,
        submittedReading: input.readingAnswer ?? null,
        submittedMeaning: input.meaningAnswer ?? null,
        submittedReverse: input.reverseAnswer ?? null,
        expectedReading: displayReadings(acceptedReadings(card, events)).join("; ") || null,
        expectedMeanings: acceptedMeanings(card, events),
        expectedSurface: card.item,
      },
    },
  };
};

export const createReviewEvent = ({ cards, session, eventId, events = [], input, now }) =>
  cardIndex(cards)[input?.cardId] && sessionEntry(session, input?.cardId)
    ? successfulReview({
        card: cardIndex(cards)[input.cardId],
        entry: sessionEntry(session, input.cardId),
        eventId,
        events,
        input,
        now,
        studyDay: session.studyDate,
      })
    : { ok: false, error: "Card is not part of today's required session." };

export const createReadingCheck = ({ cards, events = [], input }) => {
  const card = cardIndex(cards)[input?.cardId];
  return card && requiresReading(card)
    ? {
        ok: true,
        value: gradeReading(input?.readingAnswer, acceptedReadings(card, events)),
      }
    : { ok: false, error: "A known card with a reading is required." };
};

export const createExtraReviewEvent = ({ cards, eventId, events = [], extraSession, input, studyDate, now }) =>
  cardIndex(cards)[input?.cardId]
    && (!extraSession || extraSession.entries.some(({ cardId }) => cardId === input.cardId))
    ? ((review) => extraSession
        ? { ...review, value: { ...review.value, event: { ...review.value.event, extraSessionId: extraSession.extraSessionId } } }
        : review)(
        successfulReview({
            card: cardIndex(cards)[input.cardId],
            entry: {
              cardId: input.cardId,
              type: cardIndex(cards)[input.cardId].type,
              source: "extra",
              promptDirection: "recognition",
            },
            eventId,
            events,
            input,
            now,
            studyDay: studyDate,
          }),
      )
    : { ok: false, error: "Card is not part of this extra-review batch." };

const latestAnswerForStudyDay = (events, studyDate) => effectiveLearningEvents(events)
  .filter((event) => isLearningAnswerEvent(event) && event.studyDate === studyDate)
  .at(-1) ?? null;

export const createRedoEvent = ({ events = [], input, studyDate, now }) =>
  ((target) => target?.eventId && target.eventId === input?.answerEventId
    ? {
        ok: true,
        value: {
          event: {
            type: "review_answer_voided",
            studyDate,
            occurredAt: new Date(now).toISOString(),
            targetEventId: target.eventId,
            cardId: target.cardId,
            targetType: target.type,
            ...(target.extraSessionId ? { extraSessionId: target.extraSessionId } : {}),
          },
          target,
        },
      }
    : {
        ok: false,
        conflict: true,
        error: "Only the latest recorded answer can be redone.",
      })(latestAnswerForStudyDay(events, studyDate));

const aliasEventType = (kind) => ({
  meaning: "meaning_alias_added",
  reading: "reading_alias_added",
}[kind] ?? null);

export const createAnswerAliasEvent = ({ cards, input, studyDate, now = new Date().toISOString() }) => {
  const card = cardIndex(cards)[input?.cardId];
  const type = aliasEventType(input?.kind);
  const rawValue = String(input?.value ?? "").trim();
  const value = input?.kind === "reading" ? normalizeKana(rawValue) : rawValue;
  return card && type && value
    ? {
        ok: true,
        value: {
          event: {
            type,
            studyDate,
            occurredAt: new Date(now).toISOString(),
            cardId: card.id,
            value,
          },
        },
      }
    : { ok: false, error: "A known card, alias kind, and non-empty answer are required." };
};
