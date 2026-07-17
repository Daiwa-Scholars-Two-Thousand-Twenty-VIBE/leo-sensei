# Agent Guide

## Product

The public product name is **Leo Sensei の-nonsense 日本語**. Use the ASCII slug `leo-sensei-no-nonsense-nihongo` for package identifiers and artifact names. Do not introduce another product name or another canonical configuration source.

This repository is public. Never read into, copy into, or commit learner state, exports, backups, logs, browser profiles, credentials, signing keys, model caches, generated audio, or voice-reference recordings. Use synthetic fixtures in tests.

## Architecture

Treat the application as a data-transformation pipeline:

1. A versioned catalog supplies immutable card definitions.
2. An append-only JSONL event stream records learner actions.
3. Pure folds derive FSRS state, the frozen daily queue, completion, and statistics.
4. The loopback HTTP server adapts those projections to the browser UI.
5. The desktop shell owns platform storage, application observation, login startup, and the window. Platform adapters must not leak local checkout paths into application logic.

The event stream is the sole progress source of truth. Never edit or delete historical events, store a second mutable progress summary, or make UI state authoritative. Corrections append compensating events such as `review_answer_voided`.

## Stable Contracts

- Catalog documents are versioned JSON with a `cards` array. Card IDs remain stable across import and restore.
- Events contain a `type` and ISO-8601 `occurredAt`; learner actions also carry the IDs needed for deterministic replay.
- A frozen session remains unchanged for its study day. Configuration changes affect the next unfrozen session.
- The study day resets at 04:00 in the learner's local timezone.
- Gate observation and state-loading failures always allow access. The gate never requires administrator privileges or implements an OS-level lock.
- Mutating HTTP calls are loopback-only and authenticated by the desktop process. Renderer code has no Node access.
- Backup/restore validates the complete versioned document before an atomic replacement and excludes caches and machine-specific application paths.

When a schema changes, add a versioned migration and a round-trip test. Do not redefine the schema independently in Nix, TypeScript, documentation, and infrastructure; one implementation owns the contract and the others consume it.

## Code Style

- Prefer pure functions, immutable values, `const`, and `Object.freeze` for shared constants.
- Use arrow functions and expression-oriented array operations. Do not add `function`, `for`, `while`, or `forEach` when `map`, `filter`, `find`, `reduce`, or `flatMap` expresses the transformation.
- Keep asynchronous boundaries callback- or promise-based; do not add `async`/`await`.
- Keep filesystem effects at explicit adapters. Import/export tools should accept standard input and emit standard output unless a user explicitly supplies paths.
- Use the standard library and existing dependencies before adding a package or abstraction.

## Change Boundaries

- Scheduling and replay: `scripts/lib/learner-core.mjs`, `daily-session.mjs`, and `review-service.mjs`.
- Persistence and runtime wiring: `scripts/lib/storage.mjs`, `runtime.mjs`, and the desktop main process.
- HTTP boundary: `scripts/review-server.mjs`.
- Browser UI: `public/`; keep it a sandboxed client of the HTTP API.
- Platform gate: keep policy pure and platform observation behind adapters.
- Declarative environment: `flake.nix` and `nix/`; host-global installs are unsupported.

Do not couple a feature across these boundaries when one pure projection plus one adapter is sufficient.

## Verification

Run the smallest relevant test while changing behavior, then finish with:

```sh
npm test
npm run check
nix flake check
```

For desktop changes, also build the macOS and Windows installers and smoke-test install, first run, backup/restore, gate fail-open behavior, and uninstall on clean systems. Scan every release artifact for learner data, secrets, local absolute paths, personal voice material, logs, and caches.

**Publication blocker:** the pre-sanitization Git history must not be made public. Publish from a fresh root commit or a verified rewritten history built from the sanitized tree, then scan every reachable commit as well as the release artifacts.

Update `THIRD_PARTY_NOTICES.md` whenever a release begins distributing a new library, dataset, model, or voice.
