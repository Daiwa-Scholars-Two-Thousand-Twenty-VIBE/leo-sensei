# AI Customization

Use an AI agent only from a clean clone or a branch that contains no learner data. The agent should extend the existing event and adapter model, not invent a parallel store or platform-specific application core.

## Minimal Prompt

```text
Read AGENTS.md first and treat it as the canonical architecture. Implement <describe one change>. Preserve append-only event replay, frozen sessions, local-only storage, gate fail-open behavior, renderer isolation, and cross-platform support. Do not read or commit real learner data, credentials, logs, caches, generated audio, or voice references. Use synthetic fixtures, add the smallest regression test, run the relevant checks, and report changed files and remaining risks.
```

## Safe Extension Points

- Add a deck or importer by producing the versioned catalog contract; prefer stdin to stdout transformation and preserve source attribution.
- Add a learner action by defining one append-only event, its pure replay behavior, and its tests before exposing it through HTTP or UI.
- Add a platform integration behind the existing desktop adapter. Keep bundle IDs, executable identities, and local paths in settings or launcher wiring.
- Configure optional neural speech through the separate loopback-service boundary. The installed app's **Voice** page is the canonical copyable prompt; keep models, runtimes, recordings, and generated audio outside this repository and every installer.

Before sharing a customized build, inspect the git diff and packaged artifacts. Reject any artifact containing `catalog.json`, `events.jsonl`, backups, `.env` files, private keys, browser profiles, logs, model caches, or personal recordings.
