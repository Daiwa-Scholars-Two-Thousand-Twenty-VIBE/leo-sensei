import assert from "node:assert/strict";
import test from "node:test";

import { jsonMutationOptions } from "../public/http.mjs";

test("desktop JSON mutations include the preload-owned session header", () => {
  const options = jsonMutationOptions("POST", { cardId: "k-1" }, {
    mutationHeaders: () => ({ "X-Leo-Sensei-Mutation-Token": "session-token" }),
  });

  assert.deepEqual(options, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Leo-Sensei-Mutation-Token": "session-token",
    },
    body: JSON.stringify({ cardId: "k-1" }),
  });
});

test("browser-only JSON mutations remain compatible without a desktop bridge", () => {
  assert.deepEqual(jsonMutationOptions("PUT", { enabled: true }, null), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
});
