import assert from "node:assert/strict";
import test from "node:test";

import { UnversionedTrashRuntime } from "../src/features/changes-commit/unversioned-trash-runtime.ts";

class FakeClassList {
  values = new Set();
  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
}

class FakeElement {
  id = "";
  className = "";
  classList = new FakeClassList();
  isConnected = false;
  innerHTML = "";
  onclick = null;
  onkeydown = null;
  children = [];
  setAttribute() {}
  append(child) { child.isConnected = true; this.children.push(child); }
  remove() { this.isConnected = false; }
  contains() { return false; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

test("Unversioned Trash restores its dialog host after the application shell is replaced", async () => {
  const previousDocument = globalThis.document;
  const previousElement = globalThis.HTMLElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    activeElement: null,
    createElement: () => new FakeElement(),
  };

  try {
    const root = new FakeElement();
    const runtime = new UnversionedTrashRuntime(
      root,
      { current: () => true, execute: async () => {}, errorMessage: String },
      () => ({
        title: "Trash files?", cancel: "Cancel", confirm: "Trash",
        description: () => "description", warning: () => "warning",
        progress: () => "working",
      }),
    );
    const originalHost = root.children[0];
    originalHost.isConnected = false;
    root.children.length = 0;

    assert.equal(runtime.open({
      workspaceRoot: "/repo", workspaceGeneration: 1, kind: "group",
      group: "unversioned", repositoryId: ".", repositoryRevision: 1,
      paths: ["new.txt"],
    }), true);
    assert.equal(root.children.at(-1), originalHost);
    assert.equal(originalHost.isConnected, true);
    assert.match(originalHost.innerHTML, /Trash files\?/);
    // The confirm action carries the shared destructive surface, never a browser-default button.
    assert.match(originalHost.innerHTML, /class="secondary-button" data-unversioned-trash-close/u);
    assert.match(originalHost.innerHTML, /class="danger-button" id="unversioned-trash-confirm"/u);
    await Promise.resolve();
    runtime.dispose();
  } finally {
    globalThis.document = previousDocument;
    globalThis.HTMLElement = previousElement;
  }
});
