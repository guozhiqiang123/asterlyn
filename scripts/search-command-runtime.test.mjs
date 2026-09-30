import assert from "node:assert/strict";
import test from "node:test";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import { SEARCH_COMMANDS } from "../src/application/commands/search-command-ids.ts";
import { registerSearchCommands } from "../src/composition/search-command-runtime.ts";
import { FindResultsRuntime } from "../src/features/files-editor/find-results-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("Find results commands follow the visible file snapshot and current selection", () => {
  const events = [];
  let visible = true;
  const runtime = new FindResultsRuntime({}, {
    copy: () => EN_US,
    source: () => ({
      mode: "files", repositoryRoot: "/repo", query: "app", searchRepositoryRoot: null,
      report: null, searchCurrent: false,
      files: [{ repositoryId: ".", path: "src/app.ts", workspacePath: "src/app.ts", readOnly: false }],
    }),
    activeRepositoryRoot: () => "/repo", activeFilePath: () => "src/app.ts",
    locateCurrentFile: () => events.push("locate"), openSearch() {}, openPanel() {},
    async openFile() {}, async openMatch() {}, wrongWorkspace() {},
    visible: () => visible, presentationChanged() {},
  });
  runtime.controller.installFiles("files", "/repo", "app", [
    { repositoryId: ".", path: "src/app.ts", workspacePath: "src/app.ts", readOnly: false },
  ]);

  assert.deepEqual(runtime.commandAvailability("locate-current"), { enabled: true });
  assert.deepEqual(runtime.commandAvailability("toggle-results-view"), { enabled: true });
  assert.equal(runtime.commandAvailability("expand-results").enabled, false);
  runtime.controller.selectFile("src", "directory");
  assert.deepEqual(runtime.commandAvailability("expand-results"), { enabled: true });
  runtime.executeCommand("locate-current");
  assert.deepEqual(events, ["locate"]);
  visible = false;
  assert.equal(runtime.commandAvailability("toggle-results-view").enabled, false);
});

test("Search commands register stable metadata and delegate execution", async () => {
  const registry = new CommandRegistry();
  const actions = [];
  const release = registerSearchCommands(registry, {
    catalog: () => EN_US,
    searchCommandAvailability: () => ({ enabled: true }),
    executeSearchCommand: (action) => actions.push(action),
  });

  assert.equal(registry.get(SEARCH_COMMANDS.locateCurrent).title(), EN_US.projectFiles.locateCurrentFile);
  assert.ok(registry.get(SEARCH_COMMANDS.toggleResultsView).userBindingScopes.includes("workbench"));
  await registry.get(SEARCH_COMMANDS.collapseResults).execute("keyboard");
  assert.deepEqual(actions, ["collapse-results"]);
  release();
  assert.deepEqual(registry.list(), []);
});
