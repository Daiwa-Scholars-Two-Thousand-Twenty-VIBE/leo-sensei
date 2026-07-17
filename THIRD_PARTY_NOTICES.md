# Third-Party Notices

Leo Sensei の-nonsense 日本語 is licensed under GPL-3.0-or-later. The following components and data keep their own licenses and are not relicensed under the GPL.

## Runtime Libraries

| Component | Purpose | License |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) | Desktop runtime | MIT |
| [electron-squirrel-startup](https://github.com/mongodb-js/electron-squirrel-startup) | Windows installer startup handling | Apache-2.0 |
| [get-windows](https://github.com/sindresorhus/get-windows) | Active application detection on Windows | MIT |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | Spaced-repetition scheduling | MIT |
| [WanaKana](https://github.com/WaniKani/WanaKana) | Romaji and kana conversion | MIT |

The exact JavaScript dependency graph and versions are recorded in `package-lock.json`.

## Dictionary Data

Release builds that include data derived from **JMdict** or **KANJIDIC2** must retain the source attribution and ShareAlike terms required by the Electronic Dictionary Research and Development Group (EDRDG). Those files are provided under Creative Commons Attribution-ShareAlike 4.0.

- [EDRDG General Dictionary Licence Statement](https://www.edrdg.org/edrdg/licence.html)
- [JMdict/EDICT Dictionary Project](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project)
- [KANJIDIC Project](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project)

Suggested in-app acknowledgement:

> This product uses material from the JMdict and/or KANJIDIC2 dictionary files. Copyright is held by the Electronic Dictionary Research and Development Group and contributors. The dictionary material is used under CC BY-SA 4.0.

The application must expose this acknowledgement from an About or Sources view whenever it distributes a significant extract or derived vocabulary list. Do not claim copyright over EDRDG material. Keep derived dictionary data identifiable so its ShareAlike obligations do not become ambiguous.

The bundled JLPT vocabulary decks are derived from [jamsinclair/open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) at commit `1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0`, licensed under MIT. Copyright (c) 2020 Jamie Sinclair. See `decks/SOURCE.md` for the exact derivation and upstream license.

## Release Check

Before publishing an installer, generate the dependency license inventory from the locked build, compare it with this notice, and inspect the final artifact. A lock file is reproducibility metadata; it is not a substitute for the notices that must accompany redistributed binaries, data, models, or voices.
