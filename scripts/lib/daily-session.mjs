import { createHash } from "node:crypto";

const asDate = (value) => value instanceof Date ? new Date(value.getTime()) : new Date(value);

const asTime = (value, fallback = Number.POSITIVE_INFINITY) => {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

const lexicographic = (left, right) => String(left).localeCompare(String(right));

const cardsArray = (cards) => Array.isArray(cards) ? cards : cards?.cards ?? [];

const statesArray = (cardStates) => Array.isArray(cardStates)
  ? cardStates
  : Object.values(cardStates?.cardsById ?? cardStates ?? {});

const stateIndex = (cardStates) => Object.fromEntries(
  statesArray(cardStates).map((state) => [state.cardId ?? state.id, state]),
);

const marumori = (card) => card.provenance?.marumori ?? card.marumori ?? {};

const strength = (card, state) => Number.isFinite(Number(state?.fsrs?.stability ?? state?.stability))
  ? Number(state?.fsrs?.stability ?? state?.stability)
  : Number.isFinite(Number(marumori(card).level))
    ? Number(marumori(card).level)
    : Number.POSITIVE_INFINITY;

const isLeech = (card) => Boolean(marumori(card).leech);

const isImported = (card) => Boolean(card.provenance?.marumori || card.marumori);

const isLocalFsrs = (state) => state?.status === "fsrs";

const importedIntervalDays = (state) => {
  const interval = Number(state?.importedIntervalDays);
  return Number.isFinite(interval) && interval > 0 ? interval : null;
};

const overdueIntervals = (state, nowTime) => {
  const interval = importedIntervalDays(state);
  const overdueDays = Math.max(0, nowTime - asTime(state?.dueAt, nowTime)) / (24 * 60 * 60 * 1000);
  return interval === null ? null : overdueDays / interval;
};

const dueComparator = (states, nowTime) => (left, right) =>
  Number(isLocalFsrs(states[right.id])) - Number(isLocalFsrs(states[left.id]))
  || ((overdueIntervals(states[right.id], nowTime) ?? Number.NEGATIVE_INFINITY)
    - (overdueIntervals(states[left.id], nowTime) ?? Number.NEGATIVE_INFINITY))
  || asTime(states[left.id]?.dueAt) - asTime(states[right.id]?.dueAt)
  || strength(left, states[left.id]) - strength(right, states[right.id])
  || Number(isLeech(right)) - Number(isLeech(left))
  || lexicographic(left.id, right.id);

const poolComparator = (states) => (left, right) =>
  strength(left, states[left.id]) - strength(right, states[right.id])
  || Number(isLeech(right)) - Number(isLeech(left))
  || lexicographic(left.id, right.id);

const isDue = (state, nowTime) => Boolean(
  state
  && state.status !== "unscheduled"
  && Number.isFinite(asTime(state.dueAt))
  && asTime(state.dueAt) <= nowTime,
);

const isReactivatableBacklog = (card, state) => Boolean(
  state
  && state.status === "marumori"
  && Number.isFinite(asTime(state.dueAt, Number.NaN))
  && isImported(card),
);

const sessionCard = (source) => (card) => ({
  cardId: card.id,
  type: card.type,
  source,
  promptDirection: "recognition",
});

const hash = (value) => Number.parseInt(
  createHash("sha256").update(value).digest("hex").slice(0, 8),
  16,
);

const withReversePrompts = (studyDay, scheduled) => {
  const vocabulary = scheduled.filter(({ type }) => type === "vocabulary");
  const reverseCount = Math.round(vocabulary.length * 0.1);
  const reverseIds = new Set(
    [...vocabulary]
      .sort((left, right) => hash(`${studyDay}:${left.cardId}`) - hash(`${studyDay}:${right.cardId}`) || lexicographic(left.cardId, right.cardId))
      .slice(0, reverseCount)
      .map(({ cardId }) => cardId),
  );
  return scheduled.map((entry) => ({
    ...entry,
    promptDirection: entry.type === "vocabulary" && reverseIds.has(entry.cardId) ? "reverse" : "recognition",
  }));
};

const presentationOrder = (studyDay, entries) => [...entries]
  .sort((left, right) => hash(`${studyDay}:presentation:${left.cardId}`) - hash(`${studyDay}:presentation:${right.cardId}`)
    || lexicographic(left.cardId, right.cardId))
  .map(({ cardId }) => cardId);

const frozenSession = (events, studyDay) => [...events]
  .filter((event) => event.type === "session_started" && event.studyDate === studyDay)
  .sort((left, right) => asTime(left.occurredAt) - asTime(right.occurredAt))
  .map((event) => event.session)
  .find((session) => session);

const limitWeights = Object.freeze([
  Object.freeze({ bucket: "scheduled", type: "kanji", weight: 25, order: 0 }),
  Object.freeze({ bucket: "scheduled", type: "vocabulary", weight: 50, order: 1 }),
  Object.freeze({ bucket: "reactivations", type: "kanji", weight: 10, order: 2 }),
  Object.freeze({ bucket: "reactivations", type: "vocabulary", weight: 15, order: 3 }),
]);

const positiveCount = (value) => Number.isInteger(value) && value > 0 ? value : 100;

export const defaultBypassMinutes = 240;

const nextStudyDate = (value) => new Date(Date.parse(`${value}T00:00:00.000Z`) + (24 * 60 * 60 * 1000))
  .toISOString()
  .slice(0, 10);

const previousStudyDate = (value) => new Date(Date.parse(`${value}T00:00:00.000Z`) - (24 * 60 * 60 * 1000))
  .toISOString()
  .slice(0, 10);

const uniqueEmergencyUnlocks = (events) => events
  .filter((event) => event.type === "emergency_unlock_granted")
  .toSorted((left, right) => asTime(left.occurredAt) - asTime(right.occurredAt))
  .filter((event, index, unlocks) => unlocks.findIndex(
    (candidate) => candidate.studyDate === event.studyDate,
  ) === index);

export const carryoverForStudyDate = (events = [], targetStudyDate) => ((previousDay) => ((unlock) => ((carryoverCount) => (
  unlock && Number.isInteger(carryoverCount) && carryoverCount > 0
    ? carryoverForStudyDate(events, previousDay) + carryoverCount
    : 0
))(Number(unlock?.carryoverCount)))(uniqueEmergencyUnlocks(events).find(
  (event) => event.studyDate === previousDay && event.targetStudyDate === targetStudyDate,
)))(previousStudyDate(targetStudyDate));

export const dailyLimits = (requiredDailyCount = 100) => ((count) => ((weighted) => ((remaining) => ((allocated) => ({
  scheduled: {
    kanji: allocated.find(({ bucket, type }) => bucket === "scheduled" && type === "kanji")?.count ?? 0,
    vocabulary: allocated.find(({ bucket, type }) => bucket === "scheduled" && type === "vocabulary")?.count ?? 0,
  },
  reactivations: {
    kanji: allocated.find(({ bucket, type }) => bucket === "reactivations" && type === "kanji")?.count ?? 0,
    vocabulary: allocated.find(({ bucket, type }) => bucket === "reactivations" && type === "vocabulary")?.count ?? 0,
  },
}))(weighted.map((entry) => ({
  ...entry,
  count: entry.base + Number(weighted.toSorted(
    (left, right) => right.remainder - left.remainder || left.order - right.order,
  ).findIndex(({ order }) => order === entry.order) < remaining),
}))))(count - weighted.reduce((sum, { base }) => sum + base, 0)))(limitWeights.map((entry) => ((raw) => ({
  ...entry,
  base: Math.floor(raw),
  remainder: raw - Math.floor(raw),
}))(count * entry.weight / 100))))(positiveCount(requiredDailyCount));

export const studyDate = (
  now,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) => new Intl.DateTimeFormat("en-CA", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(asDate(now).getTime() - (4 * 60 * 60 * 1000)));

export const selectDailySession = ({ cards, cardStates, events = [], now, requiredDailyCount = 100, timeZone }) => {
  const studyDay = studyDate(now, timeZone);
  const frozen = frozenSession(events, studyDay);
  const allCards = cardsArray(cards);
  const states = stateIndex(cardStates);
  const nowTime = asDate(now).getTime();
  const limits = dailyLimits(positiveCount(requiredDailyCount) + carryoverForStudyDate(events, studyDay));
  const typePlan = ["kanji", "vocabulary"].map((type) => ({
    type,
    scheduledLimit: limits.scheduled[type],
    reactivationLimit: limits.reactivations[type],
  }));
  const selections = typePlan.map(({ type, scheduledLimit, reactivationLimit }) => {
    const typedCards = allCards.filter((card) => card.type === type);
    const allDue = [...typedCards]
      .filter((card) => isDue(states[card.id], nowTime))
      .sort(dueComparator(states, nowTime));
    const due = allDue.slice(0, scheduledLimit);
    const selectedIds = new Set(due.map(({ id }) => id));
    const remainingDue = allDue.filter((card) => !selectedIds.has(card.id));
    const backlog = [...typedCards]
      .filter((card) => isReactivatableBacklog(card, states[card.id]))
      .filter((card) => !selectedIds.has(card.id))
      .sort(poolComparator(states));
    const backlogIds = new Set(backlog.map(({ id }) => id));
    const reactivations = [
      ...remainingDue.filter((card) => isLocalFsrs(states[card.id])),
      ...backlog,
      ...remainingDue.filter((card) => !isLocalFsrs(states[card.id]) && !backlogIds.has(card.id)),
    ].slice(0, reactivationLimit);
    return {
      scheduled: due.map(sessionCard("due")),
      reactivations: reactivations.map(sessionCard("reactivation")),
    };
  });
  const scheduled = selections.flatMap((selection) => selection.scheduled);
  const reversedScheduled = withReversePrompts(studyDay, scheduled);
  const reactivations = selections.flatMap((selection) => selection.reactivations);
  const generated = {
    sessionVersion: 2,
    studyDate: studyDay,
    startedAt: asDate(now).toISOString(),
    scheduled: reversedScheduled,
    reactivations,
    presentationOrder: presentationOrder(studyDay, [...reversedScheduled, ...reactivations]),
  };
  return frozen ?? generated;
};

const eventStudyDate = (event) => event.studyDate ?? studyDate(event.occurredAt);

const answersFor = (events, session, eventTypes) => events.filter(
  (event) => eventTypes.includes(event.type)
    && eventStudyDate(event) === session.studyDate,
);

const progressFor = (entries, answers) => {
  const ids = entries.map(({ cardId }) => cardId);
  const attempted = ids.filter((cardId) => answers.some((event) => event.cardId === cardId)).length;
  const eventuallyCorrect = ids.filter((cardId) => answers.some((event) => event.cardId === cardId && event.correct === true)).length;
  return {
    required: ids.length,
    attempted,
    eventuallyCorrect,
    accuracy: ids.length === 0 ? 1 : eventuallyCorrect / ids.length,
  };
};

const validSession = (session) => Boolean(
  session
  && typeof session.studyDate === "string"
  && Array.isArray(session.scheduled)
  && Array.isArray(session.reactivations),
);

const errorStatus = (now, message) => ({
  state: "error",
  studyDate: studyDate(now),
  complete: false,
  failOpen: true,
  error: message,
  bypass: null,
  makeupReviews: 0,
  makeupTomorrow: 0,
  progress: {
    scheduled: { required: 0, attempted: 0, eventuallyCorrect: 0, accuracy: 0 },
    reactivations: { required: 0, attempted: 0, eventuallyCorrect: 0, accuracy: 0 },
  },
});

export const deriveDailyStatus = ({ session, events = [], now }) => validSession(session)
  ? (() => {
      const scheduledProgress = progressFor(session.scheduled, answersFor(events, session, ["review_answered"]));
      const reactivationProgress = progressFor(session.reactivations, answersFor(events, session, ["reactivation_answered"]));
      const complete = Number(session.sessionVersion ?? 1) >= 2
        ? scheduledProgress.eventuallyCorrect === scheduledProgress.required
          && reactivationProgress.eventuallyCorrect === reactivationProgress.required
        : scheduledProgress.attempted === scheduledProgress.required
          && scheduledProgress.accuracy >= 0.8
          && reactivationProgress.attempted === reactivationProgress.required;
      const bypass = [...events]
        .filter((event) => ["bypass_started", "emergency_unlock_granted"].includes(event.type)
          && eventStudyDate(event) === session.studyDate)
        .sort((left, right) => asTime(right.expiresAt) - asTime(left.expiresAt))
        .find((event) => asTime(event.expiresAt) > asDate(now).getTime()) ?? null;
      return {
        state: complete ? "complete" : "incomplete",
        studyDate: session.studyDate,
        complete,
        failOpen: false,
        error: null,
        bypass: bypass ? {
          active: true,
          eventType: bypass.type,
          reason: bypass.reason,
          expiresAt: bypass.expiresAt,
        } : null,
        makeupReviews: carryoverForStudyDate(events, session.studyDate),
        makeupTomorrow: carryoverForStudyDate(events, nextStudyDate(session.studyDate)),
        progress: { scheduled: scheduledProgress, reactivations: reactivationProgress },
      };
    })()
  : errorStatus(now, "Daily session is missing or invalid.");

export const createBypassEvent = ({ reason, now, durationMinutes = defaultBypassMinutes }) => String(reason ?? "").trim()
  ? {
      ok: true,
      event: {
        type: "bypass_started",
        studyDate: studyDate(now),
        occurredAt: asDate(now).toISOString(),
        reason: String(reason).trim(),
        durationMinutes,
        expiresAt: new Date(asDate(now).getTime() + (durationMinutes * 60 * 1000)).toISOString(),
      },
    }
  : { ok: false, error: "Bypass reason is required." };

export const createEmergencyUnlockEvent = ({ reason, requiredDailyCount, now, timeZone, durationMinutes = defaultBypassMinutes }) => String(reason ?? "").trim()
  ? ((baseRequiredCount) => ((sourceStudyDate) => ({
      ok: true,
      event: {
        type: "emergency_unlock_granted",
        studyDate: sourceStudyDate,
        targetStudyDate: nextStudyDate(sourceStudyDate),
        occurredAt: asDate(now).toISOString(),
        reason: String(reason).trim(),
        baseRequiredCount,
        carryoverCount: Math.ceil(baseRequiredCount / 2),
        durationMinutes,
        expiresAt: new Date(asDate(now).getTime() + (durationMinutes * 60 * 1000)).toISOString(),
      },
    }))(studyDate(now, timeZone)))(positiveCount(requiredDailyCount))
  : { ok: false, error: "Bypass reason is required." };

export const gateAccess = (status) => status?.state === "error" || status?.failOpen
  ? { allowed: true, reason: "fail_open", expiresAt: null }
  : status?.state === "complete"
    ? { allowed: true, reason: "study_complete", expiresAt: null }
    : status?.bypass?.active
      ? {
          allowed: true,
          reason: status.bypass.eventType === "emergency_unlock_granted" ? "emergency_unlock" : "temporary_bypass",
          expiresAt: status.bypass.expiresAt,
        }
      : { allowed: false, reason: "study_incomplete", expiresAt: null };
