import assert from "node:assert/strict";
import test from "node:test";

import { renderBranchNavigation } from "../src/features/git-history/branch-navigation-view.ts";
import { renderCommitDetail } from "../src/features/git-history/git-detail-view.ts";
import { renderHistoryDialogView } from "../src/features/git-history/history-dialog-view.ts";
import { renderHistoryNavigation } from "../src/features/git-history/history-navigation-view.ts";
import {
  renderDiffControls,
  renderEditorTabMenu,
  renderEditorTabs,
  renderMarkdownModeControls,
} from "../src/features/files-editor/editor-view.ts";
import {
  renderCommandSurface,
  renderWorkspaceReplacementDialog,
} from "../src/features/files-editor/workspace-navigation-view.ts";
import { createRemotePushState } from "../src/features/remote-push/remote-push-state.ts";
import { renderRemoteDialogContent } from "../src/features/remote-push/remote-push-view.ts";
import { renderSettingsNavigation, renderSettingsSection } from "../src/features/settings/settings-view.ts";
import { ShellController } from "../src/shell/shell-controller.ts";
import { renderShellView } from "../src/shell/shell-view.ts";
import { createCommandSurfaceState, openCommandSurface } from "../src/workbench/navigation.ts";
import { DEFAULT_APP_PREFERENCES } from "../src/workbench/preferences.ts";
import { createWorkspaceReplacementState } from "../src/workbench/workspace-replacement.ts";
import { createWorkspaceSearchControls, createWorkspaceSearchState } from "../src/workbench/workspace-search.ts";

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

test("branch navigation keeps repository hierarchy and selection in feature-owned markup", () => {
  const snapshot = repositorySnapshot();
  snapshot.branches = branchFixtures();
  const html = renderBranchNavigation({
    snapshot,
    query: "",
    selectedRepositoryIds: new Set(),
    selectedRefs: new Map([[".:refs%2Fheads%2Fmain", { repositoryId: ".", fullName: "refs/heads/main" }]]),
    collapsedGroups: new Set(),
  });

  assert.match(html, />Local</);
  assert.match(html, />Remote</);
  assert.match(html, /remote-ref-group/);
  assert.match(html, /origin/);
  assert.match(html, /branch-row[^>]*selected/);
});

test("history navigation owns filter menus and list host presentation", () => {
  const snapshot = repositorySnapshot();
  snapshot.branches = branchFixtures();
  const html = renderHistoryNavigation({
    snapshot,
    files: [],
    filesLoading: false,
    filesError: null,
    filesTruncated: false,
    presentation: {
      status: "ready",
      error: null,
      loadedCommits: [],
      commits: [],
      textError: null,
      selectedCommit: null,
      collapseLinear: false,
      bridgeOmittedParents: false,
      repositoryRoots: snapshot.repositoryRoots,
      branches: snapshot.branches,
      loadingMore: false,
      pagingError: null,
      hasMore: false,
    },
    query: "",
    caseSensitive: false,
    regularExpression: false,
    refs: new Map(),
    authorEmails: new Set(),
    currentAuthor: false,
    datePreset: "all",
    paths: new Map(),
    repositoryIds: new Set(),
    recentPaths: [],
    order: "topological",
    firstParent: false,
    excludeMerges: false,
    collapseLinear: false,
    filterMenu: "date",
    branchSubmenu: null,
    favoriteRefs: new Map(),
    recentRefs: [],
  });

  assert.match(html, /history-filter-popover-date/);
  assert.match(html, /Last 24 hours/);
  assert.match(html, /No commits match these filters/);
});

test("history dialogs and commit details render without the application shell", () => {
  const snapshot = repositorySnapshot();
  snapshot.branches = branchFixtures();
  const dialog = renderHistoryDialogView({
    kind: "branches",
    snapshot,
    files: [],
    query: "",
    error: null,
    refDraft: new Map(),
    favoriteRefs: new Map(),
    pathDraft: new Map(),
    pathText: "",
    collapsedTreePaths: new Set(),
  });
  const commit = commitFixture();
  const detail = renderCommitDetail({
    snapshot,
    commit,
    details: {
      repositoryId: ".",
      oid: commit.oid,
      parentOid: "1111111111111111",
      files: [{ path: "src/main.ts", originalPath: null, status: "modified" }],
    },
    loading: false,
    error: null,
    selectedFile: "src/main.ts",
    fileView: "tree",
    collapsedDirectories: new Set(),
  });

  assert.match(dialog, /Select Branches or Tags/);
  assert.match(dialog, /data-history-dialog-ref/);
  assert.match(detail, /src\/main\.ts|main\.ts/);
  assert.match(detail, /Compared with 1111111111/);
});

