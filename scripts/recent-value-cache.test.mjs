import assert from "node:assert/strict";
import test from "node:test";

import { RecentValueCache } from "../src/workbench/recent-value-cache.ts";

test("recent value cache promotes reads and evicts the least-recent entry", () => {
  const cache = new RecentValueCache(2);
  cache.set("first", 1);
  cache.set("second", 2);

  assert.equal(cache.get("first"), 1);
  cache.set("third", 3);

  assert.equal(cache.get("second"), undefined);
  assert.equal(cache.get("first"), 1);
  assert.equal(cache.get("third"), 3);
  assert.equal(cache.size, 2);
});

test("recent value cache replaces an existing value without consuming capacity", () => {
  const cache = new RecentValueCache(1);
  cache.set("commit", "old");
  cache.set("commit", "new");

  assert.equal(cache.get("commit"), "new");
  assert.equal(cache.size, 1);
});

test("recent value cache rejects unusable capacities", () => {
  assert.throws(() => new RecentValueCache(0), /positive integer/);
  assert.throws(() => new RecentValueCache(1.5), /positive integer/);
});
