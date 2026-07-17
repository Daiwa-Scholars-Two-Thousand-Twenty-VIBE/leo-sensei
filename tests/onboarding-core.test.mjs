import assert from "node:assert/strict";
import test from "node:test";

import {
  gatedApplicationOptions,
  onboardingSettings,
  validateOnboarding,
} from "../public/onboarding-core.mjs";

test("onboardingSettings produces the single canonical settings document", () => {
  const result = onboardingSettings({
    studyListDailyNew: { "n5-vocabulary": 0, "n3-vocabulary": 12 },
    requiredDailyCount: "24",
    gateMode: "redirect",
    selectedBrowsers: ["com.apple.Safari", "firefox.exe"],
    selectedApplications: ["com.example.Editor"],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    version: 2,
    requiredDailyCount: 24,
    studyListDailyNew: { "n5-vocabulary": 0, "n3-vocabulary": 12 },
    gateMode: "redirect",
    gatedApplications: ["com.apple.Safari", "firefox.exe", "com.example.Editor"],
    onboardingComplete: true,
  });
});

test("validateOnboarding requires a study list and a browser only for redirect mode", () => {
  assert.deepEqual(validateOnboarding({ studyListDailyNew: {}, requiredDailyCount: "0", gateMode: "redirect", selectedBrowsers: [] }), [
    "Set New / day above zero for at least one study list.",
    "Daily reviews must be a positive whole number.",
    "Choose at least one browser when gating is active.",
  ]);
  assert.deepEqual(validateOnboarding({ studyListDailyNew: { "n5-vocabulary": 10 }, requiredDailyCount: "10", gateMode: "prompt", selectedBrowsers: [] }), []);
  assert.deepEqual(validateOnboarding({ studyListDailyNew: { "n5-vocabulary": 10 }, requiredDailyCount: "10", gateMode: "off", selectedBrowsers: [] }), []);
});

test("gatedApplicationOptions consumes optional desktop candidates without coupling to Electron", () => {
  assert.deepEqual(gatedApplicationOptions([
    { identity: "editor.exe", name: "Editor" },
    { bundleId: "com.example.Terminal", name: "Terminal" },
    { identity: "editor.exe", name: "Duplicate" },
  ]), [
    { identity: "editor.exe", name: "Editor" },
    { identity: "com.example.Terminal", name: "Terminal" },
  ]);
});
