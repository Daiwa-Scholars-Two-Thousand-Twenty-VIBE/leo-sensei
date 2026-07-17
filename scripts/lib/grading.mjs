export const normalizeEnglish = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9\s-]/gu, " ")
    .replace(/\b(a|an|the|to|be|being|of|as)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

export const normalizeKana = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, "")
    .replace(/n$/iu, "ん")
    .replace(/[ァ-ヶ]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));

const flattenAnswerValues = (value) => Array.isArray(value) ? value.flatMap(flattenAnswerValues) : [value];

const normalizeReadingEntry = (value) => normalizeKana(value).replace(/^[-]/u, "").replace(/[-]$/u, "");

const readingVariants = (value) =>
  String(value ?? "")
    .split(/[;,、/]/u)
    .map(normalizeReadingEntry)
    .flatMap((normalized) => normalized.includes(".")
      ? [normalized.replaceAll(".", ""), normalized.split(".")[0]]
      : [normalized])
    .filter(Boolean);

const englishTokens = (value) => normalizeEnglish(value).split(/\s+/u).filter(Boolean);

const compactEnglish = (value) => normalizeEnglish(value).replace(/[\s-]+/gu, "");

const meaningVariants = (meaning) => ((source) => [...new Set([
  source,
  /^\s*\(/u.test(source)
    ? source
    : source.replace(/\s*\([^)]*\)/gu, " ").replace(/\s+/gu, " ").trim(),
])].filter(Boolean))(String(meaning ?? ""));

const levenshtein = (left, right) =>
  [...left].reduce(
    (previousRow, leftCharacter, leftIndex) =>
      [...right].reduce(
        (row, rightCharacter, rightIndex) => [
          ...row,
          Math.min(
            previousRow[rightIndex + 1] + 1,
            row[rightIndex] + 1,
            previousRow[rightIndex] + (leftCharacter === rightCharacter ? 0 : 1),
          ),
        ],
        [leftIndex + 1],
      ),
    Array.from({ length: right.length + 1 }, (_, index) => index),
  )[right.length];

const tokenMatches = (answerToken, expectedToken) =>
  answerToken === expectedToken
    ? true
    : answerToken.length < 4 || expectedToken.length < 4
      ? false
      : levenshtein(answerToken, expectedToken) <= Math.max(1, Math.floor(expectedToken.length * 0.2));

const gradeExpectedMeaning = (answer) => (meaning) => ({
  ...englishTokens(meaning)
    .filter((token) => token.length > 2)
    .map((expectedToken, _, expectedTokens) => ({
      expectedTokens,
      matched: englishTokens(answer).some((answerToken) => tokenMatches(answerToken, expectedToken)),
    }))
    .reduce(
      (result, { expectedTokens, matched }) => ({
        expectedTokens,
        matchedCount: result.matchedCount + Number(matched),
      }),
      { expectedTokens: [], matchedCount: 0 },
    ),
  compactMatched: tokenMatches(compactEnglish(answer), compactEnglish(meaning)),
});

export const gradeMeaning = (answer, meanings) =>
  englishTokens(answer).length === 0
    ? { correct: false, score: 0, matchedMeaning: null }
    : meanings
        .flatMap((meaning) => meaningVariants(meaning).map((variant) => ({
          meaning,
          ...gradeExpectedMeaning(answer)(variant),
        })))
        .map(({ meaning, expectedTokens, matchedCount, compactMatched }) => ({
          correct:
            compactMatched ||
            (expectedTokens.length > 0 &&
              matchedCount / expectedTokens.length >= (expectedTokens.length <= 2 ? 0.5 : 0.6)),
          score: compactMatched ? 1 : expectedTokens.length === 0 ? 0 : matchedCount / expectedTokens.length,
          matchedMeaning: meaning,
        }))
        .reduce(
          (best, candidate) => (candidate.score > best.score ? candidate : best),
          { correct: false, score: 0, matchedMeaning: null },
        );

export const gradeReading = (answer, expectedReadings) => ({
  correct: flattenAnswerValues(expectedReadings).flatMap(readingVariants).includes(normalizeKana(answer)),
  normalizedAnswer: normalizeKana(answer),
});

const normalizeJapaneseSurface = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, "").trim();

export const gradeReverseVocabulary = (answer, expectedSurface, expectedReadings = []) => ({
  correct:
    normalizeJapaneseSurface(answer) === normalizeJapaneseSurface(expectedSurface) ||
    gradeReading(answer, expectedReadings).correct,
  normalizedAnswer: normalizeJapaneseSurface(answer),
});
