import { readFile, mkdir } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  session,
  Tray,
} from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { activeWindow } from "get-windows";

import { createReviewServer } from "../scripts/review-server.mjs";
import { parseJsonResult } from "../scripts/lib/learner-core.mjs";
import { normalizeLearnerSettings } from "../scripts/lib/settings-core.mjs";
import {
  activeApplicationIdentity,
  browserApplications,
  effectiveGateSettings,
  focusApplications,
  gateAction,
  gateBehavior,
  normalizeGateSettings,
} from "./gate-policy.mjs";
import { browserWindowOptions, loginItemSettings } from "./window-options.mjs";

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const preload = join(desktopDirectory, "preload.cjs");
const inactiveGate = Object.freeze({ mode: "off", applications: Object.freeze([]) });
const gatePollMilliseconds = 1000;
const statusTimeoutMilliseconds = 3000;
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="#e0a20c"/><path fill="#282119" d="M8 6h16v20H8zm3 3v5h10V9zm0 8v6h10v-6z"/></svg>`;

const showStudyWindow = (window) => window.isDestroyed()
  ? false
  : (window.isMinimized() ? window.restore() : null, window.show(), window.focus(), true);

const readGateSettings = (settingsFile, callback) => readFile(settingsFile, "utf8", (readError, text) =>
  readError
    ? callback(inactiveGate)
    : parseJsonResult(text, (parsed) => parsed.ok
      ? ((normalized) => callback(normalized.ok ? normalizeGateSettings(normalized.value) : inactiveGate))(
          normalizeLearnerSettings(parsed.value),
        )
      : callback(inactiveGate)));

const requestStatus = (serverUrl, callback) => fetch(`${serverUrl}/api/status`, {
  signal: AbortSignal.timeout(statusTimeoutMilliseconds),
})
  .then((response) => response.json())
  .then(callback)
  .catch(() => callback(null));

const promptForStudy = ({ status, studyWindow, lastPromptedStudyDate }) => (
  Notification.isSupported()
  && typeof status?.studyDate === "string"
  && status.studyDate !== lastPromptedStudyDate
)
  ? ((notification) => (
      notification.on("click", () => showStudyWindow(studyWindow)),
      notification.show(),
      status.studyDate
    ))(new Notification({
      title: "Japanese review is waiting",
      body: "Finish today's review before returning to work.",
    }))
  : lastPromptedStudyDate;

const applyGateAction = ({ action, status, studyWindow, lastPromptedStudyDate }) => action === "redirect"
  ? (showStudyWindow(studyWindow), lastPromptedStudyDate)
  : action === "prompt"
    ? promptForStudy({ status, studyWindow, lastPromptedStudyDate })
    : lastPromptedStudyDate;

const monitorGateStatus = ({ serverUrl, settingsFile, settings, activeIdentity, studyWindow, lastPromptedStudyDate }) => requestStatus(
  serverUrl,
  (status) => monitorGate({
    serverUrl,
    settingsFile,
    studyWindow,
    lastPromptedStudyDate: applyGateAction({
      action: gateAction({ settings, activeIdentity, status }),
      status,
      studyWindow,
      lastPromptedStudyDate,
    }),
  }),
);

const monitorGate = ({ serverUrl, settingsFile, studyWindow, lastPromptedStudyDate = null }) => setTimeout(
  () => readGateSettings(settingsFile, (storedSettings) => ((settings) => settings.mode === "off"
    ? monitorGate({ serverUrl, settingsFile, studyWindow, lastPromptedStudyDate })
    : settings.mode === "prompt"
      ? gateBehavior(process.platform, process.env) === "prompt"
        ? monitorGateStatus({ serverUrl, settingsFile, settings, activeIdentity: "", studyWindow, lastPromptedStudyDate })
        : activeWindow({ accessibilityPermission: false, screenRecordingPermission: false })
            .then(() => monitorGateStatus({
              serverUrl,
              settingsFile,
              settings,
              activeIdentity: "",
              studyWindow,
              lastPromptedStudyDate,
            }))
            .catch(() => monitorGate({ serverUrl, settingsFile, studyWindow, lastPromptedStudyDate }))
      : activeWindow({ accessibilityPermission: false, screenRecordingPermission: false })
          .then((observedWindow) => ((activeIdentity) => settings.applications.includes(activeIdentity)
            ? monitorGateStatus({
                serverUrl,
                settingsFile,
                settings,
                activeIdentity,
                studyWindow,
                lastPromptedStudyDate,
              })
            : monitorGate({ serverUrl, settingsFile, studyWindow, lastPromptedStudyDate }))(
              activeApplicationIdentity(observedWindow),
            ))
          .catch(() => monitorGate({ serverUrl, settingsFile, studyWindow, lastPromptedStudyDate })))(
    effectiveGateSettings(storedSettings, process.platform, process.env),
  )),
  gatePollMilliseconds,
);

const configureWindowSecurity = (window, serverUrl) => (
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" })),
  window.webContents.on("will-navigate", (navigationEvent, target) => (
    URL.parse(target)?.origin === serverUrl ? null : navigationEvent.preventDefault()
  )),
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false)),
  window
);

const createStudyWindow = (serverUrl, mutationToken) => ((window) => (
  configureWindowSecurity(window, serverUrl),
  window.on("close", (closeEvent) => (closeEvent.preventDefault(), window.hide())),
  window.once("ready-to-show", () => showStudyWindow(window)),
  window.loadURL(serverUrl).catch((loadError) => (
    dialog.showErrorBox("Study window unavailable", loadError.message),
    app.quit()
  )),
  window
))(new BrowserWindow(browserWindowOptions(preload, mutationToken)));

const loginMenuItem = (studyWindow, tray) => ({
  label: "Start at login",
  type: "checkbox",
  checked: app.getLoginItemSettings().openAtLogin,
  click: () => (
    app.setLoginItemSettings(loginItemSettings({
      enabled: !app.getLoginItemSettings().openAtLogin,
      platform: process.platform,
      packaged: app.isPackaged,
      execPath: process.execPath,
    })),
    tray.setContextMenu(trayMenu(studyWindow, tray))
  ),
});

const trayMenu = (studyWindow, tray) => Menu.buildFromTemplate([
  { label: "Open study", click: () => showStudyWindow(studyWindow) },
  loginMenuItem(studyWindow, tray),
  { type: "separator" },
  { label: "Quit", click: () => (studyWindow.destroy(), app.quit()) },
]);

const createTray = (studyWindow) => ((tray) => (
  process.platform === "darwin" ? tray.setTitle("日") : null,
  tray.setToolTip("Leo Sensei の-nonsense 日本語"),
  tray.setContextMenu(trayMenu(studyWindow, tray)),
  tray.on("click", () => showStudyWindow(studyWindow)),
  tray
))(new Tray(nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(traySvg)}`)));

