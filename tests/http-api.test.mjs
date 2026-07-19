import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReviewServer } from "../scripts/review-server.mjs";

const requestJson = ({ port, method = "GET", path, body, headers = {} }, callback) => {
  const payload = body ? JSON.stringify(body) : "";
  const operation = request(
    {
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: {
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    },
    (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => callback({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    },
  );
  operation.end(payload);
};

test("configured mutation token protects writes without changing standalone server compatibility", (_, done) => {
  const files = fixture();
  const token = "desktop-session-token";
  const server = createReviewServer({
    ...files,
    mutationToken: token,
    now: () => "2026-07-15T01:00:00.000Z",
    ttsFetch: () => Promise.resolve(new Response(null, { status: 502 })),
  });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    requestJson({ port, path: "/api/daily" }, (daily) => {
      assert.equal(daily.status, 200);
      requestJson({
        port,
        method: "POST",
        path: "/api/reading-check",
        body: { cardId: "k-1", readingAnswer: "まねく" },
      }, (reading) => {
        assert.equal(reading.status, 200);
        requestJson({ port, method: "POST", path: "/api/bypass", body: { reason: "Required" } }, (missing) => {
          assert.equal(missing.status, 403);
          requestJson({
            port,
            method: "POST",
            path: "/api/bypass",
            body: { reason: "Required" },
            headers: { "X-Leo-Sensei-Mutation-Token": "wrong" },
          }, (wrong) => {
            assert.equal(wrong.status, 403);
            requestJson({
              port,
              method: "POST",
              path: "/api/bypass",
              body: { reason: "Required" },
              headers: { "X-Leo-Sensei-Mutation-Token": token },
            }, (authorized) => {
              assert.equal(authorized.status, 201);
              server.close(() => {
                rmSync(files.directory, { recursive: true, force: true });
                done();
              });
            });
          });
        });
      });
    });
  });
});

const requestText = ({ port, path }, callback) => {
  const operation = request({ hostname: "127.0.0.1", port, path }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => callback({
      status: response.statusCode,
      contentType: response.headers["content-type"],
      body: Buffer.concat(chunks).toString("utf8"),
    }));
  });
  operation.end();
};

const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "language-http-"));
  const catalogFile = join(directory, "catalog.json");
  const eventsFile = join(directory, "events.jsonl");
  const catalog = {
    version: 1,
    cards: [{ id: "k-1", type: "kanji", item: "招", reading: "まねく", meanings: ["beckon"], provenance: { marumori: { level: 4 } } }],
  };
  const baseline = {
    type: "marumori_baseline",
    cardId: "k-1",
    occurredAt: "2026-07-01T00:00:00.000Z",
    reviewedAt: "2026-07-01T00:00:00.000Z",
    dueAt: "2026-07-02T00:00:00.000Z",
    scheduled: true,
  };
  writeFileSync(catalogFile, JSON.stringify(catalog));
  writeFileSync(eventsFile, `${JSON.stringify(baseline)}\n`);
  return { directory, catalogFile, eventsFile };
};

const backlogFixture = () => {
  const files = fixture();
  const cards = Array.from({ length: 600 }, (_, index) => ({
    id: `v-${String(index).padStart(3, "0")}`,
    type: "vocabulary",
    item: `word ${index}`,
    reading: `ことば${index}`,
    meanings: [`word ${index}`],
    provenance: { marumori: { level: 4 } },
  }));
  const baselines = cards.map(({ id }) => ({
    type: "marumori_baseline",
    cardId: id,
    occurredAt: "2026-07-01T00:00:00.000Z",
    reviewedAt: "2026-07-01T00:00:00.000Z",
    dueAt: "2026-07-02T00:00:00.000Z",
    scheduled: true,
  }));
  writeFileSync(files.catalogFile, JSON.stringify({ version: 1, cards }));
  writeFileSync(files.eventsFile, `${baselines.map(JSON.stringify).join("\n")}\n`);
  return files;
};

