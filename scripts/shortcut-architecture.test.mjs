import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import { APPLICATION_COMMAND_IDS } from "../src/application/commands/application-command-ids.ts";
import { WORKBENCH_COMMANDS } from "../src/application/commands/workbench-command-ids.ts";
import { registerApplicationCommands } from "../src/composition/application-command-runtime.ts";
import { registerWorkbenchCommands } from "../src/composition/workbench-command-runtime.ts";
import { DEFAULT_KEYBINDINGS } from "../src/features/keybindings/default-keybindings.ts";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

function runtimeOptions(overrides = {}) {
  const commandCopy = {
    label: "Command",
    detail: "Command detail",
    aliases: "command aliases",
  };
  return {
    catalog: () => ({
      navigation: {
        commands: new Proxy({}, { get: () => commandCopy }),
        titles: { commands: "Commands" },
        hints: { commands: "Open commands" },
      },
      settings: { keybindings: {
        workspaceRequired: "Workspace required",
        editorRequired: "Editor required",
        historyRequired: "History required",
        gitRequired: "Git required",
        settingsRequired: "Settings required",
        leftToolRequired: "Left tool required",
        bottomToolRequired: "Bottom tool required",
      } },
    }),
    workspaceOpen: () => true,
    gitAvailable: () => true,
    settingsOpen: () => false,
    leftToolVisible: () => true,
    bottomToolVisible: () => true,
    editorFindAvailable: () => true,
    historyFindAvailable: () => true,
    saveAvailable: () => true,
    refreshAvailable: () => true,
    openCommandSurface: () => undefined,
    openRepository: () => undefined,
    openEditorFind: () => undefined,
    focusHistoryFilter: () => undefined,
    saveFile: () => undefined,
    refresh: () => undefined,
    openSettings: () => undefined,
    closeSettings: () => undefined,
    toggleTool: () => undefined,
    hideLeftTool: () => undefined,
    hideBottomTool: () => undefined,
    ...overrides,
  };
}

test("registered application commands, defaults, and the architecture ledger stay aligned", async () => {
  const registry = new CommandRegistry();
  const release = registerApplicationCommands(registry, {
    ...runtimeOptions(),
    root: { querySelector: () => null },
  });
  const commandIds = [...APPLICATION_COMMAND_IDS].sort();
  const registeredIds = registry.list().map(({ id }) => id).sort();

  assert.deepEqual(registeredIds, commandIds, "every declared workbench command must be registered once");
  assert.equal(new Set(commandIds).size, commandIds.length, "command IDs must be unique");
  assert.equal(
    new Set(DEFAULT_KEYBINDINGS.map(({ id }) => id)).size,
    DEFAULT_KEYBINDINGS.length,
    "default keybinding rule IDs must be unique",
  );
  for (const binding of DEFAULT_KEYBINDINGS) {
    assert.ok(
      commandIds.includes(binding.commandId),
      `default keybinding ${binding.id} references unknown command ${binding.commandId}`,
    );
  }

  const ledger = await read("docs/architecture/keyboard-shortcut-coverage.md");
  for (const id of commandIds) {
    assert.ok(ledger.includes(`\`${id}\``), `${id} must be classified in the shortcut ledger`);
  }
  assert.match(ledger, /organized primarily by \*\*product surface\*\*/);
  assert.match(ledger, /Every new user-visible action must receive exactly one classification/);

  release();
  assert.deepEqual(registry.list(), [], "disposing the runtime must unregister every command");
});

test("architecture and lifecycle documents point to the maintained shortcut ledger", async () => {
  const [overview, decision, lifecycle] = await Promise.all([
    read("docs/architecture/overview.md"),
    read("docs/architecture/decisions/0018-command-and-keybinding-system.md"),
    read("docs/governance/lifecycle.md"),
  ]);

  assert.match(overview, /keyboard-shortcut-coverage\.md/);
  assert.match(decision, /keyboard-shortcut-coverage\.md/);
  assert.match(lifecycle, /keyboard-shortcut-coverage\.md/);
});

test("global surface commands keep live availability and reuse their feature callbacks", async () => {
  const registry = new CommandRegistry();
  const calls = [];
  let settingsOpen = false;
  let leftToolVisible = false;
  let bottomToolVisible = false;
  const release = registerWorkbenchCommands(registry, runtimeOptions({
    settingsOpen: () => settingsOpen,
    leftToolVisible: () => leftToolVisible,
    bottomToolVisible: () => bottomToolVisible,
    openSettings: () => calls.push("open-settings"),
    closeSettings: () => calls.push("close-settings"),
    toggleTool: (tool) => calls.push(`toggle:${tool}`),
    hideLeftTool: () => calls.push("hide-left"),
    hideBottomTool: () => calls.push("hide-bottom"),
  }));

  assert.equal(registry.get(WORKBENCH_COMMANDS.closeSettings).availability().enabled, false);
  assert.equal(registry.get(WORKBENCH_COMMANDS.hideLeftTool).availability().enabled, false);
  assert.equal(registry.get(WORKBENCH_COMMANDS.hideBottomTool).availability().enabled, false);
  settingsOpen = true;
  leftToolVisible = true;
  bottomToolVisible = true;
  assert.equal(registry.get(WORKBENCH_COMMANDS.closeSettings).availability().enabled, true);
  assert.equal(registry.get(WORKBENCH_COMMANDS.hideLeftTool).availability().enabled, true);
  assert.equal(registry.get(WORKBENCH_COMMANDS.hideBottomTool).availability().enabled, true);

  await registry.get(WORKBENCH_COMMANDS.openSettings).execute("keyboard");
  await registry.get(WORKBENCH_COMMANDS.closeSettings).execute("keyboard");
  await registry.get(WORKBENCH_COMMANDS.toggleSearch).execute("keyboard");
  await registry.get(WORKBENCH_COMMANDS.toggleStash).execute("keyboard");
  await registry.get(WORKBENCH_COMMANDS.hideLeftTool).execute("keyboard");
  await registry.get(WORKBENCH_COMMANDS.hideBottomTool).execute("keyboard");
  assert.deepEqual(calls, [
    "open-settings",
    "close-settings",
    "toggle:search",
    "toggle:stash",
    "hide-left",
    "hide-bottom",
  ]);
  for (const id of [
    WORKBENCH_COMMANDS.toggleFiles,
    WORKBENCH_COMMANDS.toggleSearch,
    WORKBENCH_COMMANDS.toggleChanges,
    WORKBENCH_COMMANDS.toggleGit,
    WORKBENCH_COMMANDS.toggleStash,
    WORKBENCH_COMMANDS.toggleTerminal,
    WORKBENCH_COMMANDS.hideLeftTool,
    WORKBENCH_COMMANDS.hideBottomTool,
  ]) {
    assert.ok(registry.get(id).userBindingScopes.includes("terminal"));
  }
  const settingsDefault = DEFAULT_KEYBINDINGS.find(({ commandId }) =>
    commandId === WORKBENCH_COMMANDS.openSettings
  );
  assert.equal(settingsDefault.sequence[0].key, ",");
  assert.equal(settingsDefault.terminalPolicy, "intercept");
  release();
});
