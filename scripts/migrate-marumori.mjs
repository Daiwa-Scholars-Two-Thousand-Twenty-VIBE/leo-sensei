#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs";
import { dirname } from "node:path";

import { migrateMarumoriState, parseJsonLinesResult, parseJsonResult } from "./lib/learner-core.mjs";

const optionNames = new Set(["--state", "--legacy-log", "--catalog-out", "--events-out", "--now"]);
const ok = (value) => ({ ok: true, value });
const error = (message) => ({ ok: false, error: message });

const parseOptions = (args, index = 0, options = {}) =>
  index >= args.length
    ? ok(options)
    : optionNames.has(args[index])
      ? index + 1 < args.length
        ? parseOptions(args, index + 2, { ...options, [args[index].slice(2)]: args[index + 1] })
        : error(`Missing value for ${args[index]}`)
      : error(`Unknown option: ${args[index]}`);

const fail = (message, code = 2) => (console.error(message), process.exitCode = code, null);

const readText = (path, callback) =>
  readFile(path ?? 0, "utf8", (readError, text) =>
    callback(readError ? error(readError.message) : ok(text)));

const writeText = (path, text, callback) =>
  mkdir(dirname(path), { recursive: true }, (mkdirError) =>
    mkdirError
      ? callback(error(mkdirError.message))
      : writeFile(path, text, "utf8", (writeError) =>
          callback(writeError ? error(writeError.message) : ok(path))));

const emitMigration = (migration, options) =>
  options["catalog-out"]
    ? writeText(options["catalog-out"], `${JSON.stringify(migration.catalog, null, 2)}\n`, (catalogResult) =>
        catalogResult.ok
          ? writeText(
              options["events-out"],
              `${migration.events.map((event) => JSON.stringify(event)).join("\n")}${migration.events.length > 0 ? "\n" : ""}`,
              (eventsResult) =>
                eventsResult.ok
                  ? console.log(JSON.stringify({ ...migration.report, catalogFile: catalogResult.value, eventsFile: eventsResult.value }))
                  : fail(eventsResult.error, 1),
            )
          : fail(catalogResult.error, 1),
      )
    : console.log(JSON.stringify(migration, null, 2));

const migrateText = (stateText, legacyText, options) =>
  parseJsonResult(stateText, (stateResult) =>
    stateResult.ok
      ? parseJsonLinesResult(legacyText, (legacyResult) =>
          legacyResult.ok
            ? emitMigration(
                migrateMarumoriState(stateResult.value, legacyResult.value, options.now ?? new Date().toISOString()),
                options,
              )
            : fail(legacyResult.error))
      : fail(stateResult.error));

const loadInputs = (options) =>
  readText(options.state, (stateResult) =>
    stateResult.ok
      ? options["legacy-log"]
        ? readText(options["legacy-log"], (legacyResult) =>
            legacyResult.ok
              ? migrateText(stateResult.value, legacyResult.value, options)
              : fail(legacyResult.error, 1))
        : migrateText(stateResult.value, "", options)
      : fail(stateResult.error, 1));

const validOutputPair = (options) => Boolean(options["catalog-out"]) === Boolean(options["events-out"]);
const main = () => {
  const optionsResult = parseOptions(process.argv.slice(2));
  return optionsResult.ok
    ? validOutputPair(optionsResult.value)
      ? loadInputs(optionsResult.value)
      : fail("Provide both --catalog-out and --events-out, or neither")
    : fail(optionsResult.error);
};

main();
