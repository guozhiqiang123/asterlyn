import assert from "node:assert/strict";
import test from "node:test";

import { captureTasksFocus, restoreTasksFocus, syncTasksHeaderRefresh } from "../src/features/tasks/tasks-runtime.ts";

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
