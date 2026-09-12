import assert from "node:assert/strict";
import test from "node:test";

import { createRemotePushState } from "../src/features/remote-push/remote-push-state.ts";
import { renderRemoteDialogContent } from "../src/features/remote-push/remote-push-view.ts";
import { renderSettingsNavigation, renderSettingsSection } from "../src/features/settings/settings-view.ts";
import { ShellController } from "../src/shell/shell-controller.ts";
import { renderShellView } from "../src/shell/shell-view.ts";
import { DEFAULT_APP_PREFERENCES } from "../src/workbench/preferences.ts";

test("shell view follows persisted activity order and exposes stable feature hosts", () => {
  const shell = new ShellController(memoryStorage());
  shell.setActivityOrder(["changes", "files", "branches"]);
  const html = renderShellView({
    shell: shell.state,
    workspaceOpen: true,
    gitAvailable: true,
    demo: true,
    windowControlsAvailable: false,
  });

  assert.ok(html.indexOf('data-tool="changes"') < html.indexOf('data-tool="files"'));
  for (const host of ["navigator-body", "content-body", "history-navigation-body", "git-detail-body"]) {
    assert.match(html, new RegExp(`id="${host}"`));
  }
});

test("settings view keeps one selected section and bounded preference controls", () => {
  const navigation = renderSettingsNavigation("editor");
  const content = renderSettingsSection({
    section: "editor",
    preferences: DEFAULT_APP_PREFERENCES,
  }, {
    id: null,
    kind: "idle",
  });

  assert.equal((navigation.match(/settings-navigation-item selected/g) ?? []).length, 1);
  assert.match(content, /Editor font size/);
  assert.match(content, /Editor line spacing/);
});

test("remote view renders explicit update and reviewed push boundaries", () => {
  const state = createRemotePushState();
  state.dialog = "update";
  const update = renderRemoteDialogContent(viewModel(state));
  assert.match(update, /Fast-forward only/);
  assert.match(update, /Merge incoming changes .*Unavailable/);

  state.dialog = "push";
  state.pushPreviewLoading = true;
  const push = renderRemoteDialogContent(viewModel(state));
  assert.match(push, /Push Commits to main/);
  assert.match(push, /Reading outgoing commits, tags, and files/);
  assert.match(push, /Force Push with Lease/);
});

function viewModel(state) {
  return {
    snapshot: {
      root: "/workspace/repository",
      gitDir: "/workspace/repository/.git",
      repositoryRoots: [{ id: ".", relativePath: ".", displayName: "repository", kind: "main" }],
      branch: {
        head: "main",
        oid: "0123456789abcdef",
        upstream: "origin/main",
        upstreamRemote: "origin",
        upstreamRef: "refs/heads/main",
        ahead: 2,
        behind: 1,
        detached: false,
        unborn: false,
      },
      operation: null,
      changes: [],
      commits: [],
      branches: [],
      remotes: [{ name: "origin", fetchSupported: true, pushSupported: true }],
      untrackedState: "complete",
    },
    state,
    workspaceRoot: "/workspace/repository",
    preferences: DEFAULT_APP_PREFERENCES,
    selectedProjectFileAvailable: false,
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
  };
}
