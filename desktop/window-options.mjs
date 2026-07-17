import { win32 } from "node:path";

export const browserWindowOptions = (preload, mutationToken) => ({
  width: 1120,
  height: 760,
  minWidth: 760,
  minHeight: 560,
  show: false,
  backgroundColor: "#f7f7f5",
  title: "Leo Sensei の-nonsense 日本語",
  webPreferences: {
    preload,
    additionalArguments: [`--leo-sensei-mutation-token=${mutationToken}`],
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  },
});

export const loginItemSettings = ({ enabled, platform, packaged, execPath }) => (
  platform === "win32" && packaged
)
  ? {
      openAtLogin: enabled,
      path: win32.resolve(win32.dirname(execPath), "..", win32.basename(execPath)),
    }
  : { openAtLogin: enabled };
