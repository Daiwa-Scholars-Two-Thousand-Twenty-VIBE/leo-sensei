import assert from "node:assert/strict";
import test from "node:test";

import { parseKanjiLexicon } from "../scripts/lib/kanji-lexicon.mjs";

test("parseKanjiLexicon retains all Japanese readings, English meanings, and the classical radical", () => {
  const lexicon = parseKanjiLexicon(`<kanjidic2><character><literal>腹</literal><radical><rad_value rad_type="classical">130</rad_value></radical><reading_meaning><rmgroup><reading r_type="ja_on">フク</reading><reading r_type="ja_kun">はら</reading><meaning>abdomen</meaning><meaning>belly</meaning><meaning m_lang="fr">ventre</meaning></rmgroup><nanori>はら</nanori></reading_meaning></character></kanjidic2>`);
  assert.deepEqual(lexicon["腹"], { meanings: ["abdomen", "belly"], onReadings: ["フク"], kunReadings: ["はら"], nanoriReadings: ["はら"], radical: "130" });
});
