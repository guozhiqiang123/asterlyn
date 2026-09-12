import assert from "node:assert/strict";
import test from "node:test";

import {
  filesForPushReview,
  nextPushCommitSelection,
  pushConfirmationAvailability,
} from "../src/workbench/push-review.ts";

const aggregate = [
  { path: "src/one.ts", originalPath: null, status: "modified" },
  { path: "src/two.ts", originalPath: null, status: "added" },
];
const details = {
  repositoryId: ".",
  oid: "selected",
  parentOid: "parent",
  files: [aggregate[1]],
};

test("Push review starts with the aggregate outgoing file range", () => {
  assert.equal(filesForPushReview(aggregate, null, null), aggregate);
});

test("selecting one outgoing commit narrows review to that commit", () => {
  assert.deepEqual(filesForPushReview(aggregate, "selected", details), [aggregate[1]]);
});

test("stale commit details cannot populate a different selection", () => {
  assert.deepEqual(filesForPushReview(aggregate, "other", details), []);
});

test("activating the selected outgoing commit restores aggregate review", () => {
  assert.equal(nextPushCommitSelection(null, "selected"), "selected");
  assert.equal(nextPushCommitSelection("selected", "selected"), null);
  assert.equal(nextPushCommitSelection("selected", "other"), "other");
});

test("tag refresh blocks activation without visually disabling Push", () => {
  assert.deepEqual(
    pushConfirmationAvailability({
      operationActive: false,
      previewLoading: false,
      previewRefreshing: true,
      actionable: true,
      modeAllowed: true,
    }),
    { nativeDisabled: false, ariaDisabled: true },
  );
});

test("unavailable push remains natively disabled", () => {
  assert.deepEqual(
    pushConfirmationAvailability({
      operationActive: false,
      previewLoading: false,
      previewRefreshing: false,
      actionable: false,
      modeAllowed: true,
    }),
    { nativeDisabled: true, ariaDisabled: true },
  );
});
