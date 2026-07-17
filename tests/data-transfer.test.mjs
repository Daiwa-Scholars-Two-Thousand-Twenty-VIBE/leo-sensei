import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createBackup,
  importDelimitedCatalog,
  mergeCatalogImport,
  restoreBackup,
  validateBackup,
} from "../scripts/lib/data-transfer.mjs";
import { defaultLearnerSettings } from "../scripts/lib/settings-core.mjs";

const state = () => ({
  settings: { ...defaultLearnerSettings(), onboardingComplete: true },
  catalog: { version: 1, cards: [{ id: "existing", type: "kanji", item: "日", readings: ["にち"], meanings: ["day"] }] },
  customLists: [{ id: "custom-existing", label: "Existing", cardIds: ["existing"] }],
  events: [{ type: "review_answered", cardId: "existing", occurredAt: "2026-07-15T00:00:00.000Z", correct: true }],
});

test("backup is a versioned immutable snapshot that round-trips all learner data", () => {
  const input = state();
  const backup = createBackup({ ...input, exportedAt: "2026-07-16T00:00:00.000Z" });
  const validated = validateBackup(JSON.parse(JSON.stringify(backup)));

  assert.equal(validated.ok, true);
  assert.deepEqual(validated.value, backup);
  assert.equal(Object.isFrozen(backup), true);
  assert.equal(Object.isFrozen(backup.events), true);
  assert.equal(backup.version, 1);
});

test("backup validation rejects malformed state before restore", () => {
  assert.equal(validateBackup({ version: 1, catalog: { version: 1, cards: [] }, customLists: [], events: [] }).ok, false);
  assert.equal(validateBackup({ version: 1, settings: { requiredDailyCount: 0 }, catalog: { cards: [] }, customLists: [], events: [] }).ok, false);
  assert.equal(validateBackup({ version: 2, settings: defaultLearnerSettings(), catalog: { cards: [] }, customLists: [], events: [] }).ok, false);
});

test("CSV and TSV imports support quoted cells and produce deterministic custom cards", () => {
  const csv = "japanese,reading,meaning,type\n\"申込,書\",もうしこみしょ,application form,vocabulary\n腹,はら,abdomen; belly,kanji\n";
  const tsv = "word\treading\tmeaning\ttype\n応募\tおうぼ\tapplication\tvocabulary\n";
  const first = importDelimitedCatalog(csv, { label: "Paperwork" });
  const second = importDelimitedCatalog(csv, { label: "Paperwork" });
  const tabbed = importDelimitedCatalog(tsv, { label: "Applications" });

  assert.equal(first.ok, true);
  assert.deepEqual(first.value, second.value);
  assert.deepEqual(first.value.cards.map(({ item, type, meanings }) => ({ item, type, meanings })), [
    { item: "申込,書", type: "vocabulary", meanings: ["application form"] },
    { item: "腹", type: "kanji", meanings: ["abdomen", "belly"] },
  ]);
  assert.equal(tabbed.value.cards[0].item, "応募");
});

test("text import rejects missing required cells and merges without mutating current state", () => {
  const invalid = importDelimitedCatalog("japanese,reading,meaning\n腹,,abdomen\n", { label: "Broken" });
  const current = state();
  const imported = importDelimitedCatalog("word,reading,meaning,type\n応募,おうぼ,application,vocabulary\n", { label: "Applications" });
  const merged = mergeCatalogImport({ catalog: current.catalog, customLists: current.customLists, imported: imported.value });

  assert.equal(invalid.ok, false);
  assert.equal(current.catalog.cards.length, 1);
  assert.equal(current.customLists.length, 1);
  assert.equal(merged.catalog.cards.length, 2);
  assert.equal(merged.customLists.length, 2);
});

test("restore validates first, preserves a pre-restore backup, and replaces every state file", (_, done) => {
  const directory = mkdtempSync(join(tmpdir(), "learner-restore-"));
  const files = {
    settingsFile: join(directory, "settings.json"),
    catalogFile: join(directory, "catalog.json"),
    customListsFile: join(directory, "custom-lists.json"),
    eventsFile: join(directory, "events.jsonl"),
  };
  const original = state();
  writeFileSync(files.settingsFile, `${JSON.stringify(original.settings)}\n`);
  writeFileSync(files.catalogFile, `${JSON.stringify(original.catalog)}\n`);
  writeFileSync(files.customListsFile, `${JSON.stringify(original.customLists)}\n`);
  writeFileSync(files.eventsFile, `${original.events.map(JSON.stringify).join("\n")}\n`);
  const replacement = createBackup({
    settings: { ...defaultLearnerSettings(), studyListDailyNew: { "n2-vocabulary": 14 }, requiredDailyCount: 20 },
    catalog: { version: 1, cards: [] },
    customLists: [],
    events: [],
    exportedAt: "2026-07-16T01:00:00.000Z",
  });

  restoreBackup({ backup: replacement, files, now: "2026-07-16T02:00:00.000Z" }, (result) => {
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(readFileSync(files.settingsFile, "utf8")).studyListDailyNew, { "n2-vocabulary": 14 });
    assert.deepEqual(JSON.parse(readFileSync(files.catalogFile, "utf8")).cards, []);
    assert.deepEqual(JSON.parse(readFileSync(files.customListsFile, "utf8")), []);
    assert.equal(readFileSync(files.eventsFile, "utf8"), "");
    assert.equal(existsSync(result.value.preRestoreBackupFile), true);
    assert.equal(readdirSync(join(directory, "backups")).length, 1);
    rmSync(directory, { recursive: true, force: true });
    done();
  });
});

test("invalid restore input leaves current files byte-for-byte unchanged", (_, done) => {
  const directory = mkdtempSync(join(tmpdir(), "learner-invalid-restore-"));
  const files = {
    settingsFile: join(directory, "settings.json"),
    catalogFile: join(directory, "catalog.json"),
    customListsFile: join(directory, "custom-lists.json"),
    eventsFile: join(directory, "events.jsonl"),
  };
  Object.values(files).forEach((file) => writeFileSync(file, "original"));

  restoreBackup({ backup: { version: 2 }, files }, (result) => {
    assert.equal(result.ok, false);
    assert.equal(Object.values(files).every((file) => readFileSync(file, "utf8") === "original"), true);
    rmSync(directory, { recursive: true, force: true });
    done();
  });
});
