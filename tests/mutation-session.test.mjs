import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("sandboxed preload reads the dedicated argument using only Electron's bridge", () => {
  const exposed = [];
  const source = readFileSync(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => exposed.push({ name, value }) },
    ipcRenderer: { invoke: () => null },
  };
  const context = vm.createContext({
    process: {
      platform: "darwin",
      argv: ["electron", "--unrelated=value", "--leo-sensei-mutation-token=session-token"],
    },
    require: (moduleName) => (assert.equal(moduleName, "electron"), electron),
  });

  vm.runInContext(source, context);

  assert.equal(exposed[0].name, "desktop");
  assert.deepEqual({ ...exposed[0].value.mutationHeaders() }, {
    "X-Leo-Sensei-Mutation-Token": "session-token",
  });
});
