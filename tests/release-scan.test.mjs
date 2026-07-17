import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { scanReleaseEntries } from "../release/release-scan-core.mjs";

const requiredEntries = Object.freeze([
  "app/LICENSE",
  "app/THIRD_PARTY_NOTICES.md",
  "app/decks/manifest.json",
  "app/decks/n1-vocabulary.json",
  "app/decks/n2-vocabulary.json",
  "app/decks/n3-vocabulary.json",
  "app/decks/n4-vocabulary.json",
  "app/decks/n5-vocabulary.json",
  "app/decks/LICENSE.open-anki-jlpt-decks",
  "app/decks/SOURCE.md",
]);

const entries = (paths) => paths.map((relativePath) => ({ relativePath, body: "" }));

test("release scan accepts a complete public macOS package", () => {
  assert.deepEqual(scanReleaseEntries(entries(requiredEntries), { platform: "darwin" }), []);
});

test("release scan command accepts a complete Linux package", (context) => {
  const root = mkdtempSync(join(tmpdir(), "leo-sensei-linux-scan-test-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  requiredEntries.map((relativePath) => join(root, relativePath.replace(/^app\//u, "")))
    .map((absolutePath) => (
      mkdirSync(dirname(absolutePath), { recursive: true }),
      writeFileSync(absolutePath, ""),
      absolutePath
    ));

  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../release/scan.mjs", import.meta.url)),
    "--platform=linux",
    root,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release scan passed:/u);
});

test("release scan rejects learner state, credentials, profiles, logs, and generated audio by path", () => {
  const violations = scanReleaseEntries(entries([
    ...requiredEntries,
    "app/catalog.json",
    "app/.env.production",
    "app/signing/private-key.p12",
    "app/browser-profile/Default/Cookies",
    "app/logs/review.log",
    "app/speech-cache/generated.wav",
    "app/personal-reference-audio.flac",
  ]), { platform: "darwin" });

  assert.deepEqual(
    [...new Set(violations.map(({ code }) => code))].toSorted(),
    ["BROWSER_PROFILE", "CACHE_OR_LOG", "GENERATED_AUDIO", "LEARNER_DATA", "PERSONAL_SPEECH", "SECRET_FILE"],
  );
});

test("release scan rejects local absolute paths, secret values, and private speech material in owned text", () => {
  const syntheticGithubToken = ["ghp", "_abcdefghijklmnopqrstuvwxyz1234567890"].join("");
  const violations = scanReleaseEntries([
    ...entries(requiredEntries),
    { relativePath: "app/desktop/config.mjs", body: 'const path = "/Users/alice/private/catalog.json";' },
    { relativePath: "app/desktop/token.mjs", body: `const token = '${syntheticGithubToken}';` },
    { relativePath: "app/desktop/speech.mjs", body: "const model = 'Qwen'; const ref_audio = 'JVS001.wav';" },
  ], { platform: "darwin" });

  assert.deepEqual(
    [...new Set(violations.map(({ code }) => code))].toSorted(),
    ["ABSOLUTE_LOCAL_PATH", "PERSONAL_SPEECH", "SECRET_VALUE"],
  );
});

test("release scan reports every required deck and notice that is absent", () => {
  const violations = scanReleaseEntries([], { platform: "win32" });
  const missing = violations.filter(({ code }) => code === "MISSING_REQUIRED").map(({ detail }) => detail);

  assert.equal(missing.includes("THIRD_PARTY_NOTICES.md"), true);
  assert.equal(missing.includes("decks/n5-vocabulary.json"), true);
  assert.equal(missing.some((path) => /onnx|sidecar|tts/iu.test(path)), false);
});

test("release scan rejects bundled speech engines and model weights", () => {
  const violations = scanReleaseEntries(entries([
    ...requiredEntries,
    "resources/sidecars/windows-x64/leo-sensei-tts.exe",
    "resources/models/voice.safetensors",
    "resources/models/kokoro.onnx",
  ]), { platform: "win32" });

  assert.equal(violations.filter(({ code }) => code === "BUNDLED_SPEECH").length, 3);
});

test("release scan does not treat vendored dependency histories as learner output", () => {
  assert.deepEqual(scanReleaseEntries(entries([
    ...requiredEntries,
    "app/node_modules/example/HISTORY.md",
    "app/node_modules/example/cache/index.js",
  ]), { platform: "darwin" }), []);
});
