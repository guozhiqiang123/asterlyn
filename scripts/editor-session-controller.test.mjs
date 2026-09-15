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

test("reopening an inactive document emits activation and preserves its unsaved buffer", async () => {
  const controller = new EditorSessionController(gateway({ async readTextFile(_root, _repository, path) { return snapshot(path, path); } }));
  controller.installWorkspace("/repo");
  await controller.openText("/repo", file("one.md"), "split");
  const first = controller.state.session.textTabs[0];
  controller.markEdited(first.id, "unsaved one");
  await controller.openText("/repo", file("two.md"), "source");
  const events = [];
  controller.subscribe((change) => events.push(change));
  await controller.openText("/repo", file("one.md"), "split");
  assert.equal(controller.activeDocument().path, "one.md");
  assert.equal(controller.tab(first.id).content, "unsaved one");
  assert.equal(events.at(-1).reason, "activation");
  assert.equal(events.at(-1).documentChanged, true);
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

test("editor path migration commits runtime identity changes before publishing state", async () => {
  const controller = new EditorSessionController(gateway({
    async readTextFile(_root, _repository, path) { return snapshot(path, path); },
  }));
  controller.installWorkspace("/repo");
  await controller.openText("/repo", file("src/a.ts"), "source");
  const original = controller.state.session.textTabs[0];
  controller.markEdited(original.id, "unsaved");
  const prepared = controller.preparePathMigration("/repo", {
    kind: "move",
    mapping: {
      sourceWorkspacePath: "src",
      destinationWorkspacePath: "lib",
      sourceRepositoryId: ".",
      destinationRepositoryId: ".",
      sourcePath: "src",
      destinationPath: "lib",
    },
  });
  assert.equal(prepared.status, "ready");
  let stateDuringRuntime = null;
  const status = controller.applyPathMigration(prepared.lease, (change) => {
    stateDuringRuntime = controller.state.session.textTabs[0].document.workspacePath;
    assert.equal(change.remaps[0].sourceId, original.id);
    return true;
  });

  assert.equal(status, "applied");
  assert.equal(stateDuringRuntime, "src/a.ts");
  assert.equal(controller.state.session.textTabs[0].document.workspacePath, "lib/a.ts");
  assert.equal(controller.state.session.textTabs[0].content, "unsaved");
});

test("editor path migration preserves later edits, blocks saves, and refuses stale leases", async () => {
  const controller = new EditorSessionController(gateway());
  controller.installWorkspace("/repo");
  await controller.openText("/repo", file("a.ts"), "source");
  const request = {
    kind: "move",
    mapping: {
      sourceWorkspacePath: "a.ts",
      destinationWorkspacePath: "b.ts",
      sourceRepositoryId: ".",
      destinationRepositoryId: ".",
      sourcePath: "a.ts",
      destinationPath: "b.ts",
    },
  };
  const current = controller.preparePathMigration("/repo", request);
  controller.markEdited(controller.state.session.textTabs[0].id, "late");
  assert.equal(
    (await controller.saveText(controller.state.session.textTabs[0].id, "late")).status,
    "busy",
  );
  assert.equal(controller.applyPathMigration(current.lease, () => true), "applied");
  assert.equal(controller.state.session.textTabs[0].content, "late");

  const stale = controller.preparePathMigration("/repo", {
    ...request,
    mapping: {
      ...request.mapping,
      sourceWorkspacePath: "b.ts",
      destinationWorkspacePath: "c.ts",
      sourcePath: "b.ts",
      destinationPath: "c.ts",
    },
  });
  controller.installWorkspace("/other");
  assert.equal(controller.applyPathMigration(stale.lease, () => true), "stale");
});

test("editor path migration keeps the lease when the runtime cache reports a conflict", async () => {
  const controller = new EditorSessionController(gateway());
  controller.installWorkspace("/repo");
  await controller.openText("/repo", file("a.ts"), "source");
  const current = controller.preparePathMigration("/repo", {
    kind: "move",
    mapping: {
      sourceWorkspacePath: "a.ts",
      destinationWorkspacePath: "b.ts",
      sourceRepositoryId: ".",
      destinationRepositoryId: ".",
      sourcePath: "a.ts",
      destinationPath: "b.ts",
    },
  });
  const before = controller.state.session;
  assert.equal(controller.applyPathMigration(current.lease, () => false), "runtime-conflict");
  assert.equal(controller.state.session, before);
  assert.equal(controller.applyPathMigration(current.lease, () => true), "applied");
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


test("whole-worktree reconciliation retains tab identities and missing-file content", async () => {
  let changedBranch = false;
  const controller = new EditorSessionController(gateway({
    async readTextFile(_root, _repo, path) {
      if (changedBranch && path === "gone.md") throw new Error("not found");
      return { ...snapshot(path, changedBranch ? "new branch" : "previous branch"), revision: changedBranch ? "2" : "1" };
    },
  }));
  controller.installWorkspace("/repo");
  await controller.openText("/repo", file("kept.md"), "split");
  await controller.openText("/repo", file("gone.md"), "preview");
  const ids = controller.state.session.textTabs.map(tab => tab.id);
  changedBranch = true;
  await controller.reconcileExternalPaths([]);
  assert.deepEqual(controller.state.session.textTabs.map(tab => tab.id), ids);
  assert.equal(controller.tab(ids[0]).content, "new branch");
  assert.equal(controller.tab(ids[0]).markdownMode, "split");
  assert.equal(controller.tab(ids[1]).content, "previous branch");
  assert.equal(controller.tab(ids[1]).conflict, true);
});
