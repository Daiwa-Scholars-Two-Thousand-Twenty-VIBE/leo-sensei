import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildJlptDeck } from "../scripts/lib/jlpt-deck.mjs";

const source = Object.freeze({
  name: "open-anki-jlpt-decks",
  repository: "https://github.com/jamsinclair/open-anki-jlpt-decks",
  commit: "1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0",
  license: "MIT",
});

test("buildJlptDeck converts pinned source CSV into immutable vocabulary cards", () => {
  const result = buildJlptDeck({
    level: "N5",
    source,
    csv: "expression,reading,meaning,tags,guid\n会う,あう,\"to meet, to see\",JLPT_N5,kupB\n青,あお,blue,JLPT_N5,blue-1\n",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.id, "n5-vocabulary");
  assert.equal(result.value.unofficial, true);
  assert.deepEqual(result.value.cards[0].meanings, ["to meet", "to see"]);
  assert.deepEqual(result.value.cards[0].provenance.jlpt, {
    deckIds: ["n5-vocabulary"],
    baselineKnown: false,
    sourceGuid: "kupB",
  });
  assert.equal(Object.isFrozen(result.value.cards), true);
});

test("buildJlptDeck rejects unsupported levels and malformed source rows", () => {
  assert.equal(buildJlptDeck({ level: "N0", source, csv: "" }).ok, false);
  assert.equal(buildJlptDeck({ level: "N5", source, csv: "expression,reading,meaning,tags,guid\n会う,,meet,JLPT_N5,id\n" }).ok, false);
});

test("bundled manifest pins source identity, card counts, and generated hashes", () => {
  const manifest = JSON.parse(readFileSync(new URL("../decks/manifest.json", import.meta.url), "utf8"));

  assert.equal(manifest.source.commit, source.commit);
  assert.equal(manifest.source.license, "MIT");
  assert.deepEqual(manifest.decks.map(({ level, cards }) => [level, cards]), [
    ["N5", 718],
    ["N4", 668],
    ["N3", 2140],
    ["N2", 1906],
    ["N1", 2699],
  ]);
  assert.equal(manifest.decks.every((entry) => ((contents) => (
    JSON.parse(contents).cards.length === entry.cards
    && createHash("sha256").update(contents).digest("hex") === entry.sha256
  ))(readFileSync(new URL(`../decks/${entry.file}`, import.meta.url)))), true);
});
