import assert from "node:assert/strict";
import test from "node:test";

import {
  bindCommandSurfaceLineBreak,
  focusCommandSurfaceQuery,
  syncCommandSurfaceQueryHeight,
} from "../src/features/files-editor/command-surface-input.ts";

function textarea(value = "") {
  const listeners = new Map();
  const element = {
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
    scrollHeight: 31,
    events: [],
    style: { height: "", overflowY: "" },
    focus() {
      focused.push(element);
    },
    setSelectionRange(start, end) {
      element.selectionStart = start;
      element.selectionEnd = end;
    },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    dispatchEvent(event) {
      element.events.push(event.type);
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
  };
  return element;
}

const focused = [];

function rootFor(input, button) {
  return {
    querySelector(selector) {
      if (selector === "#command-surface-input") return input;
      if (selector === '[data-search-insert="new-line"]') return button;
      return null;
    },
  };
}

test("the in-field line-break control edits the query around the caret", async () => {
  const input = textarea("alpha gamma");
  input.setSelectionRange(6, 6);
  const applied = [];
  input.addEventListener("input", () => applied.push(input.value));
  let insert = null;
  const button = { addEventListener(_type, listener) { insert = listener; } };
  bindCommandSurfaceLineBreak(rootFor(input, button));
  assert.equal(typeof insert, "function");

  insert();
  assert.equal(input.value, "alpha \ngamma");
  // The surface's own input path receives the edited query exactly once.
  assert.deepEqual(applied, ["alpha \ngamma"]);
  assert.deepEqual(input.events, ["input"]);
  await Promise.resolve();
  assert.equal(focused.at(-1), input);
  assert.equal(input.selectionStart, 7);
  assert.equal(input.selectionEnd, 7);
});

test("the query field grows with its text and never leaves the hidden scroll range", () => {
  const short = textarea("one line");
  short.scrollHeight = 31;
  syncCommandSurfaceQueryHeight(rootFor(short, null));
  assert.equal(short.style.height, "31px");
  assert.equal(short.style.overflowY, "hidden");

  const tall = textarea("first\nsecond\nthird");
  tall.scrollHeight = 200;
  syncCommandSurfaceQueryHeight(rootFor(tall, null));
  assert.equal(tall.style.height, "124px");
  assert.equal(tall.style.overflowY, "auto");
});

test("focusing the query places the caret at the end of the query", async () => {
  focused.length = 0;
  const input = textarea("first\nsecond");
  focusCommandSurfaceQuery(rootFor(input, null));
  await Promise.resolve();
  assert.equal(focused.at(-1), input);
  assert.equal(input.selectionStart, input.value.length);
});
