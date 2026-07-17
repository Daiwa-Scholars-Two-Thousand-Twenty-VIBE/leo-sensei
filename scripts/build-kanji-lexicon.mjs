#!/usr/bin/env node

import { buffer } from "node:stream/consumers";
import { gunzipSync } from "node:zlib";

import { parseKanjiLexicon } from "./lib/kanji-lexicon.mjs";

const inputText = (input) => (input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input) : input).toString("utf8");

buffer(process.stdin)
  .then((input) => process.stdout.write(`${JSON.stringify({
    version: 1,
    source: "KANJIDIC2",
    entries: parseKanjiLexicon(inputText(input)),
  })}\n`))
  .catch((inputError) => (process.stderr.write(`${inputError.message}\n`), process.exitCode = 1));
