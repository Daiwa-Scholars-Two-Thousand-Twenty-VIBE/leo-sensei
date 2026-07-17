#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const rawDir = process.env.MARUMORI_RAW_DIR ?? "data/marumori/raw";
const outputDir = process.env.MARUMORI_OUTPUT_DIR ?? "data/marumori/processed";

const latestJsonFile = async () => {
  const entries = await readdir(rawDir);
  const files = entries
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error(`No JSON files found in ${rawDir}`);
  }

  return join(rawDir, files[0]);
};

const increment = (object, key) => {
  const normalizedKey = key === undefined || key === null || key === "" ? "unknown" : String(key);
  object[normalizedKey] = (object[normalizedKey] ?? 0) + 1;
};

const summarizeReviews = (reviews = []) => {
  const summary = {
    total: reviews.length,
    byItemType: {},
    byLevel: {},
    byStatus: {},
    nextReview: {
      overdueOrNow: 0,
      future: 0,
      missing: 0,
      earliest: null,
      latest: null,
    },
  };

  const now = Date.now();

  for (const review of reviews) {
    increment(summary.byItemType, review._id?.split("/")?.[0] ?? review.itemType ?? review.type);
    increment(summary.byLevel, review.progress?.level ?? review.level);
    increment(summary.byStatus, review.progress?.status ?? review.status);

    const nextReview = review.progress?.nextReview ?? review.nextReview;
    if (!nextReview) {
      summary.nextReview.missing += 1;
      continue;
    }

    const timestamp = Date.parse(nextReview);
    if (Number.isNaN(timestamp)) {
      summary.nextReview.missing += 1;
      continue;
    }

    if (timestamp <= now) {
      summary.nextReview.overdueOrNow += 1;
    } else {
      summary.nextReview.future += 1;
    }

    if (!summary.nextReview.earliest || nextReview < summary.nextReview.earliest) {
      summary.nextReview.earliest = nextReview;
    }
    if (!summary.nextReview.latest || nextReview > summary.nextReview.latest) {
      summary.nextReview.latest = nextReview;
    }
  }

  return summary;
};

const summarizeAccountExport = (payload) => {
  const recentlyStudiedCounts = {};
  for (const [itemType, groups] of Object.entries(payload.recentlyStudied ?? {})) {
    recentlyStudiedCounts[itemType] = {};
    for (const [group, value] of Object.entries(groups ?? {})) {
      recentlyStudiedCounts[itemType][group] = Array.isArray(value?.items) ? value.items.length : 0;
    }
  }

  const leechCounts = {};
  for (const [itemType, result] of Object.entries(payload.leeches ?? {})) {
    leechCounts[itemType] = Array.isArray(result?.data?.items) ? result.data.items.length : 0;
  }

  const studyListCounts = {};
  for (const [itemType, result] of Object.entries(payload.studyLists ?? {})) {
    studyListCounts[itemType] = Array.isArray(result?.data?.studyLists) ? result.data.studyLists.length : 0;
  }

  return {
    exportedAt: payload.exportedAt,
    sourceFileType: "account",
    stats: payload.statistics?.stats ?? payload.statistics,
    srsLessonHistoryCount: Array.isArray(payload.srsLessonHistory) ? payload.srsLessonHistory.length : null,
    srsReviewHistoryCount: Array.isArray(payload.srsReviewHistory) ? payload.srsReviewHistory.length : null,
    studyListCounts,
    studyListItemListsFetched: Object.keys(payload.studyListItems ?? {}).length,
    leechCounts,
    recentlyStudiedCounts,
  };
};

const main = async () => {
  const inputFile = process.argv[2] ?? (await latestJsonFile());
  const payload = JSON.parse(await readFile(inputFile, "utf8"));
  const isAccountExport = Boolean(payload.user || payload.statistics || payload.recentlyStudied);
  const summary = isAccountExport
    ? summarizeAccountExport(payload)
    : {
        exportedAt: payload.exportedAt,
        sourceFileType: "public-srs-reviews",
        counts: payload.counts,
        reviews: summarizeReviews(payload.reviews ?? []),
      };

  await mkdir(outputDir, { recursive: true });
  const outputFile = join(outputDir, `${basename(inputFile, ".json")}.summary.json`);
  await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputFile}`);
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
