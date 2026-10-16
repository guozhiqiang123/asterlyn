import assert from "node:assert/strict";
import test from "node:test";

import { BottomToolRuntime } from "../src/shell/bottom-tool-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("plugin tool settings action follows the current owner and hides outside Tasks", () => {
  const elements = new Map(SELECTORS.map((selector) => [selector, new FakeElement()]));
  const root = { querySelector: (selector) => elements.get(selector) ?? null };
  let tool = "tasks";
  let target = { pluginId: "dev.asterlyn.android-gradle", focus: "taskPresentation" };
  const opened = [];
  const runtime = new BottomToolRuntime(root, {
    tool: () => tool,
    shellCopy: () => EN_US.shell,
    navigationCopy: () => EN_US.navigation,
    replacementCopy: () => EN_US.replacement,
    tasksCopy: () => EN_US.tasks,
    workspaceRoot: () => "/repo",
    gitAvailable: () => true,
    activateTerminal: () => undefined,
    hideTerminal: () => undefined,
    renderGit: () => undefined,
    renderStash: () => undefined,
    renderFind: () => undefined,
    renderReplace: () => undefined,
    renderTasks: () => undefined,
    pluginSettingsTargets: () => target,
    openPluginSettings: (current) => opened.push(current),
  });

  runtime.render();
  assert.equal(elements.get("#plugin-settings-open").classList.contains("hidden"), false);
  elements.get("#plugin-settings-open").dispatchEvent(new Event("click"));
  assert.deepEqual(opened, [target]);

  target = null;
  runtime.render();
  assert.equal(elements.get("#plugin-settings-open").classList.contains("hidden"), true);
  tool = "branches";
  target = { pluginId: "dev.asterlyn.android-gradle", focus: "taskPresentation" };
  runtime.render();
  assert.equal(elements.get("#plugin-settings-open").classList.contains("hidden"), true);
});

class FakeElement extends EventTarget {
  attributes = new Map();
  classList = new FakeClassList();
  textContent = "";
  title = "";
  setAttribute(name, value) { this.attributes.set(name, value); }
}

class FakeClassList {
  names = new Set();
  add(name) { this.names.add(name); }
  toggle(name, force) { if (force) this.names.add(name); else this.names.delete(name); }
  contains(name) { return this.names.has(name); }
}

const SELECTORS = [
  "#bottom-tool-title", "#hide-bottom-tool", "#git-operation-open", "#tasks-header-refresh",
  "#plugin-settings-open", "#terminal-header-actions", "#git-tool-grid", "#stash-tool-grid",
  "#terminal-tool-host", "#find-tool-host", "#replacement-tool-host", "#tasks-tool-host", "#bottom-tool",
];
