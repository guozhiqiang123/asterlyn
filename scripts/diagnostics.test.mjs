import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiagnosticReporter, normalizeDiagnosticError, installDiagnosticSink,
  diagnostics, observeDesktopCommand,
} from "../src/application/diagnostics.ts";

test("diagnostic error summaries bound strings and never serialize rejected payloads", () => {
  const error = { code: "processFailed", password: "synthetic-secret", stdout: "source text", payload: { token: "private" } };
  assert.deepEqual(normalizeDiagnosticError(error), { message: "Operation failed (processFailed)", stack: null });
  assert.deepEqual(normalizeDiagnosticError({ kind: "io", message: "private body" }), { message: "Operation failed (io)", stack: null });
  assert.equal(normalizeDiagnosticError("x".repeat(1_000_000)).message.length, 4096);
  const hostile = new Proxy({}, { has() { throw Error("getter failed"); } });
  assert.equal(normalizeDiagnosticError(hostile).stack, null);
  const actual = new Error("ordinary failure");
  assert.equal(normalizeDiagnosticError(actual).message, "ordinary failure");
});

test("bridge rejection is contained and becomes health metadata on the next report", async () => {
  const entries = [];
  let reject = true;
  const reporter = createDiagnosticReporter(async (entry) => {
    if (reject) throw Error("bridge down");
    entries.push(entry);
  });
  reporter.report("error", "test.failed", "failure");
  await new Promise(setImmediate);
  assert.equal(reporter.health().bridgeFailures, 1);
  reject = false;
  reporter.report("error", "test.recovered", "failure");
  await new Promise(setImmediate);
  assert.equal(entries[0].bridgeFailures, 1);
  assert.equal(reporter.health().bridgeFailures, 1);
});

test("reporting reserves failure capacity, reports suppression and retains error identity", async () => {
  const entries = [];
  let time = 10_000;
  const reporter = createDiagnosticReporter(async (entry) => { entries.push(entry); }, () => time);
  for (let index = 0; index < 110; index++) reporter.report("info", "test.info", "");
  const error = new Error("failure");
  reporter.report("error", "test.failure", error, { traceId: "ui-fixture", command: "test_command" });
  assert.equal(entries.length, 101);
  assert.equal(entries.at(-1).suppressed, 10);
  time += 1001;
  reporter.report("error", "operation.handled_error", error);
  assert.equal(entries.at(-1).traceId, "ui-fixture");
  const stringTrace = reporter.identify("native rejection", "ui-string");
  assert.equal(reporter.identify("native rejection"), stringTrace);
  await new Promise(setImmediate);
});

test("command observation preserves the original rejection and correlates handled errors", async () => {
  const entries = [];
  installDiagnosticSink(async (entry) => { entries.push(entry); });
  const failure = new Error("read failed");
  let trace;
  await assert.rejects(observeDesktopCommand("read_history_page", async (id) => {
    trace = id;
    throw failure;
  }), (error) => error === failure);
  diagnostics.report("error", "operation.handled_error", failure);
  assert.equal(entries[0].event, "command.failed");
  assert.equal(entries[1].traceId, trace);
  assert.equal(entries[0].traceId, trace);
  assert.ok(!JSON.stringify(entries).includes("workspaceRoot"));
  assert.equal(await observeDesktopCommand("prepare_task_execution", async () => 42, true), 42);
  assert.deepEqual(entries.slice(-2).map((entry) => entry.event), ["command.started", "command.completed"]);
});
