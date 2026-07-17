import { createHash } from "node:crypto";

import { parseDelimitedRows } from "./data-transfer.mjs";

const levels = new Set(["N5", "N4", "N3", "N2", "N1"]);

const freeze = (value) => value && typeof value === "object"
  ? (Object.values(value).map(freeze), Object.freeze(value))
  : value;

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 20);

const normalized = (value) => String(value ?? "").trim();

const sourceRows = (csv) => ((rows, header) => ((indexes) => rows.slice(1)
  .map((row, index) => ((expression, sourceReading) => ({
    row: index + 2,
    expression,
    reading: sourceReading || !/[\u3400-\u9fff\uf900-\ufaff]/u.test(expression) ? sourceReading || expression : "",
    meaning: normalized(row[indexes.meaning]),
    guid: normalized(row[indexes.guid]),
  }))(normalized(row[indexes.expression]), normalized(row[indexes.reading])))
  .filter(({ expression, reading, meaning, guid }) => [expression, reading, meaning, guid].some(Boolean)))(
  Object.fromEntries(["expression", "reading", "meaning", "guid"].map((name) => [name, header.indexOf(name)])),
))(parseDelimitedRows(csv, ","), parseDelimitedRows(csv, ",")[0]?.map((cell) => normalized(cell).toLowerCase()) ?? []);

const invalidRows = (rows) => rows.filter(
  ({ expression, reading, meaning, guid }) => !expression || !reading || !meaning || !guid,
);

export const buildJlptDeck = ({ csv, level, source }) => ((normalizedLevel) => ((rows) => !levels.has(normalizedLevel)
  ? { ok: false, error: "JLPT level must be N5, N4, N3, N2, or N1." }
  : invalidRows(rows).length > 0 || rows.length === 0
    ? { ok: false, error: "Every source row requires expression, reading, meaning, and guid." }
    : ((deckId) => ({
        ok: true,
        value: freeze({
          version: 1,
          id: deckId,
          title: `Approximate JLPT ${normalizedLevel} Vocabulary`,
          level: normalizedLevel,
          type: "vocabulary",
          unofficial: true,
          source: structuredClone(source),
          cards: rows.map(({ expression, reading, meaning, guid }) => ({
            id: `jlpt:vocabulary:${hash(guid)}`,
            type: "vocabulary",
            item: expression,
            reading,
            readings: [reading],
            meanings: meaning.split(/[;,]/u).map((item) => item.trim()).filter(Boolean),
            meaningAliases: [],
            provenance: {
              jlpt: { deckIds: [deckId], baselineKnown: false, sourceGuid: guid },
            },
          })),
        }),
      }))(`${normalizedLevel.toLowerCase()}-vocabulary`))(sourceRows(csv)))(normalized(level).toUpperCase());
