# Leo Sensei の-nonsense 日本語

Leo Sensei is a Japanese vocabulary and kanji study app for Mac, Windows, and Linux. It runs on your own computer, does not require an account, and keeps your study history locally.

The app has two parts to a normal study day. **New / day** decides how many previously unseen words Leo Sensei introduces from each study list. **Daily reviews** decides the size of the review session that Leo Sensei prepares from words you have already started learning. New words enter the spaced-repetition schedule after their lesson, so they return as reviews when they are due.

You can also ask Leo Sensei to keep selected browsers or other applications out of the way until the day's reviews are complete. This is optional, and the app remains useful with blocking turned off.

## Download the right file

Open the repository's **Releases** page and download the file that matches your computer. The current friend-build filenames are:

- Mac, including both Apple Silicon and Intel: `Leo-Sensei-for-dayday-chan.dmg`
- Windows 10 or 11 on a 64-bit PC: `Leo-Sensei-for-e-san-Setup.exe`
- 64-bit Debian or Ubuntu Linux: `Leo-Sensei-for-henry-chan.deb`

The names after `for` are only download labels for the first testers. They are not different editions of the app. All three use the same learner-data and backup format.

## Install on a Mac

1. Download `Leo-Sensei-for-dayday-chan.dmg` from the Releases page.
2. Open the downloaded `.dmg` file.
3. Drag Leo Sensei into the Applications folder if the disk image asks you to do so.
4. Open Leo Sensei from Applications.

Friend-test builds may be unsigned. If macOS says it cannot verify the developer, first try to open the app once. Then open **System Settings > Privacy & Security**, find the message about Leo Sensei, and choose **Open Anyway**. Confirm the second warning. You can also Control-click the app in Finder, choose **Open**, and confirm when that option is available.

Only override this warning when you downloaded the file from the expected GitHub Release and trust the person who sent you there. A signed and notarized release should open normally without this override.

## Install on Windows

1. Download `Leo-Sensei-for-e-san-Setup.exe` from the Releases page.
2. Double-click the downloaded Setup file.
3. Follow the installer, then open Leo Sensei from the Start menu.

Friend-test builds may be unsigned. If Microsoft Defender SmartScreen shows a warning, choose **More info**, check that this is the file you expected, and then choose **Run anyway**. Windows Smart App Control can reject an unsigned application without offering that button. If that happens, use a signed build rather than weakening a computer-wide security setting for this app.

## Install on Debian or Ubuntu Linux

The Linux download is a 64-bit Debian package. You can open the `.deb` file with your desktop's software installer, or install it from a terminal in the download directory:

```sh
sudo apt install './Leo-Sensei-for-henry-chan.deb'
```

After installation, open Leo Sensei from the desktop application menu.

The Linux package is not signed. Only install it when you downloaded it from the expected GitHub Release and trust the person who sent you there.

Browser blocking on Linux depends on the desktop session:

- Under **X11**, Leo Sensei can observe the active application and redirect a selected browser back to the study window.
- Under **Wayland**, ordinary applications cannot reliably observe the active window. Leo Sensei therefore gives a daily review reminder instead of claiming that it can block the browser.

You can check the current session with `printf '%s\n' "$XDG_SESSION_TYPE"`. Some login screens let you choose an X11 or “Xorg” session if you specifically want browser redirection. The study and reminder features work under either session.

## First-time setup

When Leo Sensei opens for the first time:

1. Set **New / day** for each study list. Use `0` to pause a list. For example, setting N5 to `5` and N4 to `3` asks for a combined lesson of up to eight genuinely new words that day.
2. Choose how many **daily reviews** you want to complete. This is the review workload, separate from the new-word lesson.
3. Choose one or more browsers. Mac and Windows use browser blocking by default; Linux Wayland uses reminders. You can change the mode later in Settings.
4. Optionally choose other applications, such as a terminal or editor. If Codex or Claude is running inside a terminal, select the terminal application. To block an application that is not listed, ask your AI coding agent to add it.
5. Select **Start studying**. Leo Sensei opens the Home screen.

Use **Learn new words** for the day's new-word lesson. The app combines the quotas from all enabled lists and remembers the exact lesson for that study day, so closing and reopening it does not replace the unfinished lesson with different words.

Use **Reviews** for the daily review queue. The queue is frozen when the session begins. A missed card returns until you answer it correctly, and changing Settings does not rewrite a session that is already in progress. A new study day begins at 4:00 a.m. in the computer's local time zone.

You can change New / day values from **Study lists** and the review count, browser choices, and blocking mode from **Settings**. Closing the main window hides Leo Sensei in the tray or menu bar so it can continue observing selected applications. The tray menu can also enable **Start at login**. Choosing **Quit** stops the app and therefore stops reminders and browser redirection.

## What browser and app blocking does

