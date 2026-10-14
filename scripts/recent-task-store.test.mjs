import assert from "node:assert/strict";
import test from "node:test";
import { RecentTaskStore } from "../src/application/tasks/recent-task-store.ts";

const record = (i, status = "succeeded") => ({ pluginId: "p", providerId: "provider", taskId: `task-${i}`, label: `Task ${i}`, status, timestamp: i });

test("recent task store is bounded and stores only the profile whitelist", () => {
  const values = new Map();
  const store = new RecentTaskStore({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  for (let i = 0; i < 25; i += 1) store.record({ ...record(i), executablePath: "/secret", args: ["secret"] });
  assert.equal(store.list().length, 20);
  assert.equal(Object.hasOwn(store.list()[0], "executablePath"), false);
  assert.equal(Object.hasOwn(store.list()[0], "args"), false);
});

test("corrupt recent task profile fails closed", () => {
  const values = new Map([["recent", "{broken"]]);
  const store = new RecentTaskStore({ getItem: (key) => values.get(key) ?? null, setItem: () => undefined }, "recent");
  assert.deepEqual(store.list(), []);
  values.set("recent", JSON.stringify([{ pluginId: "p", providerId: "x", taskId: "t", label: "T", status: "bad", timestamp: 1 }]));
  assert.deepEqual(store.list(), []);
  values.set("recent", JSON.stringify([record(1), { ...record(2), status: "bad" }]));
  assert.deepEqual(store.list(), []);
  values.set("recent", " ".repeat(64 * 1024 + 1));
  assert.deepEqual(store.list(), []);
});
