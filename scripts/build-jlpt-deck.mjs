#!/usr/bin/env node

import { text } from "node:stream/consumers";

import { buildJlptDeck } from "./lib/jlpt-deck.mjs";

const source = Object.freeze({
  name: "open-anki-jlpt-decks",
  repository: "https://github.com/jamsinclair/open-anki-jlpt-decks",
  commit: "1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0",
  license: "MIT",
  copyright: "Copyright (c) 2020 Jamie Sinclair",
});

const optionValue = (name) => process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1)
  ?? process.argv[process.argv.indexOf(name) + 1];

text(process.stdin)
  .then((csv) => buildJlptDeck({ csv, level: optionValue("--level"), source }))
  .then((result) => result.ok
    ? process.stdout.write(`${JSON.stringify(result.value)}\n`)
    : (process.stderr.write(`${result.error}\n`), process.exitCode = 1))
  .catch((buildError) => (process.stderr.write(`${buildError.message}\n`), process.exitCode = 1));
