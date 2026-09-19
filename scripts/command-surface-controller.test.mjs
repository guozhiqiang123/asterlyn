import assert from "node:assert/strict";
import test from "node:test";

import { CommandSurfaceController } from "../src/features/files-editor/command-surface-controller.ts";

test("command surface controller owns mode, query, and bounded selection", () => {
  const controller = new CommandSurfaceController();
  assert.deepEqual(controller.state, { mode: null, query: "", selectedIndex: 0 });

  controller.open("files", "src");
  controller.select(3);
  controller.clampSelection(2);
  assert.deepEqual(controller.state, { mode: "files", query: "src", selectedIndex: 1 });

  controller.moveSelection(1, 2);
  assert.equal(controller.state.selectedIndex, 0);
  controller.updateQuery("README");
  assert.equal(controller.state.selectedIndex, 0);
  assert.equal(controller.state.query, "README");

  assert.equal(controller.select(-1), false);
  assert.equal(controller.select(Number.NaN), false);
  controller.close();
  assert.deepEqual(controller.state, { mode: null, query: "", selectedIndex: 0 });
});
