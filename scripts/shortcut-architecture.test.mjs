import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import { APPLICATION_COMMAND_IDS } from "../src/application/commands/application-command-ids.ts";
import { CHANGES_COMMANDS } from "../src/application/commands/changes-command-ids.ts";
import {
  DIFF_COMMANDS,
  EDITOR_COMMANDS,
  FILES_COMMANDS,
} from "../src/application/commands/files-editor-command-ids.ts";
import { GIT_OPERATION_COMMANDS } from "../src/application/commands/git-operation-command-ids.ts";
import { HISTORY_COMMANDS } from "../src/application/commands/history-command-ids.ts";
import { REMOTE_COMMANDS } from "../src/application/commands/remote-command-ids.ts";
import { SEARCH_COMMANDS } from "../src/application/commands/search-command-ids.ts";
import { STASH_COMMANDS } from "../src/application/commands/stash-command-ids.ts";
import { WORKBENCH_COMMANDS } from "../src/application/commands/workbench-command-ids.ts";
import { registerApplicationCommands } from "../src/composition/application-command-runtime.ts";
import { registerWorkbenchCommands } from "../src/composition/workbench-command-runtime.ts";
import { DEFAULT_KEYBINDINGS } from "../src/features/keybindings/default-keybindings.ts";
import { KeybindingController } from "../src/features/keybindings/keybinding-controller.ts";
import {
  defaultKeybindingsForPlatform,
  formatKeySequence,
  sequenceSignature,
  sequenceStartsWith,
} from "../src/features/keybindings/keybinding-normalizer.ts";
import { KeybindingStore } from "../src/features/keybindings/keybinding-store.ts";
import { EN_US } from "../src/localization/en-US.ts";

const root = new URL("../", import.meta.url);

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

function keyboard(key, modifiers = {}) {
  return {
    key,
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
    ...modifiers,
  };
}

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
    projectFilesCommandAvailability: () => ({ enabled: false, reason: "Files selection required" }),
    executeProjectFilesCommand: () => undefined,
    changesCommandAvailability: () => ({ enabled: false, reason: "Changes required" }),
    executeChangesCommand: () => undefined,
    stashCommandAvailability: () => ({ enabled: false, reason: "Stash required" }),
    executeStashCommand: () => undefined,
    historyCommandAvailability: () => ({ enabled: false, reason: "History required" }),
    executeHistoryCommand: () => undefined,
    remoteCommandAvailability: () => ({ enabled: false, reason: "Remote required" }),
    executeRemoteCommand: () => undefined,
    searchCommandAvailability: () => ({ enabled: false, reason: "Search required" }),
    executeSearchCommand: () => undefined,
    gitOperationAvailable: () => true,
    gitRecoveryAvailable: () => true,
    openGitOperation: () => undefined,
    openGitRecoveries: () => undefined,
    terminalCommandAvailable: () => false,
    executeTerminalCommand: () => undefined,
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
    const command = registry.get(binding.commandId);
    assert.ok(
      command,
      `default keybinding ${binding.id} references unknown command ${binding.commandId}`,
    );
    for (const scope of binding.scopes) {
      assert.ok(
        command.userBindingScopes.includes(scope),
        `default keybinding ${binding.id} uses undeclared ${scope} scope for ${binding.commandId}`,
      );
    }
  }
  for (const [group, ids, scopes] of [
    ["Files", Object.values(FILES_COMMANDS).filter((id) => id !== FILES_COMMANDS.locateActive), ["files"]],
    ["Changes", Object.values(CHANGES_COMMANDS), ["changes"]],
    ["Editor", Object.values(EDITOR_COMMANDS), ["editor"]],
    ["Diff", Object.values(DIFF_COMMANDS), ["diff"]],
    ["History", Object.values(HISTORY_COMMANDS), ["history"]],
    ["Stash", Object.values(STASH_COMMANDS), ["stash"]],
  ]) {
    for (const id of ids) {
      assert.deepEqual(
        registry.get(id).userBindingScopes,
        scopes,
        `${group} command ${id} must not leak into another surface`,
      );
    }
  }
  for (const id of [
    SEARCH_COMMANDS.locateCurrent,
    SEARCH_COMMANDS.toggleResultsView,
    SEARCH_COMMANDS.expandResults,
    SEARCH_COMMANDS.collapseResults,
  ]) {
    assert.deepEqual(registry.get(id).userBindingScopes, ["search"]);
  }
  assert.deepEqual(registry.get(SEARCH_COMMANDS.previewReplacement).userBindingScopes, ["search", "input"]);
  assert.deepEqual(registry.get(SEARCH_COMMANDS.applyReplacement).userBindingScopes, ["replacement"]);

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