test("HTTP API exposes daily status and validates bypass reasons", (_, done) => {
  const files = fixture();
  const server = createReviewServer({
    ...files,
    now: () => "2026-07-15T01:00:00.000Z",
    ttsFetch: () => Promise.resolve(new Response(null, { status: 502 })),
  });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    requestJson({ port, path: "/api/daily" }, (daily) => {
      assert.equal(daily.status, 200);
      assert.equal(daily.body.complete, false);
      assert.equal(daily.body.speechAvailable, false);
      assert.equal(daily.body.accessAllowed, false);
      assert.deepEqual(daily.body.queue.map(({ id }) => id), ["k-1"]);
      requestJson({ port, method: "POST", path: "/api/reading-check", body: { cardId: "k-1", readingAnswer: "しょう" } }, (reading) => {
        assert.equal(reading.status, 200);
        assert.equal(reading.body.correct, false);
        requestJson({ port, method: "POST", path: "/api/extra", body: {} }, (extra) => {
          assert.equal(extra.status, 201);
          assert.equal(extra.body.extra, true);
          assert.match(extra.body.extraSessionId, /^extra:/u);
          requestJson({ port, method: "POST", path: "/api/bypass", body: { reason: "" } }, (invalid) => {
            assert.equal(invalid.status, 400);
            requestJson({ port, method: "POST", path: "/api/bypass", body: { reason: "Client call" } }, (valid) => {
              assert.equal(valid.status, 201);
              assert.equal(valid.body.bypassUntil, "2026-07-15T05:00:00.000Z");
              assert.equal(valid.body.targetStudyDate, "2026-07-16");
              assert.equal(valid.body.carryoverCount, 50);
              assert.equal(valid.body.durationMinutes, 240);
              assert.equal(valid.body.alreadyRecorded, false);
              requestJson({ port, path: "/api/daily" }, (bypassed) => {
                assert.equal(bypassed.body.bypassMinutes, 240);
                assert.equal(bypassed.body.makeupTomorrow, 50);
                assert.equal(bypassed.body.availableReviews, 1);
                requestJson({ port, method: "POST", path: "/api/alias", body: { cardId: "k-1", kind: "reading", value: "しょう" } }, (alias) => {
                  assert.equal(alias.status, 201);
                  assert.equal(alias.body.alias.type, "reading_alias_added");
                  assert.equal(alias.body.alias.value, "しょう");
                  server.close(() => {
                    rmSync(files.directory, { recursive: true, force: true });
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

test("HTTP settings, import, backup, and restore share one versioned learner-state contract", (_, done) => {
  const files = fixture();
  const stateFiles = {
    ...files,
    settingsFile: join(files.directory, "settings.json"),
    customListsFile: join(files.directory, "custom-lists.json"),
  };
  const server = createReviewServer({
    ...stateFiles,
    now: () => "2026-07-16T02:00:00.000Z",
    ttsFetch: () => Promise.resolve(new Response(null, { status: 502 })),
  });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    requestJson({ port, path: "/api/settings" }, (initial) => {
      assert.equal(initial.status, 200);
      assert.equal(initial.body.onboardingComplete, false);
      requestJson({
        port,
        method: "PUT",
        path: "/api/settings",
        body: { ...initial.body, studyListDailyNew: { "n3-vocabulary": 12 }, requiredDailyCount: 20, gateMode: "prompt", onboardingComplete: true },
      }, (saved) => {
        assert.equal(saved.status, 200);
        assert.equal(saved.body.requiredDailyCount, 20);
        requestJson({
          port,
          method: "POST",
          path: "/api/import",
          body: { label: "Applications", table: "word,reading,meaning,type\n応募,おうぼ,application,vocabulary\n" },
        }, (imported) => {
          assert.equal(imported.status, 201);
          assert.equal(imported.body.importedCards, 1);
          requestJson({ port, path: "/api/backup" }, (backup) => {
            assert.equal(backup.status, 200);
            assert.equal(backup.body.version, 1);
            assert.deepEqual(backup.body.settings.studyListDailyNew, { "n3-vocabulary": 12 });
            assert.equal(backup.body.customLists.length, 1);
            assert.equal(backup.body.catalog.cards.length, 2);
            requestJson({ port, method: "POST", path: "/api/restore", body: backup.body }, (restored) => {
              assert.equal(restored.status, 200);
              assert.equal(restored.body.restored, true);
              assert.match(restored.body.preRestoreBackupFile, /pre-restore-/u);
              assert.deepEqual(JSON.parse(readFileSync(stateFiles.settingsFile, "utf8")).studyListDailyNew, { "n3-vocabulary": 12 });
              server.close(() => {
                rmSync(files.directory, { recursive: true, force: true });
                done();
              });
            });
          });
        });
      });
    });
  });
});

test("HTTP study-list quotas install enabled decks and freeze one combined resumable daily lesson", (_, done) => {
  const files = fixture();
  const decksDir = join(files.directory, "decks");
  const deck = {
    version: 1,
    id: "n5-vocabulary",
    title: "Approximate JLPT N5 Vocabulary",
    level: "N5",
    type: "vocabulary",
    unofficial: true,
    source: { name: "fixture", commit: "test", license: "MIT" },
    cards: [{ id: "jlpt:n5:one", type: "vocabulary", item: "会う", reading: "あう", readings: ["あう"], meanings: ["meet"], provenance: { jlpt: { deckIds: ["n5-vocabulary"], baselineKnown: false } } }],
  };
  const n4Deck = {
    ...deck,
    id: "n4-vocabulary",
    title: "Approximate JLPT N4 Vocabulary",
    level: "N4",
    cards: [{ id: "jlpt:n4:one", type: "vocabulary", item: "続く", reading: "つづく", readings: ["つづく"], meanings: ["continue"], provenance: { jlpt: { deckIds: ["n4-vocabulary"], baselineKnown: false } } }],
  };
  writeFileSync(join(files.directory, "manifest.json"), "unused");
  mkdirSync(decksDir);
  writeFileSync(join(decksDir, "manifest.json"), JSON.stringify({ version: 1, decks: [
    { id: deck.id, file: "n5-vocabulary.json", title: deck.title, level: deck.level, cards: 1, unofficial: true, source: deck.source },
    { id: n4Deck.id, file: "n4-vocabulary.json", title: n4Deck.title, level: n4Deck.level, cards: 1, unofficial: true, source: n4Deck.source },
  ] }));
  writeFileSync(join(decksDir, "n5-vocabulary.json"), JSON.stringify(deck));
  writeFileSync(join(decksDir, "n4-vocabulary.json"), JSON.stringify(n4Deck));
  const server = createReviewServer({ ...files, decksDir, settingsFile: join(files.directory, "settings.json") });

  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    requestJson({ port, path: "/api/decks" }, (listed) => {
      assert.equal(listed.status, 200);
      assert.equal(listed.body.decks[0].unofficial, true);
      requestJson({ port, path: "/api/study-lists" }, (initial) => {
        assert.deepEqual(initial.body.lists.map(({ id, dailyNew }) => [id, dailyNew]), [
          ["n5-vocabulary", 10],
          ["n4-vocabulary", 0],
        ]);
        requestJson({ port, method: "POST", path: "/api/study-lists", body: { dailyLimits: { "n5-vocabulary": 1, "n4-vocabulary": 1 } } }, (selected) => {
          assert.equal(selected.status, 200);
          assert.equal(selected.body.installedCards, 2);
          assert.deepEqual(selected.body.settings.studyListDailyNew, { "n5-vocabulary": 1, "n4-vocabulary": 1 });
          requestJson({ port, method: "POST", path: "/api/lesson/today", body: {} }, (lesson) => {
            assert.equal(lesson.status, 201);
            assert.deepEqual(lesson.body.lessonCards.map(({ id }) => id), ["jlpt:n5:one", "jlpt:n4:one"]);
            requestJson({ port, method: "POST", path: "/api/lesson/today", body: {} }, (resumed) => {
              assert.equal(resumed.status, 200);
              assert.deepEqual(resumed.body.lessonCards.map(({ id }) => id), lesson.body.lessonCards.map(({ id }) => id));
              server.close(() => {
                rmSync(files.directory, { recursive: true, force: true });
                done();
              });
            });
          });
        });
      });
    });
  });
});

test("HTTP server serves browser modules with a JavaScript MIME type", (_, done) => {
  const files = fixture();
  const server = createReviewServer({ ...files });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    requestText({ port, path: "/ui-core.mjs" }, (response) => {
      assert.equal(response.status, 200);
      assert.equal(response.contentType, "text/javascript; charset=utf-8");
      assert.match(response.body, /export const initialUiState/u);
      requestText({ port, path: "/vendor/wanakana.mjs" }, (vendor) => {
        assert.equal(vendor.status, 200);
        assert.equal(vendor.contentType, "text/javascript; charset=utf-8");
        assert.match(vendor.body, /toHiragana/u);
        server.close(() => {
          rmSync(files.directory, { recursive: true, force: true });
          done();
        });
      });
    });
  });
});

test("HTTP extra starts an optional batch of at most 100 additional due cards", (_, done) => {
  const files = backlogFixture();
  const server = createReviewServer({
    ...files,
    now: () => "2026-07-15T01:00:00.000Z",
    ttsFetch: () => Promise.resolve(new Response(null, { status: 502 })),
  });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    requestJson({ port, path: "/api/daily" }, (daily) => {
      assert.equal(daily.body.availableReviews, 600);
      requestJson({ port, method: "POST", path: "/api/extra", body: {} }, (extra) => {
        assert.equal(extra.status, 201);
        assert.equal(extra.body.extra, true);
        assert.equal(extra.body.queue.length, 100);
        server.close(() => {
          rmSync(files.directory, { recursive: true, force: true });
          done();
        });
      });
    });
  });
});

test("HTTP redo voids the latest answer and returns that card to the queue", (_, done) => {
  const files = fixture();
  const server = createReviewServer({ ...files, now: () => "2026-07-15T01:00:00.000Z" });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    requestJson({
      port,
      method: "POST",
      path: "/api/review",
      body: { cardId: "k-1", readingAnswer: "まねく", meaningAnswer: "beckon" },
    }, (reviewed) => {
      assert.equal(reviewed.status, 200);
      assert.match(reviewed.body.answerEventId, /^[0-9a-f-]{36}$/u);
      assert.equal(reviewed.body.daily.complete, true);
      requestJson({
        port,
        method: "POST",
        path: "/api/review/redo",
        body: { answerEventId: reviewed.body.answerEventId },
      }, (redone) => {
        assert.equal(redone.status, 200);
        assert.equal(redone.body.redone, true);
        assert.equal(redone.body.cardId, "k-1");
        assert.equal(redone.body.daily.complete, false);
        assert.deepEqual(redone.body.daily.queue.map(({ id }) => id), ["k-1"]);
        requestJson({
          port,
          method: "POST",
          path: "/api/review/redo",
          body: { answerEventId: reviewed.body.answerEventId },
        }, (stale) => {
          assert.equal(stale.status, 409);
          server.close(() => {
            rmSync(files.directory, { recursive: true, force: true });
            done();
          });
        });
      });
    });
  });
});

test("HTTP speech proxy sends a model-neutral request to an explicit local service", (_, done) => {
  const files = fixture();
  const requests = [];
  const ttsFetch = (url, options) => (
    requests.push({ url, body: JSON.parse(options.body) }),
    Promise.resolve(new Response(Buffer.from("RIFFvoice"), {
      status: 200,
      headers: { "Content-Type": "audio/wav" },
    }))
  );
  const server = createReviewServer({
    ...files,
    speechCacheDir: join(files.directory, "speech-cache"),
    ttsEndpoint: "http://127.0.0.1:8788/v1/audio/speech",
    ttsFetch,
  });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    requestText({ port, path: `/api/speech?text=${encodeURIComponent("いたい")}` }, (response) => {
      assert.equal(response.status, 200);
      assert.equal(response.contentType, "audio/wav");
      assert.equal(response.body, "RIFFvoice");
      assert.deepEqual(requests, [{
        url: "http://127.0.0.1:8788/v1/audio/speech",
        body: {
          input: "いたい",
          response_format: "wav",
          stream: false,
        },
      }]);
      server.close(() => {
        rmSync(files.directory, { recursive: true, force: true });
        done();
      });
    });
  });
});

test("HTTP speech proxy caches an external local service request", (_, done) => {
  const files = fixture();
  const requests = [];
  const ttsFetch = (url, options) => (
    requests.push({ url, body: JSON.parse(options.body) }),
    Promise.resolve(new Response(Buffer.from("RIFFvoice"), {
      status: 200,
      headers: { "Content-Type": "audio/wav" },
    }))
  );
  const server = createReviewServer({
    ...files,
    speechCacheDir: join(files.directory, "speech-cache"),
    ttsEndpoint: "http://127.0.0.1:8788/v1/audio/speech",
    ttsFetch,
  });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    const path = `/api/speech?text=${encodeURIComponent("いたい")}`;
    requestText({ port, path }, (first) => {
      assert.equal(first.status, 200);
      assert.equal(first.body, "RIFFvoice");
      requestText({ port, path }, (second) => {
        assert.equal(second.status, 200);
        assert.equal(second.body, "RIFFvoice");
        assert.deepEqual(requests, [{
          url: "http://127.0.0.1:8788/v1/audio/speech",
          body: {
            input: "いたい",
            response_format: "wav",
            stream: false,
          },
        }]);
        server.close(() => {
          rmSync(files.directory, { recursive: true, force: true });
          done();
        });
      });
    });
  });
});

test("HTTP speech stays external and disabled when no loopback endpoint is configured", (_, done) => {
  const files = fixture();
  const requests = [];
  const server = createReviewServer({
    ...files,
    speechCacheDir: join(files.directory, "speech-cache"),
    ttsEndpoint: "",
    ttsFetch: (...input) => (requests.push(input), Promise.reject(new Error("must not fetch"))),
  });

  server.listen(0, "127.0.0.1", () => requestText({
    port: server.address().port,
    path: `/api/speech?text=${encodeURIComponent("いたい")}`,
  }, (response) => (
    assert.equal(response.status, 502),
    assert.deepEqual(requests, []),
    server.close(() => (
      rmSync(files.directory, { recursive: true, force: true }),
      done()
    ))
  )));
});

test("HTTP daily status prewarms queued pronunciations without exposing readings", (_, done) => {
  const files = fixture();
  const requests = [];
  const { promise: prewarmed, resolve: markPrewarmed } = Promise.withResolvers();
  const ttsFetch = (_url, options) => (
    requests.push(JSON.parse(options.body)),
    markPrewarmed(),
    Promise.resolve(new Response(Buffer.from("RIFFprewarm"), {
      status: 200,
      headers: { "Content-Type": "audio/wav" },
    }))
  );
  const server = createReviewServer({
    ...files,
    speechCacheDir: join(files.directory, "speech-cache"),
    ttsEndpoint: "http://127.0.0.1:8788/v1/audio/speech",
    ttsFetch,
  });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    requestJson({ port, path: "/api/daily" }, (daily) => {
      assert.equal(daily.status, 200);
      assert.equal(daily.body.speechAvailable, true);
      assert.equal(Object.hasOwn(daily.body.queue[0], "reading"), false);
      prewarmed.then(() => {
        assert.equal(requests.length, 1);
        assert.deepEqual(requests[0], {
          input: "まねく",
          response_format: "wav",
          stream: false,
        });
        server.close(() => {
          rmSync(files.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
          done();
        });
      });
    });
  });
});
