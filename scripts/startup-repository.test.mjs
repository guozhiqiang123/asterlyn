import assert from "node:assert/strict";
import test from "node:test";

import {
  RECENT_REPOSITORY_KEY,
  restoreRecentRepository,
} from "../src/workbench/startup-repository.ts";

function memoryStorage(recent = null) {
  const values = new Map(recent === null ? [] : [[RECENT_REPOSITORY_KEY, recent]]);
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("opens a valid recent repository without showing the chooser", async () => {
  const storage = memoryStorage("/repo");
  let chosen = 0;
  const result = await restoreRecentRepository(
    storage,
    async (path) => path === "/repo",
    async () => {
      chosen += 1;
    },
  );

  assert.equal(result, "opened");
  assert.equal(chosen, 0);
  assert.equal(storage.getItem(RECENT_REPOSITORY_KEY), "/repo");
});

test("forgets a stale recent repository and opens the chooser without failing", async () => {
  const storage = memoryStorage("/tmp/asterlyn-native-smoke-deleted");
  let chosen = 0;
  const result = await restoreRecentRepository(
    storage,
    async () => {
      throw new Error("fatal: cannot change to deleted fixture");
    },
    async () => {
      chosen += 1;
    },
  );

  assert.equal(result, "recovered");
  assert.equal(chosen, 1);
  assert.equal(storage.getItem(RECENT_REPOSITORY_KEY), null);
});

test("storage failure still reaches the first-project chooser", async () => {
  let chosen = 0;
  const result = await restoreRecentRepository(
    {
      getItem() {
        throw new Error("storage unavailable");
      },
      removeItem() {},
    },
    async () => false,
    async () => {
      chosen += 1;
    },
  );

  assert.equal(result, "empty");
  assert.equal(chosen, 1);
});
