import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs";
import { dirname, join } from "node:path";

import { normalizeLearnerSettings } from "./settings-core.mjs";

const freeze = (value) => value && typeof value === "object"
  ? (Object.values(value).map(freeze), Object.freeze(value))
  : value;

const error = (code, message, details = []) => ({ ok: false, error: { code, message, details } });

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

const parseJson = (text, callback) => Promise.resolve(text)
  .then(JSON.parse)
  .then((value) => callback({ ok: true, value }))
  .catch((parseError) => callback(error("INVALID_JSON", parseError.message)));

const parseJsonLines = (text, callback) => Promise.all(String(text)
  .split(/\r?\n/u)
  .filter((line) => line.trim().length > 0)
  .map((line) => Promise.resolve(line).then(JSON.parse)))
  .then((value) => callback({ ok: true, value }))
  .catch((parseError) => callback(error("INVALID_EVENTS", parseError.message)));

export const parseDelimitedRows = (source, delimiter) => ((characters) => ((state) => [
  ...state.rows,
  [...state.row, state.cell],
])(
  characters.reduce((state, character, index) => state.skip
    ? { ...state, skip: false }
    : character === '"' && state.quoted && characters[index + 1] === '"'
      ? { ...state, cell: `${state.cell}"`, skip: true }
      : character === '"'
        ? { ...state, quoted: !state.quoted }
        : character === delimiter && !state.quoted
          ? { ...state, row: [...state.row, state.cell], cell: "" }
          : character === "\n" && !state.quoted
            ? { ...state, rows: [...state.rows, [...state.row, state.cell]], row: [], cell: "" }
            : { ...state, cell: `${state.cell}${character}` },
  { rows: [], row: [], cell: "", quoted: false, skip: false },
)))(Array.from(String(source ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n")));

const headerNames = Object.freeze({
  item: new Set(["japanese", "word", "term", "item"]),
  reading: new Set(["reading", "kana"]),
  meaning: new Set(["meaning", "meanings", "english"]),
  type: new Set(["type", "kind"]),
});

const normalizedCell = (value) => String(value ?? "").trim();

const headerIndex = (header, field) => header.findIndex((cell) => headerNames[field].has(normalizedCell(cell).toLowerCase()));

const tableShape = (rows) => ((header, hasHeader) => ({
  rows: hasHeader ? rows.slice(1) : rows,
  indexes: hasHeader
    ? {
        item: headerIndex(header, "item"),
        reading: headerIndex(header, "reading"),
        meaning: headerIndex(header, "meaning"),
        type: headerIndex(header, "type"),
      }
    : { item: 0, reading: 1, meaning: 2, type: 3 },
}))(
  rows[0] ?? [],
  headerIndex(rows[0] ?? [], "item") >= 0 && headerIndex(rows[0] ?? [], "meaning") >= 0,
);

const inferredType = (item, explicit) => ["kanji", "vocabulary"].includes(explicit.toLowerCase())
  ? explicit.toLowerCase()
  : /^[\u3400-\u9fff\uf900-\ufaff]$/u.test(item)
    ? "kanji"
    : "vocabulary";

const rowValue = (row, index) => index >= 0 ? normalizedCell(row[index]) : "";

const importedRows = ({ rows, indexes }) => rows
  .map((row, index) => ({
    rowNumber: index + 1,
    item: rowValue(row, indexes.item),
    reading: rowValue(row, indexes.reading),
    meaning: rowValue(row, indexes.meaning),
    type: rowValue(row, indexes.type),
  }))
  .filter(({ item, reading, meaning, type }) => [item, reading, meaning, type].some(Boolean));

const rowIssues = (rows) => rows.flatMap(({ rowNumber, item, reading, meaning }) => [
  ...(item ? [] : [{ row: rowNumber, field: "item", message: "Japanese item is required." }]),
  ...(reading ? [] : [{ row: rowNumber, field: "reading", message: "Reading is required." }]),
  ...(meaning ? [] : [{ row: rowNumber, field: "meaning", message: "Meaning is required." }]),
]);

export const importDelimitedCatalog = (text, { label } = {}) => ((trimmedLabel, delimiter) => ((rows) => ((issues) => issues.length > 0
  ? error("INVALID_IMPORT", "Every imported row needs Japanese, reading, and meaning values.", issues)
  : rows.length === 0
    ? error("EMPTY_IMPORT", "The import contains no cards.")
    : ((listId) => ((cards) => ({
        ok: true,
        value: freeze({
          cards,
          customList: { id: listId, label: trimmedLabel, cardIds: cards.map(({ id }) => id) },
        }),
      }))(rows.map((row, index) => ({
        id: `custom:${hash(`${listId}:${index}:${row.item}:${row.reading}:${row.meaning}`)}`,
        type: inferredType(row.item, row.type),
        item: row.item,
        reading: row.reading,
        readings: [row.reading],
        meanings: row.meaning.split(";").map((meaning) => meaning.trim()).filter(Boolean),
        meaningAliases: [],
        provenance: { customListId: listId },
      }))))(`custom:${hash(`${trimmedLabel}\n${JSON.stringify(rows)}`)}`))(rowIssues(rows)))(
    importedRows(tableShape(parseDelimitedRows(text, delimiter))),
  ))(
  normalizedCell(label),
  String(text ?? "").split(/\r?\n/u)[0]?.includes("\t") ? "\t" : ",",
);

export const mergeCatalogImport = ({ catalog, customLists = [], imported }) => ((existingIds) => ({
  catalog: freeze({
    ...(catalog ?? { version: 1 }),
    cards: [
      ...(Array.isArray(catalog?.cards) ? catalog.cards : []),
      ...imported.cards.filter(({ id }) => !existingIds.has(id)),
    ],
  }),
  customLists: freeze([
    ...customLists.filter(({ id }) => id !== imported.customList.id),
    imported.customList,
  ]),
}))(new Set((Array.isArray(catalog?.cards) ? catalog.cards : []).map(({ id }) => id)));

const validCatalog = (catalog) => Boolean(
  catalog
  && typeof catalog === "object"
  && Number(catalog.version ?? 1) === 1
  && Array.isArray(catalog.cards)
  && catalog.cards.every((card) => card && typeof card.id === "string" && typeof card.type === "string"),
);

const validCustomLists = (customLists) => Array.isArray(customLists) && customLists.every(
  (list) => list && typeof list.id === "string" && typeof list.label === "string" && Array.isArray(list.cardIds),
);

const validEvents = (events) => Array.isArray(events) && events.every(
  (event) => event && typeof event === "object" && typeof event.type === "string",
);

export const validateBackup = (backup) => ((settingsResult) => ((details) => details.length > 0
  ? error("INVALID_BACKUP", "Backup validation failed.", details)
  : {
      ok: true,
      value: freeze({
        version: 1,
        exportedAt: backup.exportedAt ?? null,
        settings: settingsResult.value,
        catalog: structuredClone(backup.catalog),
        customLists: structuredClone(backup.customLists),
        events: structuredClone(backup.events),
      }),
    })([
  ...(backup?.version === 1 ? [] : ["Only backup version 1 is supported."]),
  ...(backup && Object.hasOwn(backup, "settings") ? [] : ["Settings are missing."]),
  ...(settingsResult.ok ? [] : ["Settings are invalid."]),
  ...(validCatalog(backup?.catalog) ? [] : ["Catalog is invalid."]),
  ...(validCustomLists(backup?.customLists) ? [] : ["Custom lists are invalid."]),
  ...(validEvents(backup?.events) ? [] : ["Events are invalid."]),
]))(normalizeLearnerSettings(backup?.settings));

export const createBackup = ({ settings, catalog, customLists = [], events = [], exportedAt = new Date().toISOString() }) =>
  validateBackup({ version: 1, exportedAt, settings, catalog, customLists, events }).value;

const readOptional = (path, fallback, parser, callback) => readFile(path, "utf8", (readError, text) =>
  readError?.code === "ENOENT"
    ? callback({ ok: true, value: structuredClone(fallback) })
    : readError
      ? callback(error("READ_FAILED", readError.message))
      : parser(text, callback));

export const readLearnerState = ({ files }, callback) => readOptional(
  files.settingsFile,
  {},
  parseJson,
  (settingsResult) => settingsResult.ok
    ? readOptional(files.catalogFile, { version: 1, cards: [] }, parseJson, (catalogResult) => catalogResult.ok
        ? readOptional(files.customListsFile, [], parseJson, (listsResult) => listsResult.ok
            ? readOptional(files.eventsFile, [], parseJsonLines, (eventsResult) => ((validated) => callback(
                eventsResult.ok
                  ? validated
                  : eventsResult,
              ))(eventsResult.ok
                ? validateBackup({
                    version: 1,
                    settings: settingsResult.value,
                    catalog: catalogResult.value,
                    customLists: listsResult.value,
                    events: eventsResult.value,
                  })
                : eventsResult))
            : callback(listsResult))
        : callback(catalogResult))
    : callback(settingsResult),
);

const mapSeries = (items, transform, callback, values = []) => items.length === 0
  ? callback({ ok: true, value: values })
  : transform(items[0], (result) => result.ok
      ? mapSeries(items.slice(1), transform, callback, [...values, result.value])
      : callback({ ...result, completed: values }));

const ensureDirectories = (paths, callback) => mapSeries(
  [...new Set(paths.map(dirname))],
  (directory, next) => mkdir(directory, { recursive: true }, (directoryError) => next(
    directoryError ? error("CREATE_DIRECTORY_FAILED", directoryError.message) : { ok: true, value: directory },
  )),
  callback,
);

const removeFiles = (paths, callback) => mapSeries(
  paths,
  (path, next) => rm(path, { force: true }, () => next({ ok: true, value: path })),
  () => callback(),
);

const readSnapshots = (entries, callback) => mapSeries(
  entries,
  ({ path }, next) => readFile(path, "utf8", (readError, text) => next(
    readError?.code === "ENOENT"
      ? { ok: true, value: { path, exists: false, text: "" } }
      : readError
        ? error("SNAPSHOT_FAILED", readError.message)
        : { ok: true, value: { path, exists: true, text } },
  )),
  callback,
);

const restoreSnapshots = (snapshots, callback) => mapSeries(
  snapshots,
  ({ path, exists, text }, next) => exists
    ? writeFile(path, text, "utf8", (writeError) => next(
        writeError ? error("ROLLBACK_FAILED", writeError.message) : { ok: true, value: path },
      ))
    : rm(path, { force: true }, (removeError) => next(
        removeError ? error("ROLLBACK_FAILED", removeError.message) : { ok: true, value: path },
      )),
  callback,
);

const transactionalWrite = (entries, callback) => ((staged) => readSnapshots(entries, (snapshotResult) => snapshotResult.ok
  ? ensureDirectories(entries.map(({ path }) => path), (directoryResult) => directoryResult.ok
      ? mapSeries(staged, ({ temporary, text }, next) => writeFile(temporary, text, "utf8", (writeError) => next(
          writeError ? error("STAGE_FAILED", writeError.message) : { ok: true, value: temporary },
        )), (stageResult) => stageResult.ok
          ? mapSeries(staged, ({ path, temporary }, next) => rename(temporary, path, (renameError) => next(
              renameError ? error("COMMIT_FAILED", renameError.message) : { ok: true, value: path },
            )), (commitResult) => commitResult.ok
              ? callback({ ok: true, value: entries.map(({ path }) => path) })
              : restoreSnapshots(snapshotResult.value, (rollbackResult) => removeFiles(
                  staged.map(({ temporary }) => temporary),
                  () => callback(rollbackResult.ok ? commitResult : rollbackResult),
                )))
          : removeFiles(staged.map(({ temporary }) => temporary), () => callback(stageResult)))
      : callback(directoryResult))
  : callback(snapshotResult)))(entries.map(({ path, text }) => ({
  path,
  text,
  temporary: `${path}.${randomUUID()}.tmp`,
})));

const stateEntries = (files, backup) => [
  { path: files.settingsFile, text: `${JSON.stringify(backup.settings, null, 2)}\n` },
  { path: files.catalogFile, text: `${JSON.stringify(backup.catalog, null, 2)}\n` },
  { path: files.customListsFile, text: `${JSON.stringify(backup.customLists, null, 2)}\n` },
  { path: files.eventsFile, text: backup.events.length === 0 ? "" : `${backup.events.map(JSON.stringify).join("\n")}\n` },
];

export const writeLearnerState = ({ files, state }, callback) => ((validated) => validated.ok
  ? transactionalWrite(stateEntries(files, validated.value), callback)
  : callback(validated))(validateBackup({ version: 1, ...state }));

export const restoreBackup = ({ backup, files, now = new Date().toISOString() }, callback) => ((validated) => validated.ok
  ? readLearnerState({ files }, (current) => current.ok
      ? ((preRestoreBackupFile) => transactionalWrite(
          [{ path: preRestoreBackupFile, text: `${JSON.stringify(createBackup({ ...current.value, exportedAt: now }), null, 2)}\n` }],
          (preserved) => preserved.ok
            ? transactionalWrite(stateEntries(files, validated.value), (restored) => callback(
                restored.ok
                  ? { ok: true, value: { backup: validated.value, preRestoreBackupFile } }
                  : restored,
              ))
            : callback(preserved),
        ))(join(dirname(files.settingsFile), "backups", `pre-restore-${now.replaceAll(":", "-")}.json`))
      : callback(current))
  : callback(validated))(validateBackup(backup));
