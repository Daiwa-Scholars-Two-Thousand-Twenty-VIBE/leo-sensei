import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendJsonLine, parseJsonLines, readJsonLines } from "../scripts/lib/storage.mjs";

test("parseJsonLines turns an immutable event stream into values", (_, done) =>
  void parseJsonLines('{"type":"a"}\n\n{"type":"b"}\n', (result) => {
    assert.deepEqual(result, {
      ok: true,
      value: [{ type: "a" }, { type: "b" }],
    });
    done();
  }));

test("parseJsonLines returns structured data for a malformed event", (_, done) =>
  void parseJsonLines('{"type":"a"}\nnot-json\n', (result) => {
    assert.deepEqual(result, {
      ok: false,
      error: { code: "INVALID_JSONL", line: 2 },
    });
    done();
  }));

test("appendJsonLine creates the state directory and preserves prior events", (_, done) => {
  const directory = mkdtempSync(join(tmpdir(), "language-learning-"));
  const path = join(directory, "nested", "events.jsonl");
  const finish = (error) => {
    rmSync(directory, { recursive: true, force: true });
    done(error);
  };

  appendJsonLine(path, { type: "a" }, (firstResult) =>
    firstResult.ok
      ? appendJsonLine(path, { type: "b" }, (secondResult) =>
          secondResult.ok
            ? (() => {
                assert.equal(readFileSync(path, "utf8"), '{"type":"a"}\n{"type":"b"}\n');
                finish();
              })()
            : finish(new Error(secondResult.error.message)))
      : finish(new Error(firstResult.error.message)));
});

test("readJsonLines reports a missing event stream as empty", (_, done) =>
  readJsonLines("/definitely/missing/language-learning-events.jsonl", (result) => {
    assert.deepEqual(result, { ok: true, value: [] });
    done();
  }));
