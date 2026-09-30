import test from "node:test";
import assert from "node:assert/strict";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import { CHANGES_COMMANDS } from "../src/application/commands/changes-command-ids.ts";
import { registerChangesCommands } from "../src/composition/changes-command-runtime.ts";

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
    changes: {
      contextMenu: {
        includeInCommit: "Include in Commit or Stash",
        showDiff: "Show Diff",
        jumpToSource: "Jump to Source",
        restoreChanges: "Restore Changes",
        trash: "Move to Trash",
        resolveConflict: "Resolve Conflict",
        gitHistory: "Git History",
        stageAllUnversioned: "Stage All Unversioned Files",
        trashAllUnversioned: "Move All Unversioned Files to Trash",
      },
      refreshChanges: "Refresh changes",
      showAs: (view) => `Show changes as ${view}`,
      flatList: "flat list",
      directoryTree: "directory tree",
      expandAll: "Expand all folders",
      collapseAll: "Collapse all folders",
      commitButton: "Commit",
      stashButton: "Stash Changes",
      commitFileActions: "Commit file actions",
      changedFiles: "Changed files",
    },
    settings: { keybindings: { gitRequired: "Git required" } },
  };
}

test("Changes commands reuse enabled controls and the exact current-selection adapter", async () => {
  const refresh = button();
  const commit = button();
  const targets = new Map([
    ['[data-change-action="refresh"]', refresh],
    ["#commit-button", commit],
  ]);
  const actions = [];
  let selectionEnabled = true;
  const registry = new CommandRegistry();
  const release = registerChangesCommands(registry, {
    root: { querySelector: (selector) => targets.get(selector) ?? null },
    catalog,
    changesCommandAvailability: (action) => selectionEnabled
      ? { enabled: true }
      : { enabled: false, reason: `${action} unavailable` },
    executeChangesCommand: (action) => actions.push(action),
  });

  assert.equal(registry.get(CHANGES_COMMANDS.refresh).title(), "Refresh changes");
  assert.equal(registry.get(CHANGES_COMMANDS.toggleIncluded).title(), "Include in Commit or Stash");
  assert.equal(registry.get(CHANGES_COMMANDS.refresh).availability().enabled, true);
  assert.equal(registry.get(CHANGES_COMMANDS.openSource).availability().enabled, true);
  await registry.get(CHANGES_COMMANDS.refresh).execute("keyboard");
  await registry.get(CHANGES_COMMANDS.commit).execute("palette");
  await registry.get(CHANGES_COMMANDS.openSource).execute("keyboard");
  await registry.get(CHANGES_COMMANDS.trashAllUnversioned).execute("keyboard");
  assert.equal(refresh.clicks, 1);
  assert.equal(commit.clicks, 1);
  assert.deepEqual(actions, ["source", "trash-all"]);

  refresh.disabled = true;
  selectionEnabled = false;
  assert.deepEqual(registry.get(CHANGES_COMMANDS.refresh).availability(), {
    enabled: false, reason: "Git required",
  });
  assert.deepEqual(registry.get(CHANGES_COMMANDS.restore).availability(), {
    enabled: false, reason: "restore unavailable",
  });
  release();
  assert.deepEqual(registry.list(), []);
});
