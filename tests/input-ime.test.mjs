import assert from "node:assert/strict";
import test from "node:test";

import { toHiragana } from "wanakana";

test("WanaKana converts ordinary romaji input to hiragana", () => {
  assert.equal(toHiragana("itamu"), "いたむ");
  assert.equal(toHiragana("tsuu"), "つう");
});
