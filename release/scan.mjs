#!/usr/bin/env node

import { extractAll } from "@electron/asar";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { tmpdir } from "node:os";

import { scanReleaseEntries } from "./release-scan-core.mjs";

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".plist",
  ".py",
  ".toml",
  ".txt",
  ".yaml",
  ".yml",
]);

const walk = (root, directory = root) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => ((absolutePath) => entry.isDirectory()
    ? walk(root, absolutePath)
    : entry.isFile()
      ? [{
          absolutePath,
          relativePath: relative(root, absolutePath),
          size: statSync(absolutePath).size,
        }]
      : [])(join(directory, entry.name)));

const rootEntries = (root) => statSync(root).isDirectory()
  ? walk(root).map((entry) => ({ ...entry, relativePath: join(basename(root), entry.relativePath) }))
  : [{ absolutePath: root, relativePath: basename(root), size: statSync(root).size }];

const temporaryDirectory = mkdtempSync(join(tmpdir(), "leo-sensei-release-scan-"));
process.on("exit", () => rmSync(temporaryDirectory, { recursive: true, force: true }));

const platformArgument = process.argv.slice(2).find((argument) => argument.startsWith("--platform="));
const platform = platformArgument?.slice("--platform=".length);
const roots = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));

const files = roots.flatMap(rootEntries);
const extracted = files
  .filter(({ relativePath }) => basename(relativePath) === "app.asar")
  .flatMap(({ absolutePath }, index) => ((destination) => (
    extractAll(absolutePath, destination),
    walk(destination).map((entry) => ({
      ...entry,
      relativePath: join(`app-asar-${index}`, entry.relativePath),
    }))
  ))(join(temporaryDirectory, String(index))));

const entries = [...files, ...extracted].map((entry) => ({
  relativePath: entry.relativePath,
  body: textExtensions.has(extname(entry.relativePath).toLowerCase()) && entry.size <= 20 * 1024 * 1024
    ? readFileSync(entry.absolutePath, "utf8")
    : null,
}));

const validInput = ["darwin", "linux", "win32"].includes(platform) && roots.length > 0;
const violations = validInput
  ? scanReleaseEntries(entries, { platform })
  : [{ code: "INVALID_INPUT", path: "", detail: "Usage: scan.mjs --platform=darwin|linux|win32 PACKAGE_PATH..." }];

violations.map((issue) => process.stderr.write(`${JSON.stringify(issue)}\n`));
process.stdout.write(violations.length === 0 ? `Release scan passed: ${entries.length} files\n` : "");
process.exitCode = violations.length === 0 ? 0 : 1;
