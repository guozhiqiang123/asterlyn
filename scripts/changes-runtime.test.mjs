import assert from "node:assert/strict";
import test from "node:test";

import { ChangesRuntime } from "../src/features/changes-commit/changes-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("Changes runtime owns controller notification and disposal", () => {
  const notifications = [];
  const runtime = new ChangesRuntime({
    gateway: {},
    initialFileView: "tree",
    messages: EN_US.changes,
    changed: (change) => notifications.push(change.reason),
  });

  runtime.controller.setCommitMessage("message");
  assert.deepEqual(notifications, ["message"]);
  runtime.dispose();
  runtime.dispose();
  runtime.controller.setCommitMessage("ignored");
  assert.deepEqual(notifications, ["message"]);
});