Leo Sensei does not install a system extension, require administrator privileges, or lock the computer. While it is running, it checks which application you are using. If you try to use a selected application before completing today's reviews, Leo Sensei opens its study window over that application. It does this again each time you return to the selected application until the reviews are complete.

Reminder mode sends a daily notification instead of redirecting the active application. Off mode does neither. If Leo Sensei cannot read its learner state, cannot reach its own local status server, or cannot observe the active application, it fails open and leaves the other application accessible.

Blocking is tied to completion of the daily review queue, not to optional extra study. New-word lessons and additional reviews remain available after the required queue is complete.

### Emergency unlock

When reviews are incomplete, **Emergency unlock** opens the selected applications for 30 minutes. You must enter a reason before confirming it.

The unlock is intentionally not free: Leo Sensei adds half of the configured daily review count, rounded up, to the next study day. If the daily review count is 21, tomorrow receives 11 additional reviews. Only one emergency charge is recorded for a given source day, and an already frozen session for tomorrow is not retroactively changed.

## Local data and privacy

Leo Sensei does not require an account or a hosted learner profile. Settings, installed study cards, custom lists, frozen sessions, review answers, aliases, corrections, and emergency unlocks are stored in the operating system's normal application-data directory. The desktop interface talks only to a loopback server on `127.0.0.1`.

Progress is recorded as an append-only event history. Current scheduling and statistics are derived from that history rather than maintained as a second editable progress file. The app does not send learner data to this repository.

Your computer and your backups are still your responsibility. A downloaded backup contains learner history and settings in readable JSON, so store it somewhere appropriate for personal data.

## Back up or move your progress

Open **Settings**, find **Learner data**, and choose **Download backup**. The resulting file is named like `leo-sensei-backup-2026-07-17.json` and contains the complete versioned learner state, including settings, cards, custom lists, and review events.

Create a backup before reinstalling the operating system, replacing the computer, or uninstalling the app. To restore it, open **Settings**, choose the backup file under **Restore backup**, and select **Restore**. Leo Sensei validates the complete file and preserves a pre-restore snapshot before replacing current state.

The same backup can be restored on Mac, Windows, or Linux.

## Voice is optional and not bundled

Leo Sensei does not include a speech engine, voice model, Python runtime, personal recording, or generated audio. Pronunciation buttons remain hidden unless you separately configure a compatible speech service running only on `127.0.0.1`.

The in-app **Voice** page contains a copyable prompt for an AI coding agent. The prompt asks the agent to inspect the computer, explain the storage and hardware cost, and set up a separate local service if the machine is suitable. It includes reference paths for Apple Silicon Macs and NVIDIA/CUDA Windows computers. If the hardware or setup is unsuitable, the correct result is to leave voice unavailable; all study features continue to work without it.

Voice models and generated audio stay outside the app, its Git repository, its backup, and its installer.

## For contributors

The reproducible package and test environment are defined by `flake.nix`:

```sh
nix build .#leo-sensei
```

For direct development with Node.js 22 available:

```sh
npm ci
npm test
npm run serve
```

The browser interface is then available at `http://127.0.0.1:8787`. This direct Node.js route does not reproduce the complete desktop gate environment.

The main architecture is a data-transformation pipeline. A versioned catalog provides immutable card definitions, an append-only JSONL event stream records learner actions, and pure folds derive scheduling state, frozen queues, completion, and statistics. The loopback HTTP server adapts those projections to the sandboxed renderer, while the desktop shell owns application observation, platform storage, login startup, and the window.

Read [AGENTS.md](AGENTS.md) before changing the code. It defines the stable contracts, public-data boundary, functional style, and required verification. [AI_CUSTOMIZATION.md](AI_CUSTOMIZATION.md) provides a small prompt and the supported extension points for an AI coding agent.

### Importing an existing export

The migration command can operate as a stream transformer:

```sh
node scripts/migrate-marumori.mjs \
  --state exported-items.json \
  --legacy-log review-log.jsonl \
  > migration.json
```

Explicit `--catalog-out` and `--events-out` paths are available for a one-time local migration. Never add exports, learner state, backups, credentials, browser profiles, logs, speech caches, or voice recordings to Git.

## Sources and licenses

The application source is available under the [ISC License](LICENSE).

The bundled N5-N1 vocabulary lists are unofficial JLPT approximations derived from `open-anki-jlpt-decks`, pinned at commit `1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0`. The JLPT does not publish official vocabulary lists. The source deck project is distributed under the MIT License, Copyright (c) 2020 Jamie Sinclair.

The product may use material from the JMdict and KANJIDIC2 dictionary files. Copyright is held by the Electronic Dictionary Research and Development Group and contributors, and the dictionary material is used under CC BY-SA 4.0.

FSRS scheduling uses `ts-fsrs`, Japanese input uses WanaKana, and the desktop application uses Electron. Dependencies and data sources retain their own terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the complete notices.
