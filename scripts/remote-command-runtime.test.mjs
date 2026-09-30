import assert from "node:assert/strict";
import test from "node:test";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import { REMOTE_COMMANDS } from "../src/application/commands/remote-command-ids.ts";
import { registerRemoteCommands } from "../src/composition/remote-command-runtime.ts";
import { RemoteCommandAdapter } from "../src/features/remote-push/remote-command-adapter.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("Remote command adapter rechecks live review state and reuses controller actions", async () => {
  const events = [];
  const file = { path: "src/app.ts", originalPath: null, status: "modified" };
  const state = {
    dialog: "push", pushPreview: { hasMore: true }, pushPreviewLoadingMore: false,
    pushFileView: "tree", pushSelectedFile: file.path, pushFileActionLoading: false,
    operation: null,
  };
  const push = {
    state,
    pushReviewFiles: () => [file],
    openSelectedPushFileDiff: () => events.push(["diff"]),
    togglePushFileView: () => events.push(["view"]),
    expandPushDirectories: () => events.push(["expand"]),
    collapsePushDirectories: (paths) => events.push(["collapse", [...paths]]),
    loadMorePushPreview: () => events.push(["more"]),
  };
  const adapter = new RemoteCommandAdapter(push, { open: () => events.push(["manage"]) }, {
    snapshot: () => ({ root: "/repo" }), busy: () => false, copy: () => EN_US.remote,
    actionBlockedReason: () => null,
    openAction: (kind) => events.push(["open", kind]),
    cancelOperation: () => events.push(["cancel"]),
    selectedProjectFileAvailable: () => true,
    openSelectedProjectFile: () => events.push(["source"]),
  });

  assert.deepEqual(adapter.commandAvailability("open-push"), { enabled: true });
  assert.deepEqual(adapter.commandAvailability("open-file-diff"), { enabled: true });
  await adapter.executeCommand("open-update");
  await adapter.executeCommand("manage");
  await adapter.executeCommand("open-file-diff");
  await adapter.executeCommand("open-current-file");
  await adapter.executeCommand("toggle-file-view");
  await adapter.executeCommand("expand-folders");
  await adapter.executeCommand("collapse-folders");
  await adapter.executeCommand("load-more");
  assert.deepEqual(events, [
    ["open", "pull"], ["manage"], ["diff"], ["source"], ["view"], ["expand"],
    ["collapse", [".", "src"]], ["more"],
  ]);

  state.operation = { kind: "push", background: false, cancelling: false };
  assert.deepEqual(adapter.commandAvailability("cancel-operation"), { enabled: true });
  await adapter.executeCommand("cancel-operation");
  state.operation.cancelling = true;
  assert.equal(adapter.commandAvailability("cancel-operation").enabled, false);
  assert.deepEqual(events.at(-1), ["cancel"]);
});

test("Remote commands register localized metadata, dialog scopes, and live callbacks", async () => {
  const registry = new CommandRegistry();
  const actions = [];
  const release = registerRemoteCommands(registry, {
    catalog: () => EN_US,
    remoteCommandAvailability: (action) => action === "open-push"
      ? { enabled: false, reason: "blocked" }
      : { enabled: true },
    executeRemoteCommand: (action) => actions.push(action),
  });

  assert.equal(registry.get(REMOTE_COMMANDS.openUpdate).title(), EN_US.remote.update);
  assert.deepEqual(registry.get(REMOTE_COMMANDS.openPush).availability(), {
    enabled: false, reason: "blocked",
  });
  assert.deepEqual(registry.get(REMOTE_COMMANDS.openFileDiff).userBindingScopes, ["remote"]);
  await registry.get(REMOTE_COMMANDS.manage).execute("palette");
  await registry.get(REMOTE_COMMANDS.loadMore).execute("keyboard");
  assert.deepEqual(actions, ["manage", "load-more"]);
  release();
  assert.deepEqual(registry.list(), []);
});
