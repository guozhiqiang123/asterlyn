import assert from "node:assert/strict";
import test from "node:test";

import { LatestHistoryCount } from "../src/features/git-history/history-total-count.ts";
import { defaultHistoryQuery } from "../src/history-query.ts";

test("identical pending history counts share one backend read", async () => {
  const pending = deferred();
  let reads = 0;
  const counts = new LatestHistoryCount(() => {
    reads += 1;
    return pending.promise;
  });
  const completed = [];
  const query = defaultHistoryQuery();

  counts.request("/repo", query, () => true, (value) => completed.push(value));
  counts.request("/repo", query, () => true, (value) => completed.push(value));
  assert.equal(reads, 1);
  pending.resolve(42);
  await pending.promise;
  await Promise.resolve();
  assert.deepEqual(completed, [42]);
});

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}
