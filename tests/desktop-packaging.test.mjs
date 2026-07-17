import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { browserWindowOptions, loginItemSettings } from "../desktop/window-options.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("browser windows isolate and sandbox the renderer", () => {
  const options = browserWindowOptions("/app/desktop/preload.mjs", "session-token");

  assert.equal(options.webPreferences.preload, "/app/desktop/preload.mjs");
  assert.deepEqual(options.webPreferences.additionalArguments, ["--leo-sensei-mutation-token=session-token"]);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.webviewTag, false);
});

test("desktop main creates a fresh 32-byte base64url mutation token", () => {
  const main = readFileSync(new URL("../desktop/main.mjs", import.meta.url), "utf8");

  assert.match(main, /randomBytes\(32\)\.toString\("base64url"\)/u);
  assert.doesNotMatch(main, /LEARNER_MUTATION_TOKEN/u);
});

test("desktop runtime never starts or packages a speech sidecar", () => {
  const main = readFileSync(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

  assert.doesNotMatch(main, /startSpeechSidecar|speech-sidecar|LEO_SENSEI_TTS_RESOURCE/u);
  assert.equal(existsSync(new URL("../desktop/speech-sidecar.mjs", import.meta.url)), false);
  assert.doesNotMatch(releaseWorkflow, /speech-sidecars|tts\/build\.py|LEO_SENSEI_TTS_RESOURCE/u);
});

test("packaged Windows login uses the Squirrel launcher one directory above the executable", () => {
  assert.deepEqual(loginItemSettings({
    enabled: true,
    platform: "win32",
    packaged: true,
    execPath: "C:\\Users\\Leo\\AppData\\Local\\App\\app-1.0.0\\App.exe",
  }), {
    openAtLogin: true,
    path: "C:\\Users\\Leo\\AppData\\Local\\App\\App.exe",
  });
  assert.deepEqual(loginItemSettings({
    enabled: false,
    platform: "darwin",
    packaged: true,
    execPath: "/Applications/App.app/Contents/MacOS/App",
  }), { openAtLogin: false });
});

test("package metadata points Electron Forge at the desktop entrypoint", () => {
  assert.equal(packageJson.main, "desktop/main.mjs");
  assert.equal(packageJson.productName, "Leo Sensei の-nonsense 日本語");
  assert.equal(packageJson.scripts.start, "electron-forge start");
  assert.equal(packageJson.scripts.package, "electron-forge package");
  assert.equal(packageJson.scripts.make, "electron-forge make");
  assert.equal(packageJson.scripts["make:linux"], "electron-forge make --platform=linux --arch=x64");
  assert.equal(packageJson.devDependencies["@electron-forge/maker-deb"], "^7.11.2");
});

test("Forge creates macOS, Windows, and Linux x64 installers without changing the product identity", () => import("../forge.config.mjs")
  .then(({ default: config }) => {
    const makers = Object.fromEntries(config.makers.map((maker) => [maker.name, maker]));
    const ignored = (path) => config.packagerConfig.ignore.some((pattern) => pattern.test(path));

    assert.equal(config.packagerConfig.asar.unpack, "**/node_modules/get-windows/**");
    assert.equal(config.packagerConfig.extraResource, undefined);
    assert.equal(ignored("/.github/workflows/release.yml"), true);
    assert.equal(ignored("/release/scan.mjs"), true);
    assert.equal(ignored("/tts/.venv/lib/model.bin"), true);
    assert.equal(ignored("/tts/dist/leo-sensei-tts/leo-sensei-tts"), true);
    assert.equal(ignored("/tests/release-scan.test.mjs"), true);
    assert.equal(ignored("/decks/manifest.json"), false);
    assert.equal(ignored("/THIRD_PARTY_NOTICES.md"), false);
    assert.deepEqual(config.buildTargets.darwin, { platform: "darwin", arch: "universal" });
    assert.deepEqual(config.buildTargets.win32, { platform: "win32", arch: "x64" });
    assert.deepEqual(config.buildTargets.linux, { platform: "linux", arch: "x64" });
    assert.deepEqual(makers["@electron-forge/maker-dmg"].platforms, ["darwin"]);
    assert.deepEqual(makers["@electron-forge/maker-squirrel"].platforms, ["win32"]);
    assert.deepEqual(makers["@electron-forge/maker-deb"], {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          name: "leo-sensei-no-nonsense-nihongo",
          productName: "Leo Sensei の-nonsense 日本語",
          genericName: "Japanese study and review",
          bin: "Leo Sensei の-nonsense 日本語",
          categories: ["Education"],
        },
      },
    });
  }));

test("release workflow scans Linux and labels only the downloadable installer files", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

  assert.match(workflow, /linux-installer:[\s\S]*runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /release:scan -- --platform=linux/u);
  assert.match(workflow, /leo-sensei-linux-x64-deb/u);
  assert.match(workflow, /Leo Sensei の-nonsense 日本語 for dayday-chan\.dmg/u);
  assert.match(workflow, /Leo Sensei の-nonsense 日本語 for e-san Setup\.exe/u);
  assert.match(workflow, /Leo Sensei の-nonsense 日本語 for henry-chan\.deb/u);
  assert.match(workflow, /needs: \[mac-installer, windows-installer, linux-installer\]/u);
  assert.match(workflow, /Require manual history-sanitation confirmation/u);
  assert.match(workflow, /test "\$\{\{ inputs\.history_sanitized \}\}" = "true"/u);
});

test("release workflow builds friend installers unsigned by default and signs only when requested", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const conditionalStep = (name) => new RegExp(`- name: ${name}\\n\\s+if: \\$\\{\\{ inputs\\.sign_installers \\}\\}`, "u");

  assert.match(workflow, /windows-installer:[\s\S]*runs-on: windows-2022/u);
  assert.match(workflow, /test -s "\$APP\/Contents\/Resources\/\$ICON_NAME"/u);
  assert.doesNotMatch(workflow, /file "\$APP\/Contents\/Resources\/\$ICON_NAME" \| grep/u);
  assert.match(workflow, /find installers\/windows -type f -name '\*Setup\.exe'/u);
  assert.match(workflow, /gh release create "\$RELEASE_TAG" \\\n\s+"\$MAC_INSTALLER" \\\n\s+"\$WINDOWS_INSTALLER" \\\n\s+"\$LINUX_INSTALLER"/u);
  assert.match(workflow, /sign_installers:\n\s+description: [^\n]+\n\s+required: true\n\s+default: false\n\s+type: boolean/u);
  [
    "Require Apple signing secrets",
    "Import signing identity and notarization key",
    "Verify signed macOS app",
    "Sign, notarize, staple, and verify the DMG",
    "Require and decode Windows signing certificate",
    "Verify Windows installer signature",
  ].map((name) => assert.match(workflow, conditionalStep(name)));
  assert.match(workflow, /- name: Label macOS installer for download\n\s+run:/u);
  assert.match(workflow, /- name: Label Windows installer for download\n\s+shell: pwsh\n\s+run:/u);
  assert.doesNotMatch(workflow, /name: Build signed|name: Package, sign|name: Build signed Squirrel/u);
});
