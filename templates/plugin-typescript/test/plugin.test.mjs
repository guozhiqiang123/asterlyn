import assert from "node:assert/strict";
import test from "node:test";

import { HELLO_PLUGIN, HELLO_PLUGIN_ID } from "../src/plugin.ts";

test("template plugin publishes one disposable command without host authority", () => {
  const contributions = [];
  let disposed = false;
  const activation = HELLO_PLUGIN.activate({
    identity: { root: "/workspace", generation: 1 },
    evidence: [],
    taskCache: {},
    contribute: (contribution) => {
      contributions.push(contribution);
      return { dispose: () => { disposed = true; } };
    },
  });

  assert.equal(HELLO_PLUGIN.id, HELLO_PLUGIN_ID);
  assert.equal(HELLO_PLUGIN.sdkMajor, 1);
  assert.equal(contributions.length, 1);
  assert.equal(contributions[0].kind, "command");
  assert.equal(contributions[0].id, "hello.sayHello");
  assert.equal(contributions[0].title(), "Hello from plugin");
  activation.dispose();
  assert.equal(disposed, true);
});
