import assert from "node:assert/strict";
import test from "node:test";

import { RemoteManagementController } from "../src/features/remote-push/remote-management-controller.ts";

function repository(remotes = [{ name: "origin", url: "https://example.test/one.git", fetchSupported: true, pushSupported: true }]) {
  return { root: "/repo", remotes };
}

test("remote add executes from one definition form and optionally fetches afterward", async () => {
  let snapshot = repository();
  const calls = [];
  const controller = new RemoteManagementController({
    snapshot: () => snapshot,
    async prepare(_root, request) { calls.push(["prepare", request]); return { repositoryRoot: "/repo", kind: request.kind, sourceName: request.sourceName, targetName: request.name, sourceUrl: null, targetUrl: request.url, configurationToken: "config", previewToken: "preview" }; },
    async execute(plan) { calls.push(["execute", plan.targetName]); snapshot = repository([...snapshot.remotes, { name: plan.targetName, url: plan.targetUrl, fetchSupported: true, pushSupported: true }]); return true; },
    async fetch(_root, remote) { calls.push(["fetch", remote]); return true; },
    errorMessage: String,
  });
  assert.equal(controller.open(), true);
  controller.add();
  controller.update("name", "backup");
  controller.update("url", "ssh://example.test/repo.git");
  await controller.save();
  assert.equal(controller.state.dialog.kind, "list");
  assert.deepEqual(controller.state.dialog.remotes.map((remote) => remote.name), ["origin", "backup"]);
  assert.deepEqual(calls.map((call) => call[0]), ["prepare", "execute", "fetch"]);
});

test("remote deletion performs no mutation until the dedicated confirmation", async () => {
  let prepared = 0;
  let executed = 0;
  const controller = new RemoteManagementController({
    snapshot: () => repository(),
    async prepare(_root, request) { prepared += 1; return { repositoryRoot: "/repo", kind: "delete", sourceName: request.name, targetName: request.name, sourceUrl: "url", targetUrl: null, configurationToken: "config", previewToken: "preview" }; },
    async execute() { executed += 1; return true; }, async fetch() { return true; }, errorMessage: String,
  });
  controller.open();
  controller.requestDelete();
  assert.equal(controller.state.dialog.kind, "delete");
  assert.equal(prepared, 0);
  await controller.delete();
  assert.equal(prepared, 1);
  assert.equal(executed, 1);
});
