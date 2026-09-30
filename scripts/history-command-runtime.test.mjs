import test from "node:test";
import assert from "node:assert/strict";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import { HISTORY_COMMANDS } from "../src/application/commands/history-command-ids.ts";
import { registerHistoryCommands } from "../src/composition/history-command-runtime.ts";

function button() {
  return {
    disabled: false,
    clicks: 0,
    click() { this.clicks += 1; },
    getAttribute: () => null,
  };
}

function catalog() {
  return {
    shell: { branches: "Branches and Log" },
    history: {
      useRegularExpression: "Use regular expression",
      matchCase: "Match case",
      branchOrTag: "Branch or tag",
      filterByAuthor: "Filter by author",
      filterByDate: "Filter by date",
      filterByPathsOrRoots: "Filter by paths or roots",
      graphOptions: "Graph options",
      showChangedFilesAs: (view) => `Show changed files as ${view}`,
      flatList: "flat list",
      directoryTree: "directory tree",
      expandChangedFolders: "Expand changed folders",
      collapseChangedFolders: "Collapse changed folders",
      swapComparisonSides: "Swap comparison sides",
      branchContextMenu: {
        viewHistory: "View history", mergeIntoCurrent: "Merge into current",
        rebaseCurrentOnto: "Rebase current onto selected",
      },
      branchMutation: { titles: {
        switch: "Switch Branch", checkoutRemote: "Check Out Remote Branch",
        create: "Create Branch", rename: "Rename Branch", delete: "Delete Branch",
      } },
      tagMutation: { titles: { checkout: "Check Out Tag", deleteLocal: "Delete Local Tag" } },
    },
    settings: { keybindings: { historyRequired: "History required" } },
  };
}

test("History commands invoke the current rendered controls and expose live availability", async () => {
  const regex = button();
  const paths = button();
  const toggleFiles = button();
  const swap = button();
  const targets = new Map([
    ['[data-history-text-mode="regex"]', regex],
    ['[data-history-menu="paths"]', paths],
    ["#commit-file-view-toggle, #comparison-file-view-toggle, #commit-folder-file-view-toggle", toggleFiles],
    ["#swap-comparison-sides", swap],
  ]);
  const registry = new CommandRegistry();
  const actions = [];
  const release = registerHistoryCommands(registry, {
    root: { querySelector: (selector) => targets.get(selector) ?? null },
    catalog,
    historyCommandAvailability: () => ({ enabled: true }),
    executeHistoryCommand: (action) => actions.push(action),
  });

  assert.equal(registry.get(HISTORY_COMMANDS.toggleRegex).title(), "Use regular expression");
  assert.equal(registry.get(HISTORY_COMMANDS.openPathFilter).title(), "Filter by paths or roots");
  assert.equal(registry.get(HISTORY_COMMANDS.switchBranch).title(), "Switch Branch");
  assert.equal(registry.get(HISTORY_COMMANDS.toggleFileView).availability().enabled, true);
  await registry.get(HISTORY_COMMANDS.toggleRegex).execute("keyboard");
  await registry.get(HISTORY_COMMANDS.openPathFilter).execute("palette");
  await registry.get(HISTORY_COMMANDS.toggleFileView).execute("keyboard");
  await registry.get(HISTORY_COMMANDS.swapComparison).execute("keyboard");
  await registry.get(HISTORY_COMMANDS.loadMore).execute("keyboard");
  assert.deepEqual([regex.clicks, paths.clicks, toggleFiles.clicks, swap.clicks], [1, 1, 1, 1]);
  assert.deepEqual(actions, ["load-more"]);

  swap.disabled = true;
  assert.deepEqual(registry.get(HISTORY_COMMANDS.swapComparison).availability(), {
    enabled: false, reason: "History required",
  });
  assert.ok(registry.get(HISTORY_COMMANDS.openGraphFilter).userBindingScopes.includes("history"));
  release();
  assert.deepEqual(registry.list(), []);
});
