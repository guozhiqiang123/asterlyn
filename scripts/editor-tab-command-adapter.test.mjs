import assert from "node:assert/strict";
import test from "node:test";

import { EditorTabCommandAdapter } from "../src/composition/editor-tab-command-adapter.ts";

function tab(active = false) {
  const clicks = [];
  const button = { click: () => clicks.push("click") };
  return {
    clicks,
    getAttribute: (name) => name === "aria-selected" ? String(active) : null,
    querySelector: (selector) => selector === ".editor-tab-target" ? button : null,
  };
}

test("editor tab commands follow rendered order and wrap through the existing activation buttons", () => {
  const tabs = [tab(), tab(true), tab()];
  const adapter = new EditorTabCommandAdapter(
    { querySelectorAll: () => tabs },
    () => "Open at least two tabs",
  );

  assert.deepEqual(adapter.availability(), { enabled: true });
  adapter.execute("previous");
  adapter.execute("next");
  assert.deepEqual(tabs.map(({ clicks }) => clicks.length), [1, 0, 1]);

  tabs[1] = tab();
  tabs[0] = tab(true);
  adapter.execute("previous");
  assert.equal(tabs[2].clicks.length, 2);
});

test("editor tab commands are unavailable without two visible tabs and one active tab", () => {
  let tabs = [tab(true)];
  const adapter = new EditorTabCommandAdapter(
    { querySelectorAll: () => tabs },
    () => "Open at least two tabs",
  );
  assert.deepEqual(adapter.availability(), { enabled: false, reason: "Open at least two tabs" });
  tabs = [tab(), tab()];
  assert.equal(adapter.availability().enabled, false);
});
