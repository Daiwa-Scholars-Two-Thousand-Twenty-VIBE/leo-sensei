#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const rawDir = process.env.MARUMORI_RAW_DIR ?? "data/marumori/raw";
const outputDir = process.env.LEARNER_STATE_DIR ?? "data/learner-state";

const latestAccountExport = async () => {
  const entries = await readdir(rawDir);
  const files = entries
    .filter((entry) => entry.startsWith("account-") && entry.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error(`No account export found in ${rawDir}`);
  }

  return join(rawDir, files[0]);
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const itemTypeFromId = (id, fallback) => {
  const prefix = String(id ?? "").split("/")[0].toLowerCase();
  if (prefix === "vocabulary") return "vocabulary";
  if (prefix === "kanji") return "kanji";
  if (prefix === "grammarpoints") return "grammar";
  return String(fallback ?? "unknown").toLowerCase();
};

const canonicalId = (item) => item?._id ?? `${itemTypeFromId(item?._id, item?.type)}/${item?._key ?? item?.item}`;

const splitMeanings = (value) => {
  if (!value) return [];
  return String(value)
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const timestampToIso = (timestamp) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const ensureItem = (itemsById, raw, source) => {
  const id = canonicalId(raw);
  const existing = itemsById.get(id) ?? {
    id,
    marumoriKey: raw?._key ?? null,
    type: itemTypeFromId(id, raw?.type),
    item: raw?.item ?? raw?.currentForm?.form ?? "",
    reading: raw?.reading ?? null,
    meanings: [],
    currentForm: raw?.currentForm?.form ?? null,
    marumori: {
      level: null,
      status: null,
      studyLists: [],
      sources: [],
      firstSeenAt: null,
      lastSeenAt: null,
      actionCounts: {},
      lessonCount: 0,
      reviewCount: 0,
      failedReviewCount: 0,
      totalAttempts: null,
      wrongAttempts: null,
      accuracy: null,
      leech: false,
    },
    localSrs: {
      intervalDays: 0,
      dueAt: new Date().toISOString(),
      correctStreak: 0,
      wrongStreak: 0,
      localReviewCount: 0,
      localWrongCount: 0,
      lastReviewedAt: null,
    },
  };

  existing.item ||= raw?.item ?? raw?.currentForm?.form ?? "";
  existing.reading ||= raw?.reading ?? null;
  existing.currentForm ||= raw?.currentForm?.form ?? null;
  existing.marumori.level = Math.max(existing.marumori.level ?? 0, raw?.level ?? 0) || existing.marumori.level;
  existing.marumori.status ??= raw?.status ?? null;

  const meanings = splitMeanings(raw?.meaning ?? raw?.english ?? raw?.meanings?.join?.("; "));
  existing.meanings = [...new Set([...existing.meanings, ...meanings])];

  if (!existing.marumori.sources.includes(source)) {
    existing.marumori.sources.push(source);
  }

  itemsById.set(id, existing);
  return existing;
};

const mergeTimestamp = (item, timestamp) => {
  const iso = timestampToIso(timestamp);
  if (!iso) return;
  if (!item.marumori.firstSeenAt || iso < item.marumori.firstSeenAt) {
    item.marumori.firstSeenAt = iso;
  }
  if (!item.marumori.lastSeenAt || iso > item.marumori.lastSeenAt) {
    item.marumori.lastSeenAt = iso;
  }
};

const addRecentItems = (itemsById, exportPayload) => {
  for (const [itemType, groups] of Object.entries(exportPayload.recentlyStudied ?? {})) {
    for (const [groupName, group] of Object.entries(groups ?? {})) {
      for (const raw of asArray(group?.items)) {
        const item = ensureItem(itemsById, raw, `recentlyStudied:${itemType}:${groupName}`);
        mergeTimestamp(item, raw.timestamp);
        item.marumori.actionCounts[raw.action ?? groupName] = (item.marumori.actionCounts[raw.action ?? groupName] ?? 0) + 1;
        if (groupName === "lessons") item.marumori.lessonCount += 1;
        if (groupName === "reviews") item.marumori.reviewCount += 1;
        if (groupName === "failedReviews") {
          item.marumori.failedReviewCount += 1;
          item.marumori.reviewCount += 1;
        }
      }
    }
  }
};

const addLeeches = (itemsById, exportPayload) => {
  for (const [itemType, result] of Object.entries(exportPayload.leeches ?? {})) {
    for (const raw of asArray(result?.data?.items)) {
      const item = ensureItem(itemsById, raw, `leeches:${itemType}`);
      item.marumori.leech = true;
      item.marumori.totalAttempts = Math.max(item.marumori.totalAttempts ?? 0, raw.total ?? 0) || item.marumori.totalAttempts;
      item.marumori.wrongAttempts = Math.max(item.marumori.wrongAttempts ?? 0, raw.wrongTotal ?? 0) || item.marumori.wrongAttempts;
      item.marumori.accuracy = typeof raw.perc === "number" ? raw.perc : item.marumori.accuracy;
    }
  }
};

const addStudyListItems = (itemsById, exportPayload) => {
  for (const [studyListKey, result] of Object.entries(exportPayload.studyListItems ?? {})) {
    for (const raw of asArray(result?.data?.items)) {
      const item = ensureItem(itemsById, raw, `studyList:${studyListKey}`);
      if (!item.marumori.studyLists.includes(studyListKey)) {
        item.marumori.studyLists.push(studyListKey);
      }
    }
  }
};

const priorityScore = (item) => {
  const leechBoost = item.marumori.leech ? 100 : 0;
  const wrongBoost = (item.marumori.wrongAttempts ?? item.marumori.failedReviewCount ?? 0) * 3;
  const lowLevelBoost = Math.max(0, 8 - (item.marumori.level ?? 0)) * 5;
  const recencyBoost = item.marumori.lastSeenAt ? 10 : 0;
  return leechBoost + wrongBoost + lowLevelBoost + recencyBoost;
};

const csvEscape = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const toCsv = (items) => {
  const headers = [
    "id",
    "type",
    "item",
    "reading",
    "meanings",
    "marumoriLevel",
    "leech",
    "totalAttempts",
    "wrongAttempts",
    "accuracy",
    "lessonCount",
    "reviewCount",
    "failedReviewCount",
    "lastSeenAt",
    "priority",
  ];
  const rows = items.map((item) => [
    item.id,
    item.type,
    item.item,
    item.reading,
    item.meanings.join("; "),
    item.marumori.level,
    item.marumori.leech,
    item.marumori.totalAttempts,
    item.marumori.wrongAttempts,
    item.marumori.accuracy,
    item.marumori.lessonCount,
    item.marumori.reviewCount,
    item.marumori.failedReviewCount,
    item.marumori.lastSeenAt,
    item.priority,
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
};

const main = async () => {
  const inputFile = process.argv[2] ?? (await latestAccountExport());
  const payload = JSON.parse(await readFile(inputFile, "utf8"));
  const itemsById = new Map();

  addStudyListItems(itemsById, payload);
  addRecentItems(itemsById, payload);
  addLeeches(itemsById, payload);

  const items = [...itemsById.values()]
    .filter((item) => item.item && item.meanings.length > 0)
    .map((item) => ({ ...item, priority: priorityScore(item) }))
    .sort((a, b) => b.priority - a.priority || a.type.localeCompare(b.type) || a.item.localeCompare(b.item));

  const learnerState = {
    generatedAt: new Date().toISOString(),
    sourceFile: inputFile,
    sourceExportedAt: payload.exportedAt,
    counts: {
      items: items.length,
      byType: Object.fromEntries(
        ["grammar", "kanji", "vocabulary"].map((type) => [type, items.filter((item) => item.type === type).length]),
      ),
      leeches: items.filter((item) => item.marumori.leech).length,
    },
    items,
  };

  await mkdir(outputDir, { recursive: true });
  const jsonFile = join(outputDir, "items.json");
  const csvFile = join(outputDir, "items.csv");
  await writeFile(jsonFile, `${JSON.stringify(learnerState, null, 2)}\n`, "utf8");
  await writeFile(csvFile, toCsv(items), "utf8");

  console.log(`Normalized ${items.length} items from ${basename(inputFile)}`);
  console.log(`Wrote ${jsonFile}`);
  console.log(`Wrote ${csvFile}`);
  console.log(JSON.stringify(learnerState.counts, null, 2));
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
