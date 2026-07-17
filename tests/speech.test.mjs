import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelJapaneseSpeech,
  japaneseSpeechText,
  playJapaneseSpeech,
  playNeuralJapaneseSpeech,
  primeNeuralJapaneseSpeech,
} from "../public/speech.mjs";

test("japaneseSpeechText prefers a correct submitted reading", () => {
  assert.equal(japaneseSpeechText({
    readingCorrect: true,
    submittedReading: "いたい",
    expectedReading: "つう; いたい",
    expectedSurface: "痛",
  }), "いたい");
});

test("japaneseSpeechText falls back to the first accepted reading and then the surface", () => {
  assert.equal(japaneseSpeechText({ expectedReading: "つう; いたい", expectedSurface: "痛" }), "つう");
  assert.equal(japaneseSpeechText({ expectedReading: null, expectedSurface: "かな" }), "かな");
});

test("playJapaneseSpeech uses a local Japanese voice when available", () => {
  const japaneseVoice = { lang: "ja-JP", localService: true, name: "Japanese" };
  const spoken = [];
  const synthesis = {
    cancel: () => spoken.push("cancel"),
    getVoices: () => [{ lang: "en-US", localService: true, name: "English" }, japaneseVoice],
    speak: (utterance) => spoken.push(utterance),
  };
  const Utterance = class {
    constructor(text) {
      this.text = text;
    }
  };

  assert.equal(playJapaneseSpeech({ synthesis, Utterance, text: "いたい" }), true);
  assert.equal(spoken[0], "cancel");
  assert.equal(spoken[1].text, "いたい");
  assert.equal(spoken[1].lang, "ja-JP");
  assert.equal(spoken[1].voice, japaneseVoice);
  assert.equal(spoken[1].rate, 0.88);
});

test("playJapaneseSpeech fails quietly when speech is unavailable", () => {
  assert.equal(playJapaneseSpeech({ synthesis: null, Utterance: null, text: "いたい" }), false);
  assert.equal(playJapaneseSpeech({ synthesis: {}, Utterance: class {}, text: "" }), false);
});

test("playNeuralJapaneseSpeech uses the local neural endpoint and reuses the prepared clip", (_, done) => {
  const calls = [];
  const player = {
    currentTime: 4,
    pause: () => calls.push("pause"),
    play: () => (calls.push("play"), Promise.resolve()),
    getAttribute: () => player.source ?? null,
    setAttribute: (_name, value) => (player.source = value),
  };

  assert.equal(playNeuralJapaneseSpeech({ player, endpoint: "/api/speech", text: "いたい" }), true);
  setImmediate(() => {
    assert.equal(player.source, "/api/speech?text=%E3%81%84%E3%81%9F%E3%81%84");
    assert.deepEqual(calls, ["pause", "play"]);
    playNeuralJapaneseSpeech({ player, endpoint: "/api/speech", text: "いたい" });
    setImmediate(() => {
      assert.equal(player.currentTime, 0);
      assert.deepEqual(calls, ["pause", "play", "pause", "play"]);
      done();
    });
  });
});

test("neural speech falls back after playback failure but not autoplay denial", (_, done) => {
  const spoken = [];
  const synthesis = {
    cancel: () => spoken.push("cancel"),
    getVoices: () => [],
    speak: (utterance) => spoken.push(utterance.text),
  };
  const Utterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  const player = (failure) => ({
    pause: () => null,
    play: () => Promise.reject(failure),
    getAttribute: () => null,
    setAttribute: () => null,
  });

  playNeuralJapaneseSpeech({ player: player(new Error("offline")), synthesis, Utterance, text: "いたい" });
  setImmediate(() => {
    assert.equal(spoken.filter((value) => value === "いたい").length, 1);
    spoken.length = 0;
    playNeuralJapaneseSpeech({
      player: player(Object.assign(new Error("blocked"), { name: "NotAllowedError" })),
      synthesis,
      Utterance,
      text: "いたい",
    });
    setImmediate(() => {
      assert.equal(spoken.includes("いたい"), false);
      done();
    });
  });
});

test("neural speech can be primed and cancelled through the persistent audio element", () => {
  const calls = [];
  const player = {
    currentTime: 1,
    pause: () => calls.push("pause"),
    play: () => (calls.push("play"), Promise.resolve()),
    removeAttribute: () => calls.push("remove"),
    setAttribute: () => calls.push("set"),
  };
  const synthesis = { cancel: () => calls.push("cancel") };

  assert.equal(primeNeuralJapaneseSpeech(player), true);
  cancelJapaneseSpeech({ player, synthesis });
  assert.deepEqual(calls, ["set", "play", "pause", "remove", "cancel"]);
});
