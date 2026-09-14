import assert from "node:assert/strict";
import test from "node:test";

import { remoteOperationCompletionFeedback } from "../src/features/remote-push/remote-operation-feedback.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("an unchanged Update receives prominent already-current feedback", () => {
  const before = repository("a");
  const result = remoteOperationCompletionFeedback(
    "pull",
    before,
    { snapshot: repository("a"), invalidatedSlices: [] },
    EN_US.remote,
  );

  assert.deepEqual(result, {
    message: EN_US.remote.alreadyUpToDate,
    prominent: true,
  });
});

test("a changed Update and Fetch retain ordinary completion feedback", () => {
  assert.deepEqual(
    remoteOperationCompletionFeedback(
      "pull",
      repository("a"),
      { snapshot: repository("b"), invalidatedSlices: [] },
      EN_US.remote,
    ),
    {
      message: EN_US.remote.operationCompleted(EN_US.remote.actionNames.pull),
      prominent: false,
    },
  );
  assert.equal(
    remoteOperationCompletionFeedback(
      "fetch",
      repository("a"),
      { snapshot: repository("a"), invalidatedSlices: [] },
      EN_US.remote,
    ).prominent,
    false,
  );
});

function repository(oid) {
  return { branch: { oid } };
}
