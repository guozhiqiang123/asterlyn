import assert from "node:assert/strict";
import test from "node:test";

import {
  clearNavigatorRootTarget,
  navigatorHeaderHost,
  renderChangesNavigatorHeader,
  renderFilesNavigatorHeader,
} from "../src/shell/navigator-header.ts";

function element() {
  const classes = new Set();
  return {
    textContent: "",
    title: "",
    dataset: {},
    attributes: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  };
}

function host() {
  return {
    header: element(),
    title: element(),
    count: element(),
    hide: element(),
  };
}

test("the navigator header host resolves the shared Files and Changes ids", () => {
  const elements = new Map([
    ["#navigator-header", element()],
    ["#navigator-title", element()],
    ["#navigator-count", element()],
    ["#hide-left-tool", element()],
  ]);
  const resolved = navigatorHeaderHost({ querySelector: (selector) => elements.get(selector) ?? null });
  assert.equal(resolved.header, elements.get("#navigator-header"));
  assert.equal(resolved.title, elements.get("#navigator-title"));
  assert.equal(resolved.count, elements.get("#navigator-count"));
  assert.equal(resolved.hide, elements.get("#hide-left-tool"));
  assert.throws(
    () => navigatorHeaderHost({ querySelector: () => null }),
    /Missing navigator header element/u,
  );
});

test("Files hides the workspace tally and becomes the root context target", () => {
  const header = host();
  renderFilesNavigatorHeader(header, "plants", "Hide files");
  assert.equal(header.title.textContent, "plants");
  assert.equal(header.count.classList.contains("hidden"), true);
  assert.equal(header.count.textContent, "");
  assert.equal(header.header.dataset.projectRoot, "");
  assert.equal(header.hide.attributes["aria-label"], "Hide files");
  assert.equal(header.hide.title, "Hide files");
});

test("Changes reuses the header with its own tally and releases the root target", () => {
  const header = host();
  renderFilesNavigatorHeader(header, "plants", "Hide files");
  renderChangesNavigatorHeader(header, "Changes", 3, "3 changed files", "Hide changes");
  assert.equal(header.title.textContent, "Changes");
  assert.equal(header.count.classList.contains("hidden"), false);
  assert.equal(header.count.textContent, "3");
  assert.equal(header.count.title, "3 changed files");
  assert.equal("projectRoot" in header.header.dataset, false);
  assert.equal(header.hide.attributes["aria-label"], "Hide changes");

  renderFilesNavigatorHeader(header, "plants", "Hide files");
  clearNavigatorRootTarget(header);
  assert.equal("projectRoot" in header.header.dataset, false);
});
