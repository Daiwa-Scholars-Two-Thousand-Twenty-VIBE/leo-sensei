import assert from "node:assert/strict";
import test from "node:test";

import { gradeMeaning, gradeReading, gradeReverseVocabulary, normalizeKana } from "../scripts/lib/grading.mjs";

test("normalizeKana folds katakana, width, and whitespace into hiragana", () =>
  assert.equal(normalizeKana(" オウ ボ "), "おうぼ"));

test("normalizeKana commits a trailing romaji n as ん", () => {
  assert.equal(normalizeKana("ごしゅじn"), "ごしゅじん");
  assert.equal(gradeReading("ごしゅじn", ["ごしゅじん"]).correct, true);
});

test("gradeReading accepts one of several normalized readings", () =>
  assert.deepEqual(gradeReading("マねく", "まねく; しょう"), {
    correct: true,
    normalizedAnswer: "まねく",
  }));

test("gradeReading accepts arrays and KANJIDIC okurigana stems", () => {
  assert.equal(gradeReading("いた", ["つう", "いた.む", "いた.い"]).correct, true);
  assert.equal(gradeReading("いたむ", ["つう", "いた.む", "いた.い"]).correct, true);
  assert.equal(gradeReading("つ", ["つう", "いた.む", "いた.い"]).correct, false);
});

test("gradeMeaning accepts a close spelling error for a meaningful token", () =>
  assert.equal(gradeMeaning("aplication", ["application", "subscription"]).correct, true));

test("gradeMeaning ignores missing spaces inside an expected phrase", () => {
  assert.equal(gradeMeaning("richperson", ["rich person", "wealthy individual"]).correct, true);
  assert.equal(gradeMeaning("richpersom", ["rich person", "wealthy individual"]).correct, true);
});

test("gradeMeaning accepts a core meaning without its parenthetical qualifier", () => {
  assert.equal(
    gradeMeaning("to decrease", ["to decrease (in size or number)", "to diminish", "to abate"]).correct,
    true,
  );
});

test("gradeMeaning rejects empty and unrelated answers", () =>
  ["", "thing", "banana"].map((answer) =>
    assert.equal(gradeMeaning(answer, ["application", "subscription"]).correct, false)));

test("gradeReverseVocabulary requires the normalized Japanese surface form", () => {
  assert.equal(gradeReverseVocabulary("応募", "応募").correct, true);
  assert.equal(gradeReverseVocabulary("申し込み", "応募").correct, false);
});
