import assert from "node:assert/strict";
import test from "node:test";

import { RepositoryOperationCoordinator } from "../src/application/repository-operation-coordinator.ts";

test("repository operation coordinator rejects successes and failures from stale transitions", async () => {
  let generation = 0;
  let root = "/repo";
  const session = {
    beginTransition() { return ++generation; },
    matches(candidate, candidateRoot) {
      return generation === candidate && root === candidateRoot;
    },
  };
  const coordinator = new RepositoryOperationCoordinator(session);
  const pending = deferred();
  const first = coordinator.start(root, () => pending.promise);
  const second = coordinator.start(root, async () => outcome(root));
  pending.resolve(outcome(root));
  assert.equal((await first.completion).status, "stale");
  assert.equal((await second.completion).status, "success");

  const failure = coordinator.start(root, async () => { throw new Error("failed"); });
  assert.equal((await failure.completion).status, "failure");
  const moved = coordinator.start(root, async () => outcome(root));
  root = "/other";
  assert.equal((await moved.completion).status, "stale");
});

function outcome(root) {
  return {
    snapshot: { root },
    invalidatedSlices: ["workingTree"],
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
