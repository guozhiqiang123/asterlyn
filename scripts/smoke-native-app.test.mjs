import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import {
  createRepositoryFixture,
  smokeProcess,
} from "./smoke-native-app.mjs";

const execFileAsync = promisify(execFile);

test("accepts a process that remains alive for the observation window", async () => {
  const result = await smokeProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1_000)"],
    observationMs: 80,
    shutdownGraceMs: 500,
  });

  assert.equal(result.observationMs, 80);
});

test("rejects a process that exits during the observation window", async () => {
  await assert.rejects(
    smokeProcess({
      command: process.execPath,
      args: ["-e", "console.error('startup failed'); process.exit(7)"],
      observationMs: 500,
    }),
    (error) => {
      assert.match(error.message, /exited before the 500 ms observation window/);
      assert.match(error.message, /Exit code: 7/);
      assert.match(error.message, /startup failed/);
      return true;
    },
  );
});

test("creates an isolated repository with tracked and untracked changes", async () => {
  const fixture = await createRepositoryFixture();
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      fixture,
      "status",
      "--short",
    ]);
    assert.match(stdout, / M tracked\.txt/);
    assert.match(stdout, /\?\? untracked\.txt/);
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
});
