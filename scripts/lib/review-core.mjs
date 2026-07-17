import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const defaultStateFile = "data/learner-state/items.json";
export const defaultLogFile = "data/learner-state/review-log.jsonl";

export const normalizeEnglish = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b(a|an|the|to|be|being|of|as)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (value) => normalizeEnglish(value).split(/\s+/).filter(Boolean);

const levenshtein = (a, b) => {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
};

const tokenMatches = (answerToken, expectedToken) => {
  if (answerToken === expectedToken) return true;
  if (answerToken.length < 4 || expectedToken.length < 4) return false;
  const distance = levenshtein(answerToken, expectedToken);
  return distance <= Math.max(1, Math.floor(expectedToken.length * 0.2));
};

export const gradeAnswer = (answer, meanings) => {
  const answerTokens = tokens(answer);
  if (answerTokens.length === 0) {
    return { correct: false, score: 0, matchedMeaning: null };
  }

  let best = { correct: false, score: 0, matchedMeaning: null };

  for (const meaning of meanings) {
    const expectedTokens = tokens(meaning).filter((token) => token.length > 2);
    if (expectedTokens.length === 0) continue;

    const matched = expectedTokens.filter((expected) => answerTokens.some((answerToken) => tokenMatches(answerToken, expected)));
    const score = matched.length / expectedTokens.length;
    const shortMeaning = expectedTokens.length <= 2;
    const correct = shortMeaning ? score >= 0.5 : score >= 0.6;

    if (score > best.score) {
      best = { correct, score, matchedMeaning: meaning };
    }
  }

  return best;
};

export const normalizeKana = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[ァ-ン]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));

export const gradeReading = (answer, expectedReading) => {
  if (!expectedReading) {
    return { required: false, correct: true, normalizedAnswer: normalizeKana(answer), expectedReading: null };
  }

  const normalizedAnswer = normalizeKana(answer);
  const expectedReadings = String(expectedReading)
    .split(/[;、,]/)
    .map(normalizeKana)
    .filter(Boolean);

  return {
    required: true,
    correct: expectedReadings.includes(normalizedAnswer),
    normalizedAnswer,
    expectedReading,
  };
};

export const hasKanji = (value) => /[\u4e00-\u9fff]/u.test(String(value ?? ""));

export const requiresReadingReview = (item) =>
  Boolean(item.reading && (item.type === "kanji" || (item.type === "vocabulary" && hasKanji(item.item))));

export const nextSchedule = (item, correct, now) => {
  const local = item.localSrs ?? {};
  const previousInterval = Number(local.intervalDays ?? 0);
  const correctStreak = correct ? Number(local.correctStreak ?? 0) + 1 : 0;
  const wrongStreak = correct ? 0 : Number(local.wrongStreak ?? 0) + 1;

  let intervalDays;
  if (!correct) {
    intervalDays = wrongStreak >= 2 ? 0 : 1;
  } else if (previousInterval <= 0) {
    intervalDays = 1;
  } else {
    intervalDays = Math.ceil(previousInterval * (1.8 + Math.min(correctStreak, 5) * 0.25));
  }

  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + intervalDays);

  return {
    intervalDays,
    dueAt: due.toISOString(),
    correctStreak,
    wrongStreak,
    localReviewCount: Number(local.localReviewCount ?? 0) + 1,
    localWrongCount: Number(local.localWrongCount ?? 0) + (correct ? 0 : 1),
    lastReviewedAt: now.toISOString(),
  };
};

export const readState = async (stateFile = defaultStateFile) => JSON.parse(await readFile(stateFile, "utf8"));

export const writeState = async (state, stateFile = defaultStateFile) => {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

export const dueItems = (items, { limit = 10, type } = {}) => {
  const now = Date.now();
  return items
    .filter((item) => !type || item.type === type)
    .filter((item) => Date.parse(item.localSrs?.dueAt ?? "1970-01-01T00:00:00.000Z") <= now)
    .sort((a, b) => {
      const aDue = Date.parse(a.localSrs?.dueAt ?? "1970-01-01T00:00:00.000Z");
      const bDue = Date.parse(b.localSrs?.dueAt ?? "1970-01-01T00:00:00.000Z");
      return b.priority - a.priority || aDue - bDue;
    })
    .slice(0, limit);
};

export const promptForItem = (item) => {
  const label = item.type === "grammar" ? "Grammar" : item.type === "kanji" ? "Kanji" : "Vocabulary";
  return `${label}: ${item.item}`;
};

export const publicItem = (item) => ({
  id: item.id,
  type: item.type,
  item: item.item,
  requiresReading: requiresReadingReview(item),
  marumori: item.marumori,
  localSrs: item.localSrs,
  priority: item.priority,
  prompt: promptForItem(item),
});

export const stateStats = (state) => {
  const now = Date.now();
  const due = state.items.filter((item) => Date.parse(item.localSrs?.dueAt ?? "1970-01-01T00:00:00.000Z") <= now);
  return {
    generatedAt: state.generatedAt,
    updatedAt: state.updatedAt,
    sourceExportedAt: state.sourceExportedAt,
    counts: state.counts,
    due: {
      total: due.length,
      grammar: due.filter((item) => item.type === "grammar").length,
      kanji: due.filter((item) => item.type === "kanji").length,
      vocabulary: due.filter((item) => item.type === "vocabulary").length,
    },
  };
};

export const reviewItem = async ({
  state,
  itemId,
  answer,
  meaningAnswer,
  readingAnswer,
  stateFile = defaultStateFile,
  logFile = defaultLogFile,
}) => {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new Error(`Unknown item id: ${itemId}`);
  }

  const meaningResult = gradeAnswer(meaningAnswer ?? answer, item.meanings);
  const expectedReading = requiresReadingReview(item) ? item.reading : null;
  const readingResult = gradeReading(readingAnswer, expectedReading);
  const correct = meaningResult.correct && readingResult.correct;
  const now = new Date();
  item.localSrs = nextSchedule(item, correct, now);
  state.updatedAt = now.toISOString();

  const logEntry = {
    reviewedAt: now.toISOString(),
    id: item.id,
    type: item.type,
    item: item.item,
    readingAnswer: readingAnswer ?? null,
    meaningAnswer: meaningAnswer ?? answer,
    correct,
    readingCorrect: readingResult.correct,
    meaningCorrect: meaningResult.correct,
    score: Number(meaningResult.score.toFixed(3)),
    matchedMeaning: meaningResult.matchedMeaning,
    expectedReading,
    expectedMeanings: item.meanings,
    nextDueAt: item.localSrs.dueAt,
  };

  await mkdir(dirname(logFile), { recursive: true });
  await appendFile(logFile, `${JSON.stringify(logEntry)}\n`, "utf8");
  await writeState(state, stateFile);

  return {
    ...logEntry,
    item: publicItem(item),
  };
};
