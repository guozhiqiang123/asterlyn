import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ChangesRestoreReviewController } from "../src/features/changes-commit/changes-restore-review-controller.ts";
import { renderChangesRestoreReview } from "../src/features/changes-commit/changes-restore-review-view.ts";
import { EN_US } from "../src/localization/en-US.ts";

const copy = { ...EN_US.changes, cancel: EN_US.common.cancel };
const appSource = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");

test("restore review requires an explicit confirmation and cancel fails closed", async () => {
  const controller = new ChangesRestoreReviewController();
  const cancelled = controller.request(change());
  assert.equal(controller.state.change?.path, "src/app.ts");
  controller.cancel();
  assert.equal(await cancelled, false);

  const confirmed = controller.request(change());
  controller.confirm();
  assert.equal(await confirmed, true);
  assert.equal(controller.state.change, null);
});

test("restore review renders a modal warning with recovery detail and danger action", () => {
  const controller = new ChangesRestoreReviewController();
  void controller.request(change({ indexStatus: "added", worktreeStatus: "added" }));
  const markup = renderChangesRestoreReview(controller.state, copy);

  assert.match(markup, /role="alertdialog"/u);
  assert.match(markup, /src\/app\.ts/u);
  assert.match(markup, /does not exist in HEAD/u);
  assert.match(markup, /class="danger-button"/u);
  assert.match(markup, /data-changes-restore-close/u);
  controller.dispose();
});

test("disposing an open restore review denies authorization", async () => {
  const controller = new ChangesRestoreReviewController();
  const pending = controller.request(change());
  controller.dispose();
  assert.equal(await pending, false);
});

test("the Changes Revert path authorizes through the in-app review before mutation", () => {
  const start = appSource.indexOf("private async revertSelectedChange");
  const end = appSource.indexOf("private renderCommitComposer", start);
  const method = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(method, /window\.confirm/u);
  assert.ok(method.indexOf("reviewRestore(selected)") < method.indexOf("revertSelected(plan)"));
});

function change(overrides = {}) {
  return {
    path: "src/app.ts",
    originalPath: null,
    indexStatus: "modified",
    worktreeStatus: "modified",
    conflicted: false,
    submodule: false,
    ...overrides,
  };
}
