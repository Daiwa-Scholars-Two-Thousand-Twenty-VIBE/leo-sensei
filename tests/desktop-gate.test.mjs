import assert from "node:assert/strict";
import test from "node:test";

import {
  activeApplicationIdentity,
  browserApplications,
  effectiveGateSettings,
  focusApplications,
  gateAction,
  gateBehavior,
  normalizeGateSettings,
} from "../desktop/gate-policy.mjs";

test("browserApplications exposes familiar browsers with platform identities", () => {
  assert.deepEqual(browserApplications("darwin"), [
    { displayName: "Safari", identity: "com.apple.safari" },
    { displayName: "Google Chrome", identity: "com.google.chrome" },
    { displayName: "Firefox", identity: "org.mozilla.firefox" },
    { displayName: "Microsoft Edge", identity: "com.microsoft.edgemac" },
    { displayName: "Brave", identity: "com.brave.browser" },
    { displayName: "Opera", identity: "com.operasoftware.opera" },
  ]);
  assert.deepEqual(browserApplications("win32"), [
    { displayName: "Google Chrome", identity: "chrome.exe" },
    { displayName: "Microsoft Edge", identity: "msedge.exe" },
    { displayName: "Firefox", identity: "firefox.exe" },
    { displayName: "Brave", identity: "brave.exe" },
    { displayName: "Opera", identity: "opera.exe" },
  ]);
  assert.deepEqual(browserApplications("linux"), [
    { displayName: "Google Chrome", identity: "chrome" },
    { displayName: "Chromium", identity: "chromium" },
    { displayName: "Firefox", identity: "firefox" },
    { displayName: "Microsoft Edge", identity: "msedge" },
    { displayName: "Brave", identity: "brave" },
    { displayName: "Opera", identity: "opera" },
  ]);
});

test("focusApplications exposes common optional work and communication apps", () => {
  assert.deepEqual(focusApplications("darwin"), [
    { displayName: "Terminal", identity: "com.apple.terminal" },
    { displayName: "Codex", identity: "com.openai.codex" },
    { displayName: "Claude", identity: "com.anthropic.claudefordesktop" },
    { displayName: "Cursor", identity: "com.todesktop.230313mzl4w4u92" },
    { displayName: "Notion", identity: "notion.id" },
    { displayName: "Apple Mail", identity: "com.apple.mail" },
    { displayName: "Microsoft Outlook", identity: "com.microsoft.outlook" },
  ]);
  assert.deepEqual(focusApplications("win32"), [
    { displayName: "Windows Terminal", identity: "windowsterminal.exe" },
    { displayName: "PowerShell", identity: "pwsh.exe" },
    { displayName: "Codex", identity: "codex.exe" },
    { displayName: "Claude", identity: "claude.exe" },
    { displayName: "Cursor", identity: "cursor.exe" },
    { displayName: "Notion", identity: "notion.exe" },
    { displayName: "Microsoft Outlook", identity: "outlook.exe" },
    { displayName: "Microsoft Outlook (new)", identity: "olk.exe" },
  ]);
  assert.deepEqual(focusApplications("linux"), [
    { displayName: "GNOME Terminal", identity: "gnome-terminal-server" },
    { displayName: "Konsole", identity: "konsole" },
    { displayName: "Kitty", identity: "kitty" },
    { displayName: "Alacritty", identity: "alacritty" },
    { displayName: "WezTerm", identity: "wezterm-gui" },
    { displayName: "Cursor", identity: "cursor" },
    { displayName: "Evolution Mail", identity: "evolution" },
    { displayName: "Geary", identity: "geary" },
  ]);
});

test("focusApplications ignores running windows and remains a fixed platform list", () => {
  assert.deepEqual(focusApplications("linux", [
    { platform: "linux", owner: { name: "firefox", path: "/usr/bin/firefox" } },
    { platform: "linux", owner: { name: "org.gnome.Terminal", path: "/usr/libexec/gnome-terminal-server" } },
    { platform: "linux", owner: { name: "OpenWhispr", path: "/opt/OpenWhispr/openwhispr" } },
    { platform: "linux", owner: { name: "Notification Centre", path: "/usr/bin/notification-centre" } },
    { platform: "linux", owner: { name: "Obsidian", path: "/opt/Obsidian/obsidian" } },
  ]), [
    { displayName: "GNOME Terminal", identity: "gnome-terminal-server" },
    { displayName: "Konsole", identity: "konsole" },
    { displayName: "Kitty", identity: "kitty" },
    { displayName: "Alacritty", identity: "alacritty" },
    { displayName: "WezTerm", identity: "wezterm-gui" },
    { displayName: "Cursor", identity: "cursor" },
    { displayName: "Evolution Mail", identity: "evolution" },
    { displayName: "Geary", identity: "geary" },
  ]);
});

