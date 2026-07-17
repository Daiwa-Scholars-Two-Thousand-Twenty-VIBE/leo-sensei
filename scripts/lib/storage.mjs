import { appendFile, mkdir, readFile } from "node:fs";
import { dirname } from "node:path";

const errorResult = (code) => (error) => ({
  ok: false,
  error: { code, message: error instanceof Error ? error.message : String(error) },
});

const parseLine = ({ line, lineNumber }) =>
  Promise.resolve(line)
    .then(JSON.parse)
    .then((value) => ({ ok: true, value }))
    .catch(() => ({ ok: false, error: { code: "INVALID_JSONL", line: lineNumber } }));

export const parseJsonLines = (text, callback) =>
  Promise.all(
    String(text)
      .split(/\r?\n/u)
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter(({ line }) => line.trim().length > 0)
      .map(parseLine),
  ).then((results) =>
    callback(
      results.find((result) => !result.ok) ?? {
        ok: true,
        value: results.map(({ value }) => value),
      },
    ));

export const readJsonLines = (path, callback) =>
  readFile(path, "utf8", (error, text) =>
    error?.code === "ENOENT"
      ? callback({ ok: true, value: [] })
      : error
        ? callback(errorResult("READ_FAILED")(error))
        : parseJsonLines(text, callback));

export const appendJsonLine = (path, value, callback) =>
  Promise.resolve(value)
    .then(JSON.stringify)
    .then((line) =>
      mkdir(dirname(path), { recursive: true }, (directoryError) =>
        directoryError
          ? callback(errorResult("CREATE_STATE_DIRECTORY_FAILED")(directoryError))
          : appendFile(path, `${line}\n`, { encoding: "utf8", flag: "a" }, (appendError) =>
              callback(
                appendError
                  ? errorResult("APPEND_FAILED")(appendError)
                  : { ok: true, value },
              ))))
    .catch((error) => callback(errorResult("SERIALIZE_FAILED")(error)));
