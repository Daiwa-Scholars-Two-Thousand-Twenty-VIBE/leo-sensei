const normalizedText = (value) => String(value ?? "").trim().toLowerCase();

const executableName = (value) => normalizedText(value)
  .split(/[\\/]/u)
  .filter(Boolean)
  .at(-1) ?? "";

const browserApplicationsByPlatform = Object.freeze({
  darwin: Object.freeze([
    Object.freeze({ displayName: "Safari", identity: "com.apple.safari" }),
    Object.freeze({ displayName: "Google Chrome", identity: "com.google.chrome" }),
    Object.freeze({ displayName: "Firefox", identity: "org.mozilla.firefox" }),
    Object.freeze({ displayName: "Microsoft Edge", identity: "com.microsoft.edgemac" }),
    Object.freeze({ displayName: "Brave", identity: "com.brave.browser" }),
    Object.freeze({ displayName: "Opera", identity: "com.operasoftware.opera" }),
  ]),
  win32: Object.freeze([
    Object.freeze({ displayName: "Google Chrome", identity: "chrome.exe" }),
    Object.freeze({ displayName: "Microsoft Edge", identity: "msedge.exe" }),
    Object.freeze({ displayName: "Firefox", identity: "firefox.exe" }),
    Object.freeze({ displayName: "Brave", identity: "brave.exe" }),
    Object.freeze({ displayName: "Opera", identity: "opera.exe" }),
  ]),
  linux: Object.freeze([
    Object.freeze({ displayName: "Google Chrome", identity: "chrome" }),
    Object.freeze({ displayName: "Chromium", identity: "chromium" }),
    Object.freeze({ displayName: "Firefox", identity: "firefox" }),
    Object.freeze({ displayName: "Microsoft Edge", identity: "msedge" }),
    Object.freeze({ displayName: "Brave", identity: "brave" }),
    Object.freeze({ displayName: "Opera", identity: "opera" }),
  ]),
});

const focusApplicationPresetsByPlatform = Object.freeze({
  darwin: Object.freeze([
    Object.freeze({ displayName: "Terminal", identity: "com.apple.terminal" }),
    Object.freeze({ displayName: "Codex", identity: "com.openai.codex" }),
    Object.freeze({ displayName: "Claude", identity: "com.anthropic.claudefordesktop" }),
    Object.freeze({ displayName: "Cursor", identity: "com.todesktop.230313mzl4w4u92" }),
    Object.freeze({ displayName: "Notion", identity: "notion.id" }),
    Object.freeze({ displayName: "Apple Mail", identity: "com.apple.mail" }),
    Object.freeze({ displayName: "Microsoft Outlook", identity: "com.microsoft.outlook" }),
  ]),
  win32: Object.freeze([
    Object.freeze({ displayName: "Windows Terminal", identity: "windowsterminal.exe" }),
    Object.freeze({ displayName: "PowerShell", identity: "pwsh.exe" }),
    Object.freeze({ displayName: "Codex", identity: "codex.exe" }),
    Object.freeze({ displayName: "Claude", identity: "claude.exe" }),
    Object.freeze({ displayName: "Cursor", identity: "cursor.exe" }),
    Object.freeze({ displayName: "Notion", identity: "notion.exe" }),
    Object.freeze({ displayName: "Microsoft Outlook", identity: "outlook.exe" }),
    Object.freeze({ displayName: "Microsoft Outlook (new)", identity: "olk.exe" }),
  ]),
  linux: Object.freeze([
    Object.freeze({ displayName: "GNOME Terminal", identity: "gnome-terminal-server" }),
    Object.freeze({ displayName: "Konsole", identity: "konsole" }),
    Object.freeze({ displayName: "Kitty", identity: "kitty" }),
    Object.freeze({ displayName: "Alacritty", identity: "alacritty" }),
    Object.freeze({ displayName: "WezTerm", identity: "wezterm-gui" }),
    Object.freeze({ displayName: "Cursor", identity: "cursor" }),
    Object.freeze({ displayName: "Evolution Mail", identity: "evolution" }),
    Object.freeze({ displayName: "Geary", identity: "geary" }),
  ]),
});

export const browserApplications = (platform) => browserApplicationsByPlatform[platform] ?? [];

export const focusApplications = (platform) => focusApplicationPresetsByPlatform[platform] ?? [];

const linuxUsesX11 = (environment) => normalizedText(environment?.XDG_SESSION_TYPE) === "x11" || (
  !normalizedText(environment?.XDG_SESSION_TYPE)
  && Boolean(environment?.DISPLAY)
  && !environment?.WAYLAND_DISPLAY
);

export const gateBehavior = (platform, environment) => platform === "linux" && !linuxUsesX11(environment)
  ? "prompt"
  : "redirect";

export const effectiveGateSettings = (settings, platform, environment) => settings?.mode === "redirect"
  && gateBehavior(platform, environment) === "prompt"
  ? { ...settings, mode: "prompt" }
  : settings;

export const activeApplicationIdentity = (window) => window?.platform === "macos"
  ? normalizedText(window.owner?.bundleId ?? window.owner?.name)
  : window?.platform === "windows"
    ? executableName(window.owner?.path ?? window.owner?.name)
    : window?.platform === "linux"
      ? executableName(window.owner?.path ?? window.owner?.name)
      : normalizedText(window?.owner?.name);

export const normalizeGateSettings = (settings) => (
  ["off", "prompt", "redirect"].includes(settings?.gateMode)
  && Array.isArray(settings?.gatedApplications)
)
  ? {
      mode: settings.gateMode,
      applications: [...new Set(settings.gatedApplications.map(normalizedText).filter(Boolean))],
    }
  : { mode: "off", applications: [] };

export const gateAction = ({ settings, activeIdentity, status }) => (
  (settings?.mode === "prompt" || (
    settings?.mode === "redirect"
    && settings?.applications?.includes(normalizedText(activeIdentity))
  ))
  && status?.accessAllowed === false
  && status?.failOpen !== true
)
  ? settings.mode === "redirect"
    ? "redirect"
    : "prompt"
  : "allow";
