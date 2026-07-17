import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("first-run copy uses plain questions and a browser-first block", () => {
  assert.match(appSource, /Choose your main browser\. Leo Sensei will block it until you finish today’s reviews\. You can choose more than one\./u);
  assert.match(appSource, /How many reviews should you finish each day\?/u);
  assert.match(appSource, /Use 0 to pause a list\. You can add your own list after setup\./u);
  assert.doesNotMatch(appSource, /Set your study contract|>01<|>02<|>03</u);
  assert.doesNotMatch(appSource, /Gate mode/u);
});

test("Wayland setup and status use reminder wording instead of claiming browser blocking", () => {
  assert.match(appSource, /Linux Wayland cannot block browser windows/u);
  assert.match(appSource, /Reviews waiting/u);
  assert.match(appSource, /gateBehavior/u);
});

test("first-run and Settings show optional apps with plain terminal guidance", () => {
  assert.match(appSource, /Other apps \(optional\)/u);
  assert.match(appSource, /Codex or Claude running in Terminal count as Terminal\./u);
  assert.match(appSource, /To block another app, ask your AI coding agent to add it\./u);
  assert.doesNotMatch(appSource, /onboarding \? "" : applicationOptionsMarkup/u);
});

test("emergency unlock explains the next-day review charge before confirmation", () => {
  assert.match(appSource, /This unlocks your selected browsers for 30 minutes\./u);
  assert.match(appSource, /reviews will be added tomorrow/u);
});

test("Study lists includes the existing custom-list import", () => {
  assert.match(appSource, /Add your own list/u);
  assert.match(appSource, /customListImportMarkup\("studyListImportForm"\)/u);
});