const registerFocusApplications = () => ipcMain.handle(
  "desktop:focus-applications",
  () => focusApplications(process.platform),
);

const registerBrowserApplications = () => ipcMain.handle(
  "desktop:browser-applications",
  () => browserApplications(process.platform),
);

const registerGateBehavior = () => ipcMain.handle(
  "desktop:gate-behavior",
  () => gateBehavior(process.platform, process.env),
);

const startReviewRuntime = ({ mutationToken, stateDirectory }) => ((server) => (
  server.on("error", (serverError) => (
    dialog.showErrorBox("Study server unavailable", serverError.message),
    app.quit()
  )),
  server.listen(0, "127.0.0.1", () => ((address) => typeof address === "object" && address
      ? ((serverUrl) => ((studyWindow) => ((tray) => (
        registerBrowserApplications(),
        registerGateBehavior(),
        registerFocusApplications(),
        app.on("activate", () => showStudyWindow(studyWindow)),
        app.on("second-instance", () => showStudyWindow(studyWindow)),
        app.on("before-quit", () => (
          tray.destroy(),
          studyWindow.isDestroyed() ? null : studyWindow.destroy()
        )),
        app.on("will-quit", () => server.close()),
        monitorGate({
          serverUrl,
          settingsFile: join(stateDirectory, "settings.json"),
          studyWindow,
        }),
        tray
      ))(createTray(studyWindow)))(createStudyWindow(serverUrl, mutationToken)))(`http://127.0.0.1:${address.port}`)
    : (dialog.showErrorBox("Study server unavailable", "The loopback address is invalid."), app.quit()))(server.address()))
))(createReviewServer({
  catalogFile: join(stateDirectory, "catalog.json"),
  eventsFile: join(stateDirectory, "events.jsonl"),
  settingsFile: join(stateDirectory, "settings.json"),
  speechCacheDir: join(stateDirectory, "speech-cache"),
  mutationToken,
}));

const startDesktop = () => ((mutationToken) => ((stateDirectory) => mkdir(stateDirectory, { recursive: true }, (directoryError) => directoryError
  ? (dialog.showErrorBox("Data directory unavailable", directoryError.message), app.quit())
  : startReviewRuntime({ mutationToken, stateDirectory })
))(app.getPath("userData")))(randomBytes(32).toString("base64url"));

const primaryInstance = !squirrelStartup && app.requestSingleInstanceLock();

app.enableSandbox();
process.platform === "win32"
  ? app.setAppUserModelId("com.squirrel.LeoSenseiNoNonsenseNihongo.LeoSenseiNoNonsenseNihongo")
  : null;

primaryInstance
  ? app.whenReady().then(startDesktop)
  : app.quit();
