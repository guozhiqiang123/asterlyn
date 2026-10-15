import assert from "node:assert/strict";
import test from "node:test";

import {
  captureTasksFocus,
  captureTasksViewport,
  restoreTasksFocus,
  restoreTasksViewport,
  syncTasksHeaderRefresh,
  syncTasksSelection,
} from "../src/features/tasks/tasks-runtime.ts";

test("Tasks runtime keeps the shared title-bar refresh action in sync", () => {
  const attributes = new Map();
  const button = {
    disabled: false,
    title: "",
    setAttribute(name, value) { attributes.set(name, value); },
  };
  const root = { querySelector: (selector) => selector === "#tasks-header-refresh" ? button : null };
  const state = { status: "loading" };
  syncTasksHeaderRefresh(root, state, { refresh: "Refresh tasks" });
  assert.equal(button.disabled, true);
  assert.equal(button.title, "Refresh tasks");
  assert.equal(attributes.get("aria-label"), "Refresh tasks");

  syncTasksHeaderRefresh(root, { status: "ready" });
  assert.equal(button.disabled, false);
});

test("Tasks runtime updates selection without replacing rows or changing the viewport", () => {
  const rows = [
    { dataset: { taskKey: "gradle::app:a" }, attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); } },
    { dataset: { taskKey: "gradle::app:b" }, attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); } },
  ];
  const host = { querySelectorAll: () => rows };
  syncTasksSelection(host, {
    visibleEntries: [{ key: "gradle::app:a" }, { key: "gradle::app:b" }],
    selectedIndex: 1,
  });
  assert.equal(rows[0].attributes.get("aria-selected"), "false");
  assert.equal(rows[1].attributes.get("aria-selected"), "true");
});

test("Tasks runtime restores the task-list scroll position after provider updates", () => {
  const previousList = { scrollLeft: 7, scrollTop: 1260 };
  const nextList = { scrollLeft: 0, scrollTop: 0 };
  const snapshot = captureTasksViewport({ querySelector: () => previousList });
  restoreTasksViewport({ querySelector: () => nextList }, snapshot);
  assert.deepEqual(snapshot, { left: 7, top: 1260 });
  assert.equal(nextList.scrollLeft, 7);
  assert.equal(nextList.scrollTop, 1260);
});

test("Tasks runtime focus helpers preserve query selection range across rerender", () => {
  const previous = {
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
  };
  class FakeElement {
    constructor() { this.ownerDocument = { activeElement: null }; }
    contains(value) { return value === this.ownerDocument.activeElement; }
    matches(selector) { return selector === "[data-tasks-query]"; }
  }
  class FakeInput extends FakeElement {
    constructor() { super(); this.selectionStart = 2; this.selectionEnd = 5; this.focused = false; }
    focus() { this.focused = true; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  }
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = FakeInput;
  try {
    const oldInput = new FakeInput();
    const oldHost = new FakeElement();
    oldHost.ownerDocument.activeElement = oldInput;
    const snapshot = captureTasksFocus(oldHost);
    const newInput = new FakeInput();
    const newHost = new FakeElement();
    newHost.querySelector = () => newInput;
    restoreTasksFocus(newHost, snapshot);
    assert.deepEqual(snapshot, { kind: "query", start: 2, end: 5 });
    assert.equal(newInput.focused, true);
    assert.equal(newInput.selectionStart, 2);
    assert.equal(newInput.selectionEnd, 5);
  } finally {
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.HTMLInputElement = previous.HTMLInputElement;
  }
});

test("Tasks runtime focus helpers preserve an expanded tree branch across rerender", () => {
  const previous = { HTMLElement: globalThis.HTMLElement, HTMLInputElement: globalThis.HTMLInputElement };
  class FakeElement {
    constructor(key = null) { this.key = key; this.ownerDocument = { activeElement: null }; this.focused = false; }
    contains(value) { return value === this.ownerDocument.activeElement; }
    matches() { return false; }
    closest(selector) {
      if (selector === "[data-task-key]") return null;
      return selector === "[data-task-tree-key]" && this.key ? this : null;
    }
    querySelector() { return null; }
    focus() { this.focused = true; }
    get dataset() { return this.key ? { taskTreeKey: this.key } : {}; }
  }
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = class extends FakeElement {};
  try {
    const oldBranch = new FakeElement("module-app");
    const oldHost = new FakeElement();
    oldHost.ownerDocument.activeElement = oldBranch;
    const snapshot = captureTasksFocus(oldHost);
    const button = new FakeElement();
    const newBranch = new FakeElement("module-app");
    newBranch.querySelector = () => button;
    const newHost = new FakeElement();
    newHost.querySelectorAll = () => [newBranch];
    restoreTasksFocus(newHost, snapshot);
    assert.deepEqual(snapshot, { kind: "tree-node", key: "module-app" });
    assert.equal(button.focused, true);
  } finally {
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.HTMLInputElement = previous.HTMLInputElement;
  }
});

test("Tasks runtime focus falls back to the tree when a mode hides the previous task", () => {
  const previous = { HTMLElement: globalThis.HTMLElement, HTMLInputElement: globalThis.HTMLInputElement };
  class FakeElement {
    constructor(key = null) { this.key = key; this.ownerDocument = { activeElement: null }; this.focused = false; }
    contains(value) { return value === this.ownerDocument.activeElement; }
    matches() { return false; }
    closest(selector) { return selector === "[data-task-key]" && this.key ? this : null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    focus() { this.focused = true; }
    get dataset() { return this.key ? { taskKey: this.key, taskAction: "run" } : {}; }
  }
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = class extends FakeElement {};
  try {
    const oldTask = new FakeElement("gradle::app:check");
    const oldHost = new FakeElement();
    oldHost.ownerDocument.activeElement = oldTask;
    const snapshot = captureTasksFocus(oldHost);
    const tree = new FakeElement();
    const newHost = new FakeElement();
    newHost.querySelector = (selector) => selector === "[role=tree]" ? tree : null;
    restoreTasksFocus(newHost, snapshot);
    assert.deepEqual(snapshot, { kind: "task", key: "gradle::app:check", action: "run" });
    assert.equal(tree.focused, true);
  } finally {
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.HTMLInputElement = previous.HTMLInputElement;
  }
});
