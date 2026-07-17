import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const removeMacAdapterRebuilds = (buildPath, _electronVersion, platform, _arch, callback) => platform === "darwin"
  ? Promise.all([
      "bin",
      "build",
      join("lib", "binding"),
    ].map((relative) => rm(join(buildPath, "node_modules", "get-windows", relative), {
      recursive: true,
      force: true,
    })))
    .then(() => callback())
    .catch(callback)
  : callback();

const notarization = process.env.APPLE_API_KEY
  && process.env.APPLE_API_KEY_ID
  && process.env.APPLE_API_ISSUER
  ? {
      osxSign: {},
      osxNotarize: {
        appleApiKey: process.env.APPLE_API_KEY,
        appleApiKeyId: process.env.APPLE_API_KEY_ID,
        appleApiIssuer: process.env.APPLE_API_ISSUER,
      },
    }
  : {};

const windowsSigning = process.env.WINDOWS_CERTIFICATE_FILE
  && process.env.WINDOWS_CERTIFICATE_PASSWORD
  ? {
      certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
      certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
    }
  : {};

const appIcon = process.env.LEO_SENSEI_APP_ICON
  ? resolve(process.env.LEO_SENSEI_APP_ICON)
  : null;

const config = {
  buildTargets: {
    darwin: { platform: "darwin", arch: "universal" },
    linux: { platform: "linux", arch: "x64" },
    win32: { platform: "win32", arch: "x64" },
  },
  packagerConfig: {
    appBundleId: "com.daiwavibetribe.leosensei",
    appCategoryType: "public.app-category.education",
    asar: { unpack: "**/node_modules/get-windows/**" },
    afterPrune: [removeMacAdapterRebuilds],
    ignore: [
      /^\/(?:\.git|\.github|assets|data|gate|nix|out|release|tests|tts)(?:\/|$)/u,
      /^\/(?:AGENTS|AI_CUSTOMIZATION|README|TASK)\.md$/u,
      /^\/(?:flake\.(?:lock|nix)|forge\.config\.mjs)$/u,
    ],
    ...(appIcon ? { icon: appIcon } : {}),
    ...notarization,
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        name: "Leo Sensei の-nonsense 日本語",
        format: "ULFO",
        ...(appIcon ? { icon: appIcon } : {}),
      },
    },
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "LeoSenseiNoNonsenseNihongo",
        authors: "Daiwa Vibe Tribe",
        description: "Offline-first Japanese study and review",
        noMsi: true,
        ...(appIcon ? { setupIcon: appIcon } : {}),
        ...windowsSigning,
      },
    },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          name: "leo-sensei-no-nonsense-nihongo",
          productName: "Leo Sensei の-nonsense 日本語",
          genericName: "Japanese study and review",
          bin: "Leo Sensei の-nonsense 日本語",
          categories: ["Education"],
          ...(appIcon ? { icon: appIcon } : {}),
        },
      },
    },
  ],
};

export default config;
