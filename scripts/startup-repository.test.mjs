import assert from "node:assert/strict";
import test from "node:test";

import {
  RECENT_REPOSITORIES_KEY,
  RECENT_REPOSITORY_KEY,
  RECENT_REPOSITORY_LIMIT,
  forgetRecentRepository,
  loadRecentRepositories,
  restoreRecentRepository,
  touchRecentRepository,
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
    setItem(key, value) {
      values.set(key, value);
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
      setItem() {},
    },
    async () => false,
    async () => {
      chosen += 1;
    },
  );

  assert.equal(result, "empty");
  assert.equal(chosen, 1);
});

test("recent repositories are deduplicated, bounded, and ordered by successful use", () => {
  const storage = memoryStorage();
  for (let index = 0; index < RECENT_REPOSITORY_LIMIT + 3; index += 1) {
    touchRecentRepository(storage, `/repo-${index}`);
  }
  touchRecentRepository(storage, "/repo-5");

  const paths = loadRecentRepositories(storage);
  assert.equal(paths.length, RECENT_REPOSITORY_LIMIT);
  assert.equal(paths[0], "/repo-5");
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(storage.getItem(RECENT_REPOSITORY_KEY), "/repo-5");
});

test("forgetting a stale repository removes both startup and menu references", () => {
  const storage = memoryStorage();
  touchRecentRepository(storage, "/one");
  touchRecentRepository(storage, "/stale");

  assert.deepEqual(forgetRecentRepository(storage, "/stale"), ["/one"]);
  assert.equal(storage.getItem(RECENT_REPOSITORY_KEY), null);
  assert.deepEqual(loadRecentRepositories(storage), ["/one"]);
});

test("malformed recent-project storage fails closed", () => {
  const storage = memoryStorage();
  storage.setItem(RECENT_REPOSITORIES_KEY, '{"version":1,"paths":"invalid"}');
  assert.deepEqual(loadRecentRepositories(storage), []);
});
