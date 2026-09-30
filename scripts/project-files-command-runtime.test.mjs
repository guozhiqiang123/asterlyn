import assert from "node:assert/strict";
import test from "node:test";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import { FILES_COMMANDS } from "../src/application/commands/files-editor-command-ids.ts";
import { registerFilesEditorCommands } from "../src/composition/files-editor-command-runtime.ts";
import { resolveProjectFilesCommandTarget } from "../src/features/files-editor/project-files-context-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { buildProjectTree } from "../src/presentation/project-tree.ts";

const file = (path) => ({ repositoryId: ".", path, workspacePath: path, readOnly: false });

test("Files commands bind live feature availability and execution", async () => {
  const registry = new CommandRegistry();
  const availabilityCalls = [];
  const executions = [];
  const release = registerFilesEditorCommands(registry, {
    root: { querySelector: () => null },
    catalog: () => EN_US,
    projectFilesCommandAvailability: (action) => {
      availabilityCalls.push(action);
      return { enabled: action === "open", ...(action === "open" ? {} : { reason: "blocked" }) };
    },
    executeProjectFilesCommand: (action) => executions.push(action),
  });

  assert.equal(registry.get(FILES_COMMANDS.openSelection).availability().enabled, true);
  assert.equal(registry.get(FILES_COMMANDS.renameSelection).availability().reason, "blocked");
  await registry.get(FILES_COMMANDS.openSelection).execute("keyboard");
  assert.deepEqual(availabilityCalls, ["open", "rename"]);
  assert.deepEqual(executions, ["open"]);
  assert.equal(registry.get(FILES_COMMANDS.openRecoveries).availability().enabled, false);

  release();
  assert.deepEqual(registry.list(), []);
});

test("Files command target preserves the exact current multi-selection", () => {
  const files = [file("src/a.ts"), file("src/b.ts")];
  const state = {
    root: "/workspace", paths: files.map(({ workspacePath }) => workspacePath), files,
    ignoredEntries: [], loading: false, error: null, truncated: false,
    loadingDirectories: new Set(), directoryErrors: new Map(),
    selection: { path: "src/b.ts", kind: "file" },
    selections: [
      { path: "src/a.ts", kind: "file" },
      { path: "src/b.ts", kind: "file" },
    ],
    selectionAnchor: { path: "src/a.ts", kind: "file" },
    expandedDirectories: new Set(["src"]),
  };
  const target = resolveProjectFilesCommandTarget({
    state,
    tree: buildProjectTree(files.map(({ workspacePath }) => workspacePath)),
    workspaceGeneration: 9,
  });

  assert.equal(target.workspacePath, "src/b.ts");
  assert.deepEqual(target.selectedTargets.map(({ workspacePath }) => workspacePath), [
    "src/a.ts", "src/b.ts",
  ]);
  assert.equal(resolveProjectFilesCommandTarget({
    state: { ...state, selection: null, selections: [] },
    tree: buildProjectTree(files.map(({ workspacePath }) => workspacePath)),
    workspaceGeneration: 9,
  }), null);
});
