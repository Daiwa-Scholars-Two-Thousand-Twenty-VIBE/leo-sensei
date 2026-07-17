#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const token = process.env.MARUMORI_TOKEN;
const apiBase = process.env.MARUMORI_API_BASE ?? "https://public-api.marumori.io";
const outputDir = process.env.MARUMORI_OUTPUT_DIR ?? "data/marumori/raw";

if (!token) {
  console.error("Missing MARUMORI_TOKEN. Copy your MaruMori Public API token from Settings and pass it as an environment variable.");
  process.exit(1);
}

const fetchJson = async (path, params = {}) => {
  const url = new URL(path, apiBase);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { rawText: text };
  }

  if (!response.ok) {
    const message = body?.message ?? response.statusText;
    throw new Error(`${response.status} ${response.statusText} for ${url}: ${message}`);
  }

  return body;
};

const dateDaysFromNow = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const uniqueByStableShape = (items) => {
  const seen = new Map();
  for (const item of items) {
    const key =
      item._id ??
      item._key ??
      item.id ??
      item.itemID ??
      item.itemId ??
      item.slug ??
      item.subjectID ??
      item.subjectId ??
      JSON.stringify(item);
    seen.set(String(key), item);
  }
  return [...seen.values()];
};

const main = async () => {
  await mkdir(outputDir, { recursive: true });

  const allReviews = [];
  const windowsInDays = [0, 7, 30, 90, 180, 365, 365 * 3, 365 * 10];

  for (let level = 0; level <= 9; level += 1) {
    for (const days of windowsInDays) {
      const body = await fetchJson("/srs/reviews", {
        "min-level": level,
        "max-level": level,
        "max-nextReview": dateDaysFromNow(days),
      });

      const reviews = Array.isArray(body?.reviews) ? body.reviews : [];
      allReviews.push(...reviews);
      console.log(`Fetched level ${level}, <= ${days} days: ${reviews.length} reviews`);
    }
  }

  const dedupedReviews = uniqueByStableShape(allReviews);
  const exportedAt = new Date().toISOString();
  const payload = {
    exportedAt,
    source: apiBase,
    endpoints: ["/srs/reviews"],
    counts: {
      rawReviews: allReviews.length,
      dedupedReviews: dedupedReviews.length,
    },
    reviews: dedupedReviews,
  };

  const filename = join(outputDir, `srs-reviews-${exportedAt.replaceAll(":", "-")}.json`);
  await writeFile(filename, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${filename}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
