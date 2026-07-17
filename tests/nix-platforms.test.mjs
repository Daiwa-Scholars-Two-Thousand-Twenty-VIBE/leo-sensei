import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const flake = readFileSync(new URL("../flake.nix", import.meta.url), "utf8");
const packageDefinition = readFileSync(new URL("../nix/package.nix", import.meta.url), "utf8");

test("the reproducible CLI and server environment includes x64 Linux", () => {
  assert.match(flake, /"x86_64-linux"/u);
  assert.match(packageDefinition, /lib\.platforms\.unix/u);
});
