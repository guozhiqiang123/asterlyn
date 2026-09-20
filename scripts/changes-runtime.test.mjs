import assert from "node:assert/strict";
import test from "node:test";

import { ChangesRuntime } from "../src/features/changes-commit/changes-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("Changes runtime owns controller notification and disposal", () => {
  const notifications = [];
  const runtime = new ChangesRuntime({
    root: { querySelector: () => null },
    gateway: {},
    initialFileView: "tree",
    messages: EN_US.changes,
    copy: () => ({ ...EN_US.changes, cancel: EN_US.common.cancel }),
    changed: (change) => notifications.push(change.reason),
  });

  runtime.controller.setCommitMessage("message");
  assert.deepEqual(notifications, ["message"]);
  runtime.dispose();
  runtime.dispose();
  runtime.controller.setCommitMessage("ignored");
  assert.deepEqual(notifications, ["message"]);
});

test("Changes runtime exposes an explicit restore authorization boundary", async () => {
  const runtime = new ChangesRuntime({
    root: { querySelector: () => null },
    gateway: {},
    initialFileView: "tree",
    messages: EN_US.changes,
    copy: () => ({ ...EN_US.changes, cancel: EN_US.common.cancel }),
    changed: () => undefined,
  });
  const review = runtime.reviewRestore(change());
  assert.equal(runtime.restoreReview.state.change?.path, "src/app.ts");
  runtime.restoreReview.confirm();
  assert.equal(await review, true);
  runtime.dispose();
});

function change() {
  return {
    path: "src/app.ts",
    originalPath: null,
    indexStatus: "modified",
    worktreeStatus: "modified",
    conflicted: false,
    submodule: false,
  };
}
