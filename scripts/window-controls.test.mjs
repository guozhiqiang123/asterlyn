import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createWindowControls } from "../src/window-controls.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

test("confirmed window closure destroys the current native window", async () => {
  let destroyed = 0;
  const controls = createWindowControls({
    minimize: async () => undefined,
    toggleMaximize: async () => undefined,
    destroy: async () => {
      destroyed += 1;
    },
    isMaximized: async () => false,
    onResized: async () => () => undefined,
    onCloseRequested: async () => () => undefined,
  });

  assert.equal(controls.available, true);
  await controls.close();
  assert.equal(destroyed, 1);
});

test("project windows grant the destroy command used by close-request handling", () => {
  const capability = JSON.parse(
    readFileSync(
      `${repositoryRoot}src-tauri/capabilities/default.json`,
      "utf8",
    ),
  );
  assert.deepEqual(capability.windows, ["*"]);
  assert.ok(capability.permissions.includes("core:window:allow-destroy"));
});
