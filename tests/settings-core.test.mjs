import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultLearnerSettings,
  normalizeLearnerSettings,
} from "../scripts/lib/settings-core.mjs";

test("default learner settings are valid, immutable, and safe before onboarding", () => {
  const settings = defaultLearnerSettings();

  assert.deepEqual(settings, {
    version: 2,
    requiredDailyCount: 100,
    studyListDailyNew: { "n5-vocabulary": 10 },
    gateMode: "off",
    gatedApplications: [],
    onboardingComplete: false,
  });
  assert.equal(Object.isFrozen(settings), true);
  assert.equal(Object.isFrozen(settings.gatedApplications), true);
});

test("normalization accepts one cross-platform settings document", () => {
  const result = normalizeLearnerSettings({
    version: 2,
    requiredDailyCount: 24,
    studyListDailyNew: { "n3-vocabulary": 12, "n3-kanji": 0 },
    gateMode: "redirect",
    gatedApplications: ["com.apple.Safari", "firefox.exe", "firefox.exe"],
    onboardingComplete: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    version: 2,
    requiredDailyCount: 24,
    studyListDailyNew: { "n3-vocabulary": 12, "n3-kanji": 0 },
    gateMode: "redirect",
    gatedApplications: ["com.apple.Safari", "firefox.exe"],
    onboardingComplete: true,
  });
});

test("normalization rejects invalid trust-boundary values without partial settings", () => {
  assert.equal(normalizeLearnerSettings(null).ok, false);
  assert.equal(normalizeLearnerSettings("settings").ok, false);
  assert.equal(normalizeLearnerSettings({ requiredDailyCount: 0 }).ok, false);
  assert.equal(normalizeLearnerSettings({ requiredDailyCount: 1.5 }).ok, false);
  assert.equal(normalizeLearnerSettings({ gateMode: "lock" }).ok, false);
  assert.equal(normalizeLearnerSettings({ gatedApplications: [""] }).ok, false);
  assert.equal(normalizeLearnerSettings({ studyListDailyNew: { "n5-vocabulary": -1 } }).ok, false);
  assert.equal(normalizeLearnerSettings({ studyListDailyNew: { "n5-vocabulary": 1.5 } }).ok, false);
});

test("normalization migrates settings version 1 to one enabled study list", () => {
  const result = normalizeLearnerSettings({
    version: 1,
    deckId: "n3-vocabulary",
    requiredDailyCount: 20,
    gateMode: "prompt",
    gatedApplications: ["firefox.exe"],
    onboardingComplete: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    version: 2,
    requiredDailyCount: 20,
    studyListDailyNew: { "n3-vocabulary": 10 },
    gateMode: "prompt",
    gatedApplications: ["firefox.exe"],
    onboardingComplete: true,
  });
});
