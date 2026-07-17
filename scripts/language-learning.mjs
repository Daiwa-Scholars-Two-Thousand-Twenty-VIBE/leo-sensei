#!/usr/bin/env node

import { join } from "node:path";

import { loadDailyContext } from "./lib/runtime.mjs";

const home = process.env.HOME ?? ".";
const dataHome = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
const stateDir = process.env.LEARNER_STATE_DIR ?? join(dataHome, "leo-sensei-no-nonsense-nihongo");
const catalogFile = process.env.LEARNER_CATALOG_FILE ?? join(stateDir, "catalog.json");
const eventsFile = process.env.LEARNER_EVENTS_FILE ?? join(stateDir, "events.jsonl");
const settingsFile = process.env.LEARNER_SETTINGS_FILE ?? join(stateDir, "settings.json");
const now = process.env.LANGUAGE_NOW ?? new Date().toISOString();
const command = process.argv[2] ?? "status";
const json = process.argv.includes("--json");

const statusPayload = (context) => ({
  studyDate: context.status.studyDate,
  complete: context.status.complete,
  accessAllowed: context.access.allowed,
  accessReason: context.access.reason,
  bypassUntil: context.access.expiresAt,
  failOpen: context.status.failOpen,
  error: context.status.error,
  progress: context.status.progress,
});

const print = (payload) => console.log(json ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));

const status = () => loadDailyContext({ catalogFile, eventsFile, settingsFile, now }, (result) =>
  result.ok
    ? (print(statusPayload(result.value)), process.exitCode = result.value.status.complete ? 0 : 1)
    : (
        print({ complete: false, accessAllowed: true, accessReason: "fail_open", bypassUntil: null, failOpen: true, error: result.error }),
        process.exitCode = 2
      ));

command === "status"
  ? status()
  : (console.error(`Unknown command: ${command}`), process.exitCode = 2);
