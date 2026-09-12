import assert from "node:assert/strict";
import test from "node:test";

import { EditorSessionController } from "../src/features/files-editor/editor-session-controller.ts";

test("workspace replacement rejects an obsolete file load", async () => {
  const pending = deferred();
  const controller = new EditorSessionController(gateway({ read: pending.promise }));
  controller.installWorkspace("/one");
  const opened = controller.openText("/one", file("a.ts"), "source");
  controller.installWorkspace("/two");
  pending.resolve(snapshot("a.ts", "old"));

  assert.deepEqual(await opened, { status: "stale" });
  assert.equal(controller.state.session.textTabs.length, 0);
});

test("a reopened loaded tab activates without reading again", async () => {
  let reads = 0;
  const controller = new EditorSessionController(gateway({
    async readTextFile() { reads += 1; return snapshot("a.ts", "hello"); },
  }));
  controller.installWorkspace("/repo");
  assert.equal((await controller.openText("/repo", file("a.ts"), "source")).status, "ready");
  assert.equal((await controller.openText("/repo", file("a.ts"), "source")).status, "existing");
  assert.equal(reads, 1);
});

test("save completion preserves edits made after the captured write", async () => {
  const pending = deferred();
  let requestId = "";
  const controller = new EditorSessionController(gateway({
    saveTextFile(_root, _repositoryId, _path, _revision, _content, _bom, currentRequestId) {
      requestId = currentRequestId;
      return pending.promise;
    },
  }));
  controller.installWorkspace("/repo");
  await controller.openText("/repo", file("a.ts"), "source");
  const tab = controller.state.session.textTabs[0];
  controller.markEdited(tab.id, "first");
  const saving = controller.saveText(tab.id, "first");
  controller.markEdited(tab.id, "second");
  pending.resolve({ workspacePath: "a.ts", revision: "2", byteLength: 5, requestId, alreadySaved: false });
  const result = await saving;

  assert.equal(result.status, "newer-edits");
  assert.equal(controller.tab(tab.id).content, "second");
  assert.equal(controller.tab(tab.id).persistedContent, "first");
});

test("conflicting saves return ownership to the tab", async () => {
  const controller = new EditorSessionController(gateway({
    async saveTextFile() { throw { kind: "conflict", message: "changed outside" }; },
  }));
  controller.installWorkspace("/repo");
  await controller.openText("/repo", file("a.ts"), "source");
  const tab = controller.state.session.textTabs[0];
  controller.markEdited(tab.id, "changed");

  assert.equal((await controller.saveText(tab.id, "changed")).status, "failure");
  assert.equal(controller.tab(tab.id).conflict, true);
  assert.equal(controller.tab(tab.id).saveRequest, null);
});

test("watch reconciliation reloads clean tabs and flags dirty tabs without overwriting", async () => {
  let disk = snapshot("src/a.ts", "base");
  const controller = new EditorSessionController(gateway({
    async readTextFile() { return disk; },
  }));
  controller.installWorkspace("/repo");
  await controller.openText("/repo", file("src/a.ts"), "source");

  disk = { ...snapshot("src/a.ts", "external"), revision: "2" };
  await controller.reconcileExternalPaths(["src"]);
  const tabId = controller.state.session.textTabs[0].id;
  assert.equal(controller.tab(tabId).content, "external");

  controller.markEdited(tabId, "local");
  disk = { ...snapshot("src/a.ts", "external again"), revision: "3" };
  await controller.reconcileExternalPaths(["src/a.ts"]);
  assert.equal(controller.tab(tabId).content, "local");
  assert.equal(controller.tab(tabId).conflict, true);
});

test("newer image navigation rejects an older completion", async () => {
  const first = deferred();
  const second = deferred();
  const images = [first.promise, second.promise];
  const controller = new EditorSessionController(gateway({
    readImageFile() { return images.shift(); },
  }));
  controller.installWorkspace("/repo");
  const a = controller.beginImageLoad(imageDocument("a.png"));
  const b = controller.beginImageLoad(imageDocument("b.png"));
  first.resolve({ path: "a.png", mediaType: "image/png", data: "a" });
  second.resolve({ path: "b.png", mediaType: "image/png", data: "b" });

  assert.equal((await a.completion).status, "stale");
  assert.equal((await b.completion).status, "ready");
});

function gateway(overrides = {}) {
  return {
    readTextFile() { return overrides.read ?? Promise.resolve(snapshot("a.ts", "base")); },
    saveTextFile(_root, _repositoryId, _path, _revision, _content, _bom, requestId) {
      return overrides.save ?? Promise.resolve({ workspacePath: "a.ts", revision: "2", byteLength: 4, requestId, alreadySaved: false });
    },
    readImageFile() {
      return Promise.resolve({ path: "a.png", mediaType: "image/png", data: "a" });
    },
    ...overrides,
  };
}

function file(path) {
  return { repositoryId: ".", path, workspacePath: path };
}

function snapshot(path, content) {
  return { workspacePath: path, content, utf8Bom: false, revision: "1", byteLength: content.length };
}

function imageDocument(path) {
  return { kind: "project-image", repositoryRoot: "/repo", repositoryId: ".", path, workspacePath: path };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
