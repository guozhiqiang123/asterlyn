import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TERMINAL_SHELL_TABS,
  MAX_TERMINAL_TABS,
  TerminalTabs,
} from "../src/features/terminal/terminal-tabs.ts";

test("terminal tabs keep stable ordering and select the nearest survivor", () => {
  const tabs = new TerminalTabs();
  const first = tabs.createShell("Shell 1");
  const second = tabs.createShell("Shell 2");
  const third = tabs.createShell("Shell 3");
  assert.equal(first.ok && first.tab.id, "terminal-tab-1");
  assert.equal(second.ok && second.tab.id, "terminal-tab-2");
  assert.equal(third.ok && third.tab.id, "terminal-tab-3");
  assert.equal(tabs.selectedId, "terminal-tab-3");

  tabs.select("terminal-tab-2");
  const closed = tabs.close("terminal-tab-2");
  assert.equal(closed.closed?.title, "Shell 2");
  assert.equal(tabs.selectedId, "terminal-tab-3");
  assert.deepEqual(tabs.tabs.map((tab) => tab.title), ["Shell 1", "Shell 3"]);
});

test("shell tabs enforce their process and total bounds without mutation", () => {
  const tabs = new TerminalTabs();
  for (let index = 0; index < MAX_TERMINAL_SHELL_TABS; index += 1) {
    assert.equal(tabs.createShell(`Shell ${index + 1}`).ok, true);
  }
  assert.deepEqual(tabs.createShell("Overflow"), { ok: false, reason: "shell-limit" });
  assert.equal(tabs.tabs.length, MAX_TERMINAL_SHELL_TABS);
});

test("task pressure evicts only the oldest completed task tab", () => {
  const tabs = new TerminalTabs();
  for (let index = 0; index < MAX_TERMINAL_SHELL_TABS; index += 1) tabs.createShell(`Shell ${index}`);
  for (let index = 0; index < MAX_TERMINAL_TABS - MAX_TERMINAL_SHELL_TABS; index += 1) {
    const result = tabs.createTask(`task-${index}`, `Task ${index}`);
    assert.equal(result.ok, true);
    if (result.ok && index < 2) tabs.update(result.tab.id, { taskTerminal: true });
  }
  const replacement = tabs.createTask("task-next", "Task next");
  assert.equal(replacement.ok, true);
  assert.equal(replacement.ok && replacement.evictedId, "terminal-tab-9");
  assert.equal(tabs.tabs.some((tab) => tab.taskSessionId === "task-0"), false);
  assert.equal(tabs.tabs.some((tab) => tab.taskSessionId === "task-2"), true);
});

test("task pressure fails closed when no completed task can be evicted", () => {
  const tabs = new TerminalTabs();
  for (let index = 0; index < MAX_TERMINAL_SHELL_TABS; index += 1) tabs.createShell(`Shell ${index}`);
  for (let index = 0; index < MAX_TERMINAL_TABS - MAX_TERMINAL_SHELL_TABS; index += 1) {
    tabs.createTask(`task-${index}`, `Task ${index}`);
  }
  assert.deepEqual(tabs.createTask("task-next", "Task next"), { ok: false, reason: "tab-limit" });
});
