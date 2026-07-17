import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["desktop", "public", "release", "scripts"];

const sourceFiles = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => ((path) => entry.isDirectory()
    ? sourceFiles(path)
    : entry.isFile() && [".cjs", ".js", ".mjs"].includes(extname(entry.name))
      ? [path]
      : [])(join(directory, entry.name)));

const failures = roots
  .flatMap(sourceFiles)
  .map((path) => ({ path, result: spawnSync(process.execPath, ["--check", path], { encoding: "utf8" }) }))
  .filter(({ result }) => result.status !== 0);

failures.map(({ path, result }) => process.stderr.write(`${path}\n${result.stderr}`));
process.exitCode = failures.length === 0 ? 0 : 1;