test("workspace navigation and replacement previews are feature-owned", () => {
  const commandSurface = openCommandSurface(createCommandSurfaceState(), "files");
  const commandHtml = renderCommandSurface({
    commandSurface,
    workspaceOpen: true,
    filesLoading: false,
    files: [{ repositoryId: ".", path: "src/app.ts", workspacePath: "src/app.ts" }],
    commands: [],
    workspaceSearch: createWorkspaceSearchState(),
    workspaceSearchControls: createWorkspaceSearchControls(),
    searchRequestIsCurrent: false,
    replacementText: "",
    replacementRecoveryCount: 0,
  });
  const replacement = createWorkspaceReplacementState();
  replacement.status = "error";
  replacement.error = "Preview expired";
  const replacementHtml = renderWorkspaceReplacementDialog({
    dialog: "preview",
    replacement,
    recoveryBusy: null,
    blockedOpenPaths: new Set(),
  });

  assert.match(commandHtml, /Search project files/);
  assert.match(commandHtml, /app\.ts/);
  assert.match(commandHtml, /<small>src<\/small>/);
  assert.match(replacementHtml, /Replacement preview unavailable/);
  assert.match(replacementHtml, /Preview expired/);
});

test("editor chrome renders tabs, Markdown modes, menu, and Diff controls independently", () => {
  const tab = textTabFixture();
  const session = { textTabs: [tab], preview: null, active: { kind: "text", id: tab.id } };
  const document = tab.document;
  const tabs = renderEditorTabs({ session, document, statusClass: () => "file-status-modified" });
  const menu = renderEditorTabMenu({ session, open: true, statusClass: () => "file-status-modified" });
  const markdown = renderMarkdownModeControls(tab);
  const diff = renderDiffControls({
    imageDiff: false,
    textReady: true,
    previousFile: null,
    nextFile: "src/next.ts",
    canOpenSource: true,
    expanded: false,
    preferences: DEFAULT_APP_PREFERENCES,
  });

  assert.match(tabs, /file-status-modified/);
  assert.match(tabs, /README\.md/);
  assert.match(menu, /data-editor-menu-tab-index/);
  assert.match(markdown, /data-markdown-mode="split"/);
  assert.match(diff, /next-file[^>]*>/);
  assert.match(diff, /data-diff-layout="split"/);
});

function viewModel(state) {
  return {
    snapshot: repositorySnapshot(),
    state,
    workspaceRoot: "/workspace/repository",
    preferences: DEFAULT_APP_PREFERENCES,
    selectedProjectFileAvailable: false,
  };
}

function repositorySnapshot() {
  return {
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
  };
}

function branchFixtures() {
  return [
    {
      repositoryId: ".",
      fullName: "refs/heads/main",
      name: "main",
      oid: "0123456789abcdef",
      current: true,
      kind: "local",
      upstream: "origin/main",
      tracking: "ahead 2, behind 1",
      committedAt: 1_700_000_000,
      subject: "Main subject",
    },
    {
      repositoryId: ".",
      fullName: "refs/remotes/origin/main",
      name: "origin/main",
      oid: "fedcba9876543210",
      current: false,
      kind: "remote",
      upstream: null,
      tracking: null,
      committedAt: 1_699_999_000,
      subject: "Remote subject",
    },
  ];
}

function commitFixture() {
  return {
    repositoryId: ".",
    oid: "2222222222222222",
    shortOid: "2222222",
    parents: ["1111111111111111"],
    authorName: "Asterlyn",
    authorEmail: "asterlyn@example.com",
    authoredAt: 1_700_000_000,
    decorations: ["HEAD -> main"],
    subject: "Extract history views",
  };
}

function textTabFixture() {
  const document = {
    kind: "project-file",
    repositoryRoot: "/workspace/repository",
    repositoryId: ".",
    path: "README.md",
    workspacePath: "README.md",
  };
  return {
    id: "file\0/workspace/repository\0.\0README.md",
    document,
    status: "ready",
    content: "# Asterlyn",
    persistedContent: "# Asterlyn",
    utf8Bom: false,
    revision: "one",
    loadEpoch: 1,
    editVersion: 0,
    persistedVersion: 0,
    saveRequest: null,
    error: null,
    conflict: false,
    markdownMode: "split",
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
