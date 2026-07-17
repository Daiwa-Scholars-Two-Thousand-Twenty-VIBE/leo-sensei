import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  copyVoiceCustomizationPrompt,
  voiceCustomizationPrompt,
} from "../public/voice-customization.mjs";

test("voice customization prompt keeps models outside the app and covers Mac and Windows", () => {
  assert.match(voiceCustomizationPrompt, /LEARNER_TTS_ENDPOINT/u);
  assert.match(voiceCustomizationPrompt, /127\.0\.0\.1/u);
  assert.match(voiceCustomizationPrompt, /Apple Silicon Mac/u);
  assert.match(voiceCustomizationPrompt, /mlx-community\/Qwen3-TTS-12Hz-1\.7B-Base-6bit/u);
  assert.match(voiceCustomizationPrompt, /Windows.*NVIDIA/u);
  assert.match(voiceCustomizationPrompt, /Qwen\/Qwen3-TTS-12Hz-1\.7B-Base/u);
  assert.match(voiceCustomizationPrompt, /multiple gigabytes/u);
  assert.match(voiceCustomizationPrompt, /Do not use or redistribute JVS/u);
  assert.match(voiceCustomizationPrompt, /recording.*permission/u);
});

test("voice customization prompt copies through the injected clipboard boundary", () => {
  const copied = [];

  return copyVoiceCustomizationPrompt({
    clipboard: { writeText: (value) => (copied.push(value), Promise.resolve()) },
  }).then((result) => (
    assert.equal(result, true),
    assert.deepEqual(copied, [voiceCustomizationPrompt])
  ));
});

test("installed management navigation exposes the voice prompt", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(app, /data-view="voice"/u);
  assert.match(app, /voiceCustomizationContentMarkup/u);
  assert.match(app, /copyVoicePrompt/u);
  assert.match(app, /state\.daily\.speechAvailable \? `<button id="audioButton"/u);
  assert.doesNotMatch(app, /globalThis\.speechSynthesis|SpeechSynthesisUtterance/u);
});