test("the verified macOS IDE preset resolves familiar actions without default conflicts", () => {
  const rules = defaultKeybindingsForPlatform(DEFAULT_KEYBINDINGS, "macos");
  const shortcuts = (commandId) => rules
    .filter((rule) => rule.commandId === commandId)
    .map((rule) => formatKeySequence(rule.sequence, "macos"));

  assert.deepEqual(shortcuts(WORKBENCH_COMMANDS.refresh), ["⌘⇧Y"]);
  assert.ok(shortcuts(WORKBENCH_COMMANDS.toggleFiles).includes("⌘1"));
  assert.ok(shortcuts(WORKBENCH_COMMANDS.toggleChanges).includes("⌘0"));
  assert.ok(shortcuts(WORKBENCH_COMMANDS.toggleGit).includes("⌘9"));
  assert.ok(shortcuts(WORKBENCH_COMMANDS.toggleTerminal).includes("⌥F12"));
  assert.ok(shortcuts(FILES_COMMANDS.renameSelection).includes("⌘R"));
  assert.ok(shortcuts(FILES_COMMANDS.openSelection).includes("F4"));
  assert.ok(shortcuts(FILES_COMMANDS.openSelection).includes("⌥S"));
  assert.ok(shortcuts(EDITOR_COMMANDS.previousTab).includes("⌃⇧←"));
  assert.ok(shortcuts(DIFF_COMMANDS.nextChange).includes("⌃⇧→"));
  assert.ok(shortcuts(CHANGES_COMMANDS.toggleView).includes("⌃P"));
  assert.ok(shortcuts(CHANGES_COMMANDS.openSource).includes("F4"));
  assert.ok(shortcuts(CHANGES_COMMANDS.openSource).includes("⌥S"));
  assert.ok(shortcuts(HISTORY_COMMANDS.createBranch).includes("⌘⌥N"));
  assert.ok(shortcuts(REMOTE_COMMANDS.openUpdate).includes("⌘T"));
  assert.ok(shortcuts(REMOTE_COMMANDS.openPush).includes("⌘⇧K"));
  assert.ok(shortcuts(GIT_OPERATION_COMMANDS.open).includes("⌃V"));

  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    const left = rules[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const right = rules[rightIndex];
      if (!left.scopes.some((scope) => right.scopes.includes(scope))) continue;
      assert.notEqual(
        sequenceSignature(left.sequence),
        sequenceSignature(right.sequence),
        `default conflict between ${left.id} and ${right.id}`,
      );
      assert.equal(
        sequenceStartsWith(left.sequence, right.sequence) ||
          sequenceStartsWith(right.sequence, left.sequence),
        false,
        `default prefix conflict between ${left.id} and ${right.id}`,
      );
    }
  }
});

test("the compatibility preset keeps direct destructive actions unassigned", () => {
  const assigned = new Set(
    defaultKeybindingsForPlatform(DEFAULT_KEYBINDINGS, "macos")
      .map((rule) => rule.commandId),
  );
  for (const commandId of [
    CHANGES_COMMANDS.restore,
    CHANGES_COMMANDS.trash,
    HISTORY_COMMANDS.resetToCommit,
    HISTORY_COMMANDS.restoreFile,
    HISTORY_COMMANDS.deleteBranch,
    HISTORY_COMMANDS.deleteLocalTag,
    HISTORY_COMMANDS.deleteRemoteTag,
  ]) {
    assert.equal(assigned.has(commandId), false, `${commandId} must remain opt-in`);
  }
});

