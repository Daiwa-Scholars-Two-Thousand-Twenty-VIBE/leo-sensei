import assert from "node:assert/strict";
import test from "node:test";

import { normalizeExternalSpeechEndpoint } from "../scripts/lib/speech-endpoint.mjs";

test("external speech accepts only an explicit loopback HTTP endpoint", () => {
  assert.equal(
    normalizeExternalSpeechEndpoint("http://127.0.0.1:43127/v1/audio/speech"),
    "http://127.0.0.1:43127/v1/audio/speech",
  );
  assert.equal(normalizeExternalSpeechEndpoint("http://localhost:43127/v1/audio/speech"), null);
  assert.equal(normalizeExternalSpeechEndpoint("https://speech.example.com/v1/audio/speech"), null);
  assert.equal(normalizeExternalSpeechEndpoint("http://127.0.0.1/v1/audio/speech"), null);
  assert.equal(normalizeExternalSpeechEndpoint(""), null);
});
