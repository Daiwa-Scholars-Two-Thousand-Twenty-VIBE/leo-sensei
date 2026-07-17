#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  defaultLogFile,
  defaultStateFile,
  dueItems,
  promptForItem,
  readState,
  requiresReadingReview,
  reviewItem,
} from "./lib/review-core.mjs";

const stateFile = process.env.LEARNER_STATE_FILE ?? defaultStateFile;
const logFile = process.env.REVIEW_LOG_FILE ?? defaultLogFile;

const args = new Map(
  process.argv.slice(2).flatMap((arg, index, all) => {
    if (!arg.startsWith("--")) return [];
    const [key, inlineValue] = arg.slice(2).split("=");
    const next = all[index + 1];
    const value = inlineValue ?? (next && !next.startsWith("--") ? next : "true");
    return [[key, value]];
  }),
);

const limit = Number.parseInt(args.get("limit") ?? "10", 10);
const typeFilter = args.get("type");
const dryRun = args.get("dry-run") === "true";

const main = async () => {
  const state = await readState(stateFile);
  const queue = dueItems(state.items, { limit, type: typeFilter });

  if (queue.length === 0) {
    console.log("No due cards. Run normalize or lower the due filter later.");
    return;
  }

  if (dryRun) {
    for (const item of queue) {
      console.log(`${promptForItem(item)} -> ${item.meanings.join("; ")} [priority ${item.priority}]`);
    }
    return;
  }

  const pipedAnswers = input.isTTY ? null : (await readFile("/dev/stdin", "utf8")).split(/\r?\n/);
  const rl = input.isTTY ? createInterface({ input, output }) : null;

  for (const item of queue) {
    console.log("");
    console.log(promptForItem(item));
    const requiresReading = requiresReadingReview(item);
    const readingAnswer =
      requiresReading && pipedAnswers === null
        ? await rl.question("Reading (hiragana): ")
        : requiresReading
          ? (console.log("Reading (hiragana): " + (pipedAnswers[0] ?? "")), pipedAnswers.shift() ?? "")
          : undefined;
    const meaningAnswer =
      pipedAnswers === null
        ? await rl.question("English meaning: ")
        : (console.log("English meaning: " + (pipedAnswers[0] ?? "")), pipedAnswers.shift() ?? "");
    const result = await reviewItem({ state, itemId: item.id, readingAnswer, meaningAnswer, stateFile, logFile });

    if (result.correct) {
      console.log(`Correct. Next due: ${result.nextDueAt.slice(0, 10)}`);
    } else {
      if (requiresReading && !result.readingCorrect) {
        console.log(`Reading expected: ${result.expectedReading}`);
      }
      console.log(`Incorrect. Expected: ${result.expectedMeanings.join("; ")}`);
      console.log(`Next due: ${result.nextDueAt.slice(0, 10)}`);
    }
  }

  rl?.close();
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