test("the macOS IDE preset dispatches by focus scope and intercepts terminal toggles", () => {
  const registry = new CommandRegistry();
  const release = registerApplicationCommands(registry, {
    ...runtimeOptions(),
    root: { querySelector: () => null },
  });
  const controller = new KeybindingController(
    registry,
    new KeybindingStore(new MemoryStorage()),
    DEFAULT_KEYBINDINGS,
    "macos",
  );

  assert.deepEqual(
    controller.dispatch(keyboard("1", { metaKey: true }), "workbench"),
    { kind: "command", commandId: WORKBENCH_COMMANDS.toggleFiles },
  );
  assert.deepEqual(
    controller.dispatch(keyboard("F12", { altKey: true }), "terminal", true),
    { kind: "command", commandId: WORKBENCH_COMMANDS.toggleTerminal },
  );
  assert.deepEqual(
    controller.dispatch(
      keyboard("ArrowLeft", { ctrlKey: true, shiftKey: true }),
      "editor",
    ),
    { kind: "command", commandId: EDITOR_COMMANDS.previousTab },
  );
  assert.deepEqual(
    controller.dispatch(
      keyboard("ArrowLeft", { ctrlKey: true, shiftKey: true }),
      "diff",
    ),
    { kind: "command", commandId: DIFF_COMMANDS.previousChange },
  );
  assert.deepEqual(
    controller.dispatch(keyboard("R", { metaKey: true }), "files"),
    { kind: "command", commandId: FILES_COMMANDS.renameSelection },
  );
  assert.deepEqual(
    controller.dispatch(keyboard("R", { metaKey: true }), "history"),
    { kind: "command", commandId: HISTORY_COMMANDS.renameBranch },
  );
  assert.deepEqual(
    controller.dispatch(keyboard("Y", { metaKey: true, shiftKey: true }), "editor"),
    { kind: "command", commandId: WORKBENCH_COMMANDS.refresh },
  );
  assert.deepEqual(
    controller.dispatch(keyboard("{", { metaKey: true, shiftKey: true }), "diff"),
    { kind: "command", commandId: DIFF_COMMANDS.previousFile },
  );
  for (const [scope, commandId] of [
    ["files", FILES_COMMANDS.openSelection],
    ["changes", CHANGES_COMMANDS.openSource],
    ["diff", DIFF_COMMANDS.openSource],
    ["history", HISTORY_COMMANDS.openCurrentFile],
  ]) {
    assert.deepEqual(
      controller.dispatch(keyboard("ß", { code: "KeyS", altKey: true }), scope),
      { kind: "command", commandId },
      `Option+S must resolve inside ${scope}`,
    );
  }
  for (const scope of ["workbench", "search", "stash", "history-input", "remote", "replacement", "dialog"]) {
    assert.deepEqual(
      controller.dispatch(keyboard("s", { altKey: true }), scope),
      { kind: "none" },
      `Option+S must not leak into ${scope}`,
    );
  }
  assert.deepEqual(
    controller.dispatch(keyboard("f", { metaKey: true }), "history-input"),
    { kind: "command", commandId: WORKBENCH_COMMANDS.historyFind },
  );

  controller.dispose();
  release();
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

test("repository menu and visible notification commands reuse stable shell buttons", async () => {
  const clicks = [];
  let toastVisible = false;
  const button = (name) => ({
    disabled: false,
    getAttribute: () => null,
    click: () => clicks.push(name),
  });
  const repository = button("repository");
  const toast = button("toast");
  const registry = new CommandRegistry();
  const releaseCommands = registerWorkbenchCommands(registry, runtimeOptions({
    catalog: () => EN_US,
    root: {
      querySelector(selector) {
        if (selector === "#repository-switcher") return repository;
        if (selector === "#toast:not(.hidden) #toast-close") return toastVisible ? toast : null;
        return null;
      },
    },
  }));

  assert.equal(registry.get(WORKBENCH_COMMANDS.toggleRepositoryMenu).availability().enabled, true);
  assert.equal(registry.get(WORKBENCH_COMMANDS.dismissNotification).availability().enabled, false);
  await registry.get(WORKBENCH_COMMANDS.toggleRepositoryMenu).execute("keyboard");
  toastVisible = true;
  assert.equal(registry.get(WORKBENCH_COMMANDS.dismissNotification).availability().enabled, true);
  await registry.get(WORKBENCH_COMMANDS.dismissNotification).execute("keyboard");
  assert.deepEqual(clicks, ["repository", "toast"]);
  releaseCommands();
});
