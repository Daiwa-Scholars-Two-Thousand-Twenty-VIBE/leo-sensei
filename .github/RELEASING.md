# Release Preconditions

Installer builds are manual. The release workflow requires an existing `vX.Y.Z` tag on the dispatched commit, builds the macOS, Windows, and Linux installers, scans them, and creates an unpublished draft GitHub Release. A human must inspect and publish that draft. The application has no automatic updater.

`sign_installers` defaults to `false` for trusted-friend test builds. In that mode the macOS and Windows downloads are unsigned: macOS Gatekeeper may refuse the first launch until the tester uses Finder's Open command, and Windows SmartScreen may require **More info > Run anyway**. The files have passed the repository release scan, but the operating system cannot verify a publisher identity. Do not distribute unsigned builds beyond people who can verify where the file came from.

Set `sign_installers` to `true` only when all signing secrets below are configured. That path signs and notarizes the macOS application and DMG, signs the Windows installer, and fails unless those signatures verify. The Linux `.deb` remains unsigned in either mode.

The files attached to the draft identify their intended first testers: macOS is `for dayday-chan`, Windows is `for e-san`, and Linux is `for henry-chan`. These labels exist only in the download filenames; the installed product name remains `Leo Sensei の-nonsense 日本語` on every platform.

## Public-history gate

The current working tree is not enough to prove a repository is safe to publish. Before the first public push, sanitize the old Git history in a private clone and inspect every reachable branch and tag. This is a manual, destructive operation and is intentionally not automated here.

Confirm all of the following before selecting `history_sanitized` in the release workflow:

1. Enumerate every reachable ref with `git for-each-ref` and inspect history with `git log --all --stat`.
2. Run the chosen secret and sensitive-file scanner across every reachable commit, not only `HEAD`.
3. Verify old commits contain no learner state, progress events, settings, browser profiles, cookies, logs, caches, generated audio, personal voice references, credentials, or workstation paths.
4. Have a second person review the rewritten refs before replacing any remote history.
5. Create a reviewed `vX.Y.Z` tag that matches `package.json`, then start the release workflow on that exact commit.

## Optional signing inputs

macOS requires repository secrets for a Developer ID certificate and App Store Connect API key: `APPLE_DEVELOPER_ID_CERTIFICATE_BASE64`, `APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`.

Windows requires `WINDOWS_CODE_SIGNING_CERTIFICATE_BASE64` and `WINDOWS_CODE_SIGNING_CERTIFICATE_PASSWORD`.

The app does not bundle a speech engine, model, or voice recording. The release scan rejects those assets, and the final unpacked application is scanned before an installer is made. Optional neural speech is a user-managed loopback service configured outside the installer.
