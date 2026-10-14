import assert from "node:assert/strict";
import test from "node:test";

import { captureTasksFocus, restoreTasksFocus } from "../src/features/tasks/tasks-runtime.ts";

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
