import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runStatus = ({ catalog, events }) => {
  const directory = mkdtempSync(join(tmpdir(), "language-status-"));
  const catalogFile = join(directory, "catalog.json");
  const eventsFile = join(directory, "events.jsonl");
  writeFileSync(catalogFile, catalog);
  writeFileSync(eventsFile, events);
  const result = spawnSync(process.execPath, ["scripts/language-learning.mjs", "status", "--json"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, LEARNER_CATALOG_FILE: catalogFile, LEARNER_EVENTS_FILE: eventsFile, LANGUAGE_NOW: "2026-07-15T01:00:00.000Z" },
  });
  rmSync(directory, { recursive: true, force: true });
  return result;
};

test("status CLI exits one for valid incomplete study and emits gate JSON", () => {
  const catalog = JSON.stringify({ version: 1, cards: [{ id: "k-1", type: "kanji", item: "招", reading: "まねく", meanings: ["beckon"], provenance: { marumori: { level: 4 } } }] });
  const events = `${JSON.stringify({ type: "marumori_baseline", cardId: "k-1", occurredAt: "2026-07-01T00:00:00.000Z", reviewedAt: "2026-07-01T00:00:00.000Z", dueAt: "2026-07-02T00:00:00.000Z", scheduled: true })}\n`;
  const result = runStatus({ catalog, events });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.complete, false);
  assert.equal(payload.accessAllowed, false);
  assert.equal(payload.studyDate, "2026-07-15");
});

test("status CLI fails open with exit two for invalid learner data", () => {
  const result = runStatus({ catalog: "{", events: "" });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 2);
  assert.equal(payload.complete, false);
  assert.equal(payload.accessAllowed, true);
  assert.equal(payload.failOpen, true);
});