test("activeApplicationIdentity uses bundle IDs on macOS and executable names on Windows", () => {
  assert.equal(activeApplicationIdentity({
    platform: "macos",
    owner: { bundleId: "Com.Example.Editor", name: "Editor" },
  }), "com.example.editor");
  assert.equal(activeApplicationIdentity({
    platform: "windows",
    owner: { path: "C:\\Program Files\\Editor\\EDITOR.EXE", name: "Editor" },
  }), "editor.exe");
  assert.equal(activeApplicationIdentity({
    platform: "linux",
    owner: { path: "/opt/google/chrome/chrome", name: "Google-chrome" },
  }), "chrome");
});

test("gateBehavior supports X11 redirects and uses reminders when active windows are unavailable", () => {
  assert.equal(gateBehavior("linux", { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }), "redirect");
  assert.equal(gateBehavior("linux", { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" }), "prompt");
  assert.equal(gateBehavior("linux", {}), "prompt");
  assert.equal(gateBehavior("darwin", {}), "redirect");
  assert.equal(gateBehavior("win32", {}), "redirect");
});

test("effectiveGateSettings degrades only Linux Wayland redirects to reminders", () => {
  const settings = { mode: "redirect", applications: ["firefox"] };

  assert.deepEqual(effectiveGateSettings(settings, "linux", { XDG_SESSION_TYPE: "wayland" }), {
    mode: "prompt",
    applications: ["firefox"],
  });
  assert.deepEqual(effectiveGateSettings(settings, "linux", { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }), settings);
  assert.deepEqual(effectiveGateSettings(settings, "darwin", {}), settings);
  assert.deepEqual(effectiveGateSettings({ mode: "off", applications: [] }, "linux", {}), {
    mode: "off",
    applications: [],
  });
});

test("normalizeGateSettings treats absent or malformed settings as gate off", () => {
  assert.deepEqual(normalizeGateSettings(), { mode: "off", applications: [] });
  assert.deepEqual(normalizeGateSettings({ gateMode: "redirect", gatedApplications: "editor.exe" }), {
    mode: "off",
    applications: [],
  });
});

test("normalizeGateSettings accepts canonical stored application identifiers", () => {
  assert.deepEqual(normalizeGateSettings({
    gateMode: "redirect",
    gatedApplications: [
      "Com.Example.Editor",
      "WRITER.EXE",
      "com.example.Terminal",
    ],
  }), {
    mode: "redirect",
    applications: ["com.example.editor", "writer.exe", "com.example.terminal"],
  });
});

test("gateAction only acts on a selected application with explicitly blocked status", () => {
  const settings = { mode: "redirect", applications: ["editor.exe"] };

  assert.equal(gateAction({ settings, activeIdentity: "browser.exe", status: { accessAllowed: false } }), "allow");
  assert.equal(gateAction({ settings, activeIdentity: "editor.exe", status: { accessAllowed: true } }), "allow");
  assert.equal(gateAction({ settings, activeIdentity: "editor.exe", status: { accessAllowed: false } }), "redirect");
});

test("gateAction fails open when status observation is unavailable or malformed", () => {
  const settings = { mode: "redirect", applications: ["editor.exe"] };

  assert.equal(gateAction({ settings, activeIdentity: "editor.exe", status: null }), "allow");
  assert.equal(gateAction({ settings, activeIdentity: "editor.exe", status: { failOpen: true, accessAllowed: false } }), "allow");
  assert.equal(gateAction({ settings, activeIdentity: "editor.exe", status: { complete: false } }), "allow");
});

test("prompt mode notifies while off mode never gates", () => {
  const blocked = { accessAllowed: false, failOpen: false, studyDate: "2026-07-16" };

  assert.equal(gateAction({
    settings: { mode: "prompt", applications: [] },
    activeIdentity: "browser.exe",
    status: blocked,
  }), "prompt");
  assert.equal(gateAction({
    settings: { mode: "off", applications: ["editor.exe"] },
    activeIdentity: "editor.exe",
    status: blocked,
  }), "allow");
});
