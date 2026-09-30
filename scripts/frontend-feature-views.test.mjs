import assert from "node:assert/strict";
import test from "node:test";

import {
  branchIsSelected,
  renderBranchNavigation,
} from "../src/features/git-history/branch-navigation-view.ts";
import {
  renderCommitComparisonDetail,
  renderCommitDetail,
  renderCommitFolderDetail,
} from "../src/features/git-history/git-detail-view.ts";
import { renderHistoryDialogView } from "../src/features/git-history/history-dialog-view.ts";
import { renderHistoryNavigation } from "../src/features/git-history/history-navigation-view.ts";
import {
  actionableEmptyState,
  contentHeading,
  editorWelcomePresentation,
  renderDiffControls,
  renderEditorTabMenu,
  renderEditorTabs,
  renderMarkdownModeControls,
} from "../src/features/files-editor/editor-view.ts";
import { renderProjectFilesOperationDialog } from "../src/features/files-editor/project-files-operation-view.ts";
import {
  renderCommandSurface,
  renderWorkspaceReplacementDialog,
} from "../src/features/files-editor/workspace-navigation-view.ts";
import { createRemotePushState } from "../src/features/remote-push/remote-push-state.ts";
import {
  pushDiffSideLabels,
  renderRemoteDialogContent,
  renderRemoteToolbarView,
} from "../src/features/remote-push/remote-push-view.ts";
import { renderSettingsNavigation, renderSettingsSection } from "../src/features/settings/settings-view.ts";
import { ShellController } from "../src/shell/shell-controller.ts";
import { renderShellView } from "../src/shell/shell-view.ts";
import { hideWorkspaceToolWindows } from "../src/shell/workspace-availability.ts";
import { createCommandSurfaceState, openCommandSurface } from "../src/features/files-editor/navigation.ts";
import { DEFAULT_APP_PREFERENCES } from "../src/preferences.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { createWorkspaceReplacementState } from "../src/features/files-editor/workspace-replacement.ts";
import { createWorkspaceSearchControls, createWorkspaceSearchState } from "../src/features/files-editor/workspace-search.ts";
import { historyPathApplyShortcut } from "../src/composition/history-shortcut-presentation.ts";

test("shell view follows persisted activity order and exposes stable feature hosts", () => {
  const shell = new ShellController(memoryStorage());
  shell.setActivityOrder(["changes", "files", "branches", "stash", "terminal"]);
  const html = renderShellView({
    shell: shell.state,
    workspaceOpen: true,
    gitAvailable: true,
    demo: true,
    windowControlsAvailable: false,
  });

  assert.ok(html.indexOf('data-tool="changes"') < html.indexOf('data-tool="files"'));
  assert.match(html, /data-tool="terminal"/);
  assert.match(html, /data-tool="stash"/);
  assert.match(html, /id="stash-tool-grid"/);
  assert.match(html, /id="terminal-tool-host"/);
  assert.match(html, /id="find-tool-host"/);
  assert.match(html, /id="terminal-header-actions"/);
  assert.match(html, /class="compact-icon-button bottom-tool-hide" id="hide-bottom-tool"/);
  assert.match(html, /id="changes-restore-review-dialog"/);
  for (const host of [
    "navigator-header", "navigator-body", "content-body", "history-navigation-body",
    "git-detail-body",
  ]) {
    assert.match(html, new RegExp(`id="${host}"`));
  }
  assert.match(html, /id="navigator-header"[^>]*>.*data-navigator-header-controls/u);
  assert.ok(html.indexOf('id="repository-switcher-anchor"') < html.indexOf('id="command-center-button"'));
  assert.ok(html.indexOf('id="command-center-button"') < html.indexOf('class="topbar-actions"'));
  assert.doesNotMatch(html, /id="remote-toolbar-menu"|id="remote-fetch"/);
  assert.match(html, /id="remote-update"[^]*id="remote-push"/);
  assert.doesNotMatch(html, /id="remote-update"[^>]* disabled/);
  assert.doesNotMatch(html, /id="refresh-button"/);
  assert.doesNotMatch(html, /id="git-recoveries-open"/);
  assert.match(html, /class="status-indicator success" id="status-indicator"/);
});

test("empty workspace is ready, hides tool windows, and disables every activity entry", () => {
  const shell = new ShellController(memoryStorage());
  const html = renderShellView({
    shell: shell.state,
    workspaceOpen: false,
    gitAvailable: false,
    demo: false,
    windowControlsAvailable: false,
  });

  for (const tool of shell.state.activityOrder) {
    const button = activityButtonMarkup(html, tool);
    assert.match(button, /\sdisabled(?:\s|>)/u);
    assert.match(button, /aria-disabled="true"/u);
    assert.match(button, /aria-pressed="false"/u);
    assert.doesNotMatch(button, /\bactive\b/u);
  }
  assert.match(html, /id="left-tool"[^>]*\bhidden\b/u);
  assert.match(html, /id="left-splitter"[^>]*\bhidden\b/u);
  assert.match(html, /id="bottom-tool"[^>]*\bhidden\b/u);
  assert.match(html, /id="bottom-splitter"[^>]*\bhidden\b/u);
  assert.doesNotMatch(html, /Waiting for a project|class="spinner"/u);
});

test("ordinary folders enable workspace activities while Git activities stay disabled", () => {
  const shell = new ShellController(memoryStorage());
  const html = renderShellView({
    shell: shell.state,
    workspaceOpen: true,
    gitAvailable: false,
    demo: false,
    windowControlsAvailable: false,
  });

  for (const tool of ["files", "search", "terminal"]) {
    const button = activityButtonMarkup(html, tool);
    assert.doesNotMatch(button, /\sdisabled(?:\s|>)/u);
    assert.match(button, /aria-disabled="false"/u);
  }
  for (const tool of ["branches", "changes", "stash"]) {
    const button = activityButtonMarkup(html, tool);
    assert.match(button, /\sdisabled(?:\s|>)/u);
    assert.match(button, /aria-disabled="true"/u);
  }
});

test("empty-workspace reconciliation closes tool windows restored by stale layout state", () => {
  const elements = new Map([
    ["#workbench", fakeElement()], ["#left-tool", fakeElement()],
    ["#left-splitter", fakeElement()], ["#bottom-tool", fakeElement()],
    ["#bottom-splitter", fakeElement()],
  ]);
  elements.get("#workbench").classList.add("left-tool-open", "bottom-tool-open");
  hideWorkspaceToolWindows({ querySelector: (selector) => elements.get(selector) ?? null });

  assert.equal(elements.get("#workbench").classList.contains("left-tool-open"), false);
  assert.equal(elements.get("#workbench").classList.contains("bottom-tool-open"), false);
  for (const selector of ["#left-tool", "#left-splitter", "#bottom-tool", "#bottom-splitter"]) {
    assert.equal(elements.get(selector).getAttribute("hidden"), "");
  }
});

test("actionable empty state exposes an explicit project-folder button", () => {
  const html = actionableEmptyState(
    "Open a project folder",
    "Choose an ordinary folder or Git repository.",
    "open-project-from-welcome",
    "Open a project folder",
  );

  assert.match(html, /class="primary-button empty-state-action"/u);
  assert.match(html, /id="open-project-from-welcome"/u);
  assert.match(html, />Open a project folder<\/button>/u);
});

test("no-project Welcome presentation owns the user-initiated folder chooser action", () => {
  const presentation = editorWelcomePresentation(false, "en-US", EN_US.shell, EN_US.editor);

  assert.equal(presentation.actionId, "open-project-from-welcome");
  assert.match(presentation.html, /class="primary-button empty-state-action"/u);
  assert.match(presentation.html, />Open a project folder<\/button>/u);
});

test("shell search shortcut starts empty until the keybinding projection owns it", () => {
  const shell = new ShellController(memoryStorage());
  shell.setWindowChromeMode("macos-native");
  const html = renderShellView({
    shell: shell.state,
    workspaceOpen: true,
    gitAvailable: true,
    demo: false,
    windowControlsAvailable: true,
  });

  assert.match(html, /<kbd data-command-shortcut hidden><\/kbd>/);
  assert.match(html, /title="Search files and commands"/);
  assert.doesNotMatch(html, /Command\+P|Ctrl P|Ctrl\/Cmd\+P|⌘P/);
});

test("blocked remote actions remain interactive so their exact reason can be announced", () => {
  const repository = repositorySnapshot();
  repository.branch.ahead = 0;
  repository.branch.behind = 0;
  const state = createRemotePushState();
  state.selectedRemote = "origin";
  const clean = remoteToolbarRoot();
  renderRemoteToolbarView(clean.root, repository, state, false);

  assert.equal(clean.elements.get("#remote-update").disabled, false);
  assert.equal(clean.elements.get("#remote-update").getAttribute("aria-disabled"), "false");
  assert.match(clean.elements.get("#remote-update").innerHTML, /M12 4v11/);

  repository.branch.behind = 3;
  const behind = remoteToolbarRoot();
  renderRemoteToolbarView(behind.root, repository, state, false);
  assert.match(behind.elements.get("#remote-update").innerHTML, /remote-count-badge[^>]*>3</);

  repository.branch.behind = 0;
  repository.changes = [{ path: "dirty.txt" }];
  const blocked = remoteToolbarRoot();
  renderRemoteToolbarView(blocked.root, repository, state, false);
  assert.equal(blocked.elements.get("#remote-update").disabled, false);
  assert.equal(blocked.elements.get("#remote-update").getAttribute("aria-disabled"), "true");
  assert.match(blocked.elements.get("#remote-update").title, /local changes first/);

  state.operation = { id: "fetch-1", root: repository.root, kind: "fetch", background: false, cancelling: false };
  const fetching = remoteToolbarRoot();
  renderRemoteToolbarView(fetching.root, repository, state, false);
  assert.equal(fetching.elements.get("#remote-update").getAttribute("aria-disabled"), "true");
  assert.match(fetching.elements.get("#remote-update").title, /Fetch in progress/);
  assert.doesNotMatch(fetching.elements.get("#remote-update").title, /not an active Git repository/);
  assert.equal(fetching.elements.get("#cancel-remote-operation").classList.contains("hidden"), false);
  assert.equal(fetching.elements.get("#cancel-remote-operation").disabled, false);

  state.operation.background = true;
  renderRemoteToolbarView(fetching.root, repository, state, false);
  assert.equal(fetching.elements.get("#cancel-remote-operation").classList.contains("hidden"), true);
  assert.equal(fetching.elements.get("#cancel-remote-operation").disabled, true);
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

  const appearance = renderSettingsSection({
    section: "appearance",
    preferences: { ...DEFAULT_APP_PREFERENCES, theme: "light" },
  }, {
    id: null,
    kind: "idle",
  });
  assert.match(appearance, /data-setting-theme="system"/);
  assert.match(appearance, /data-setting-theme="light" aria-pressed="true"/);

  const versionControl = renderSettingsSection({
    section: "version-control",
    preferences: {
      ...DEFAULT_APP_PREFERENCES,
      askBeforeRemoteUpdate: false,
      preferredRemoteUpdateStrategy: "rebase",
    },
  }, {
    id: null,
    kind: "idle",
  });
  assert.match(versionControl, /id="setting-remote-update-strategy"/);
  assert.match(versionControl, /id="setting-new-file-stage-behavior"/);
  assert.match(versionControl, /value="ask" selected/);
  assert.match(versionControl, /value="rebase" selected/);
  assert.doesNotMatch(versionControl, /id="setting-ask-before-remote-update"[^>]*checked/);

  const updates = renderSettingsSection({
    section: "updates",
    preferences: DEFAULT_APP_PREFERENCES,
  }, { id: null, kind: "idle" }, EN_US.settings, {
    status: "available",
    currentVersion: "0.1.0",
    latestVersion: "v0.2.0",
    releaseUrl: "https://github.com/guozhiqiang123/asterlyn/releases/tag/v0.2.0",
    checkedAtEpochMs: 1_700_000_000_000,
    error: null,
    openingRelease: false,
  });
  assert.match(updates, /Application Updates/);
  assert.match(updates, /Asterlyn v0\.2\.0 is available/);
  assert.match(updates, /id="setting-check-for-updates"/);
  assert.match(updates, /id="setting-open-update-release"/);
});

test("new-file staging choice defaults to a safe untracked action and optional memory", () => {
  const html = renderProjectFilesOperationDialog({
    inlineEdit: null,
    busyPath: null,
    dialog: {
      kind: "stage-created",
      target: {
        workspaceRoot: "/repo", workspaceGeneration: 2, workspacePath: "src", kind: "directory",
        file: null, status: "unmodified", readOnly: false,
      },
      destination: "src/notes.txt",
      remember: false,
      error: null,
      busy: false,
    },
  }, EN_US.projectFiles);
  assert.match(html, /Add the new file to Staged Changes\?/);
  assert.match(html, /data-project-files-stage-choice="leave"/);
  assert.match(html, /data-project-files-stage-choice="stage"/);
  assert.match(html, /data-project-files-stage-remember/);
  assert.doesNotMatch(html, /data-project-files-stage-remember[^>]*checked/);
});

test("remote view renders explicit update and reviewed push boundaries", () => {
  const state = createRemotePushState();
  state.dialog = "update";
  const update = renderRemoteDialogContent(viewModel(state));
  assert.match(update, /Fast-forward only/);
  assert.match(update, /Merge incoming changes/);
  assert.match(update, /Rebase the current branch/);
  assert.match(update, /id="remote-update-remember-strategy"/);
  assert.doesNotMatch(update, /panel-eyebrow/);
  assert.doesNotMatch(update, /Requires editable conflict Diff/);

  state.rememberUpdateStrategy = true;
  const rememberedUpdate = renderRemoteDialogContent(viewModel(state));
  assert.match(rememberedUpdate, /id="remote-update-remember-strategy"[^>]*checked/);

  state.dialog = "push";
  state.pushPreviewLoading = true;
  const push = renderRemoteDialogContent(viewModel(state));
  assert.match(push, /Push Commits to main/);
  assert.match(push, /Reading outgoing commits, tags, and files/);
  assert.match(push, /Force Push with Lease/);

  const authentication = renderRemoteDialogContent({
    ...viewModel(state),
    authentication: {
      checking: false,
      saving: null,
      error: null,
      dialog: {
        repositoryRoot: "/workspace/repository",
        status: {
          remote: "origin",
          transport: "https",
          host: "github.com",
          credentialAvailable: false,
          credentialHelperConfigured: true,
          suggestedSshUrl: "git@github.com:owner/repository.git",
        },
      },
    },
  });
  assert.match(authentication, /Authenticate with github.com/);
  assert.match(authentication, /Personal access token/);
  assert.match(authentication, /git@github.com:owner\/repository.git/);
  assert.doesNotMatch(authentication, /account password[^<]*<input/iu);
  assert.doesNotMatch(authentication, /remote-https-auth-form[\s\S]*type="submit" disabled/);
  assert.match(authentication, /push-dialog[^>]*aria-hidden="true" inert/);

  state.pushPreviewLoading = false;
  state.pushPreview = pushPreview({
    headOid: "same",
    comparisonBaseOid: "same",
    commits: [],
    files: [],
    totalCommits: 0,
  });
  const emptyPush = renderRemoteDialogContent(viewModel(state));
  const emptyModeToggle = emptyPush.match(/<button[^>]*id="push-mode-toggle"[^>]*>/)?.[0] ?? "";
  assert.match(emptyModeToggle, / disabled/);

  state.pushPreview = pushPreview();
  const outgoingPush = renderRemoteDialogContent(viewModel(state));
  const outgoingModeToggle = outgoingPush.match(/<button[^>]*id="push-mode-toggle"[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(outgoingModeToggle, / disabled/);
  assert.match(outgoingPush, /class="push-mode-chevron" aria-hidden="true"/);
  assert.doesNotMatch(outgoingPush, /data-push-dialog-resize/);
});

test("push review compacts unary file directories around branching points", () => {
  const state = createRemotePushState();
  state.dialog = "push";
  state.pushPreview = pushPreview({
    files: [
      { path: "app/src/main/assets/mock.json", originalPath: null, status: "added" },
      { path: "app/src/main/java/com/example/App.kt", originalPath: null, status: "modified" },
    ],
  });

  const expanded = renderRemoteDialogContent(viewModel(state));

  assert.match(expanded, /class="push-file-list compact-file-tree"/);
  assert.match(expanded, /data-push-directory="app\/src\/main" open><summary[^>]*title="app\/src\/main"[^>]*>[^]*>app\/src\/main</);
  assert.match(expanded, />assets<\/span>/);
  assert.match(expanded, />java\/com\/example<\/span>/);
  assert.doesNotMatch(expanded, /data-push-directory="app"|data-push-directory="app\/src"/);
  assert.match(expanded, /compact-file-tree-count">2 files</);

  state.pushCollapsedFileDirectories.add("app/src/main");
  const collapsed = renderRemoteDialogContent(viewModel(state));
  assert.match(collapsed, /data-push-directory="app\/src\/main" ><summary/);
  assert.doesNotMatch(collapsed, />assets<\/span>|>java\/com\/example<\/span>/);
});

test("push review outgoing file tree uses the shared compact directory chain", () => {
  const state = createRemotePushState();
  state.dialog = "push";
  state.pushPreview = pushPreview({
    files: [
      { path: "docs/benchmarks/chain-a.md", originalPath: null, status: "modified" },
      { path: "docs/design/interaction.md", originalPath: null, status: "modified" },
      { path: "src/features/remote-push/view.ts", originalPath: null, status: "modified" },
    ],
  });
  const html = renderRemoteDialogContent(viewModel(state));
  assert.match(html, /class="push-file-list compact-file-tree"/);
  assert.match(html, /<span>src\/features\/remote-push<\/span>/);
  assert.match(html, /data-push-directory="src\/features\/remote-push"/);
  assert.doesNotMatch(html, /data-push-directory="src"[\s>]/);
  assert.match(html, /<span>docs<\/span>/);
  assert.match(html, /class="compact-file-tree-count"/);
});

test("Push Diff identifies both committed revisions", () => {
  const before = "a".repeat(40);
  const after = "b".repeat(40);
  assert.deepEqual(pushDiffSideLabels({
    pushDiff: { repositoryId: ".", oid: after, parentOid: before },
    pushPreview: null,
  }, EN_US.editor), {
    before: "Before · aaaaaaaa",
    after: "After · bbbbbbbb",
  });
});

test("flat push review files sort by file name instead of directory path", () => {
  const state = createRemotePushState();
  state.dialog = "push";
  state.pushFileView = "flat";
  state.pushPreview = pushPreview({
    files: [
      { path: "aardvark/zeta.ts", originalPath: null, status: "modified" },
      { path: "zebra/alpha.ts", originalPath: null, status: "modified" },
    ],
  });

  const html = renderRemoteDialogContent(viewModel(state));
  assert.ok(html.indexOf('data-push-file="zebra/alpha.ts"') < html.indexOf('data-push-file="aardvark/zeta.ts"'));
});

test("branch navigation keeps repository hierarchy and selection in feature-owned markup", () => {
  const snapshot = repositorySnapshot();
  snapshot.branches = branchFixtures();
  snapshot.branches[0].primaryWorktreePath = "/workspace/repo";
  snapshot.branches.push({
    ...snapshot.branches[0], fullName: "refs/heads/topic", name: "topic", current: false,
    upstream: null, tracking: null, primaryWorktreePath: null,
    linkedWorktreePath: "/worktrees/topic",
  });
  snapshot.branches.push({
    ...snapshot.branches[0], fullName: "refs/heads/available", name: "available", current: false,
    upstream: null, tracking: null, primaryWorktreePath: null, linkedWorktreePath: null,
  });
  const html = renderBranchNavigation({
    snapshot,
    query: "",
    selectedRepositoryIds: new Set(),
    selectedRefs: new Map([[".:refs%2Fheads%2Fmain", { repositoryId: ".", fullName: "refs/heads/main" }]]),
    collapsedGroups: new Set(),
    collapsedRemoteGroups: new Set(),
  });

  assert.match(html, />Local</);
  assert.match(html, />Remote</);
  assert.match(html, /remote-ref-group/);
  assert.match(html, /data-remote-group-toggle="origin" aria-expanded="true"/);
  assert.match(html, /origin/);
  assert.match(html, /branch-row[^>]*selected/);
  assert.match(html, /branch-primary-worktree-badge[^>]*>PRIMARY</);
  assert.match(html, /branch-worktree-badge[^>]*>WORKTREE</);
  assert.match(html, /branch-available-badge[^>]*>AVAILABLE</);
  assert.ok(html.includes("/workspace/repo"));
  assert.ok(html.includes("/worktrees/topic"));

  const collapsed = renderBranchNavigation({
    snapshot,
    query: "",
    selectedRepositoryIds: new Set(),
    selectedRefs: new Map(),
    collapsedGroups: new Set(),
    collapsedRemoteGroups: new Set(["origin"]),
  });
  assert.match(collapsed, /data-remote-group-toggle="origin" aria-expanded="false"/);
  assert.match(collapsed, /<div role="group" hidden>/);
});

test("branch selection is a synchronous projection of the active ref scope", () => {
  const snapshot = repositorySnapshot();
  snapshot.branches = branchFixtures();
  const main = snapshot.branches.find((branch) => branch.fullName === "refs/heads/main");
  assert.ok(main);
  const base = {
    snapshot,
    query: "",
    selectedRepositoryIds: new Set(),
    collapsedGroups: new Set(),
    collapsedRemoteGroups: new Set(),
  };

  assert.equal(branchIsSelected(main, { ...base, selectedRefs: new Map() }), false);
  assert.equal(branchIsSelected(main, {
    ...base,
    selectedRefs: new Map([[".:refs%2Fheads%2Fmain", {
      repositoryId: ".",
      fullName: "refs/heads/main",
    }]]),
  }), true);
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
    startCommit: { repositoryId: ".", oid: "a".repeat(40) },
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
  assert.match(html, /Up to aaaaaaaaaa/);
  assert.match(html, /data-history-clear-filter="branch"/);
  assert.match(html, /data-history-clear-all/);
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
    expandedTreePaths: new Set(),
  });
  const commit = commitFixture();
  const detail = renderCommitDetail({
    snapshot,
    commit,
    details: {
      repositoryId: ".",
      oid: commit.oid,
      parentOid: "1111111111111111",
      files: [
        { path: "src/main.ts", originalPath: null, status: "modified" },
        { path: "docs/refactor/rebuild/README.md", originalPath: null, status: "added" },
        { path: "docs/refactor/rebuild/notes.md", originalPath: null, status: "modified" },
      ],
      containingBranches: snapshot.branches,
    },
    loading: false,
    error: null,
    selectedFile: "src/main.ts",
    fileView: "tree",
    collapsedDirectories: new Set(),
  });
  const comparison = renderCommitComparisonDetail({
    snapshot,
    repositoryId: ".",
    beforeOid: "1".repeat(40),
    afterOid: "2".repeat(40),
    details: {
      repositoryId: ".",
      beforeOid: "1".repeat(40),
      afterOid: "2".repeat(40),
      relation: "divergent",
      files: [{ path: "pkg/deep/compare.ts", originalPath: null, status: "modified" }],
    },
    loading: false,
    error: null,
    selectedFile: null,
    fileView: "tree",
    collapsedDirectories: new Set(),
  });
  const folder = renderCommitFolderDetail({
    target: {
      workspaceRoot: "/repo", workspaceGeneration: 1, repositoryRevision: 2,
      workspacePath: "src", repositoryId: ".", oid: "2".repeat(40),
      parentOid: "1".repeat(40), path: "src", kind: "directory", file: null,
      descendants: [
        { path: "src/main.ts", originalPath: null, status: "modified" },
        { path: "src/nested/deep/new.ts", originalPath: null, status: "added" },
      ],
      historyGeneration: 3,
    },
    selectedFile: "src/main.ts",
    fileView: "tree",
    collapsedDirectories: new Set(),
  });

  assert.match(dialog, /Select Branches or Tags/);
  assert.match(dialog, /data-history-dialog-ref/);
  assert.match(detail, /src\/main\.ts|main\.ts/);
  assert.match(detail, /Compared with 1111111111/);
  assert.match(detail, /In 2 branches/);
  assert.match(detail, /HEAD → main/);
  assert.match(detail, /origin\/main/);
  assert.match(detail, /class="when-expanded">Hide<\/b>/);
  assert.match(detail, />docs\/refactor\/rebuild<\/span>/u);
  assert.doesNotMatch(detail, /data-start-git-operation="(?:cherryPick|squash)"/);
  assert.match(comparison, /Net changed files/);
  assert.match(comparison, /data-comparison-file="pkg\/deep\/compare\.ts"/);
  assert.match(comparison, />pkg\/deep<\/span>/u);
  assert.match(comparison, /Swap Before and After/);
  assert.match(comparison, /divergent histories/);
  assert.match(folder, /Folder changes/);
  assert.match(folder, /data-commit-folder-file="src\/main\.ts"/);
  assert.match(folder, />nested\/deep<\/span>/u);
  assert.match(folder, /2 changed files projected under this folder/);
});

test("flat history file lists sort by file name instead of directory path", () => {
  const snapshot = repositorySnapshot();
  const commit = commitFixture();
  const files = [
    { path: "aardvark/zeta.ts", originalPath: null, status: "modified" },
    { path: "zebra/alpha.ts", originalPath: null, status: "modified" },
  ];
  const detail = renderCommitDetail({
    snapshot,
    commit,
    details: { repositoryId: ".", oid: commit.oid, parentOid: "1".repeat(40), files },
    loading: false,
    error: null,
    selectedFile: null,
    fileView: "flat",
    collapsedDirectories: new Set(),
  });
  const comparison = renderCommitComparisonDetail({
    snapshot,
    repositoryId: ".",
    beforeOid: "1".repeat(40),
    afterOid: "2".repeat(40),
    details: {
      repositoryId: ".",
      beforeOid: "1".repeat(40),
      afterOid: "2".repeat(40),
      relation: "divergent",
      files,
    },
    loading: false,
    error: null,
    selectedFile: null,
    fileView: "flat",
    collapsedDirectories: new Set(),
  });
  const folder = renderCommitFolderDetail({
    target: {
      workspaceRoot: "/repo", workspaceGeneration: 1, repositoryRevision: 2,
      workspacePath: "src", repositoryId: ".", oid: "2".repeat(40),
      parentOid: "1".repeat(40), path: "src", kind: "directory", file: null,
      descendants: files.map((file) => ({ ...file, path: `src/${file.path}` })),
      historyGeneration: 3,
    },
    selectedFile: null,
    fileView: "flat",
    collapsedDirectories: new Set(),
  });

  assert.ok(detail.indexOf('data-commit-file="zebra/alpha.ts"') < detail.indexOf('data-commit-file="aardvark/zeta.ts"'));
  assert.ok(comparison.indexOf('data-comparison-file="zebra/alpha.ts"') < comparison.indexOf('data-comparison-file="aardvark/zeta.ts"'));
  assert.ok(folder.indexOf('data-commit-folder-file="src/zebra/alpha.ts"') < folder.indexOf('data-commit-folder-file="src/aardvark/zeta.ts"'));
  assert.match(detail, /class="commit-file-list compact-file-tree flat"/);
  assert.match(comparison, /class="commit-file-list compact-file-tree flat"/);
  assert.match(folder, /class="commit-file-list compact-file-tree flat"/);
});

test("history path dialog mounts only expanded directory levels", () => {
  const snapshot = repositorySnapshot();
  const files = [
    { repositoryId: ".", path: "src/features/deep.ts", workspacePath: "src/features/deep.ts" },
    { repositoryId: ".", path: "README.md", workspacePath: "README.md" },
  ];
  const collapsed = renderHistoryDialogView({
    kind: "paths-tree", snapshot, files, query: "", error: null,
    refDraft: new Map(), favoriteRefs: new Map(), pathDraft: new Map(), pathText: "",
    expandedTreePaths: new Set(),
  });
  assert.match(collapsed, />src</);
  assert.doesNotMatch(collapsed, />features</);
  assert.doesNotMatch(collapsed, />deep\.ts</);

  const expanded = renderHistoryDialogView({
    kind: "paths-tree", snapshot, files, query: "", error: null,
    refDraft: new Map(), favoriteRefs: new Map(), pathDraft: new Map(), pathText: "",
    expandedTreePaths: new Set([".:src"]),
  });
  assert.match(expanded, />features</);
  assert.doesNotMatch(expanded, />deep\.ts</);
});

test("history path local shortcut is formatted outside localization copy", () => {
  const html = renderHistoryDialogView({
    kind: "paths-text",
    snapshot: repositorySnapshot(),
    files: [],
    query: "",
    error: null,
    refDraft: new Map(),
    favoriteRefs: new Map(),
    pathDraft: new Map(),
    pathText: "src/app.ts",
    expandedTreePaths: new Set(),
    pathApplyShortcut: historyPathApplyShortcut("macos"),
  });

  assert.match(html, /aria-keyshortcuts="Meta\+Enter"/);
  assert.match(html, /⌘Enter applies the selection/);
  assert.doesNotMatch(html, /Ctrl\/Cmd/);
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
  assert.match(commandHtml, /id="command-surface-exclude-ignored"[^>]*checked/);
  // Files carries the same in-field query options as Text, plus the line-break insert control.
  assert.equal((commandHtml.match(/data-workspace-search-option=/g) ?? []).length, 3);
  assert.match(commandHtml, /data-search-insert="new-line"[^>]*>↵</);
  assert.match(commandHtml, /<textarea id="command-surface-input"[^>]*rows="1"/);
  const inputRow = commandHtml.slice(
    commandHtml.indexOf('class="command-surface-input"'),
    commandHtml.indexOf('class="command-surface-results"'),
  );
  assert.doesNotMatch(inputRow, /<kbd>/);
  assert.doesNotMatch(commandHtml, /Enter to search/);
  assert.match(commandHtml, /app\.ts/);
  assert.match(commandHtml, /<small>src<\/small>/);
  assert.match(commandHtml, /1 matching file/);
  assert.match(commandHtml, /id="command-surface-open-find"/);
  assert.match(commandHtml, /data-command-mode="files"[^>]*>[^]*data-command-shortcut hidden/);
  assert.match(commandHtml, /data-local-shortcut-help/);
  assert.doesNotMatch(commandHtml.match(/<button[^>]*id="command-surface-open-find"[^>]*>/)?.[0] ?? "", /disabled/);
  assert.match(replacementHtml, /Replacement preview unavailable/);
  assert.match(replacementHtml, /Preview expired/);

  const ready = createWorkspaceReplacementState();
  ready.status = "ready";
  ready.request = { operationId: "replace-1", query: "abc", replacement: "def" };
  ready.preview = { planId: "replace-1", totalMatches: 2, skippedCount: 0, files: [{
    workspacePath: "src/app.ts", matchCount: 2, byteDelta: 0,
    occurrences: [{ line: 7, beforePreview: "const abc = 1", afterPreview: "const def = 1" },
      { line: 9, beforePreview: "return abc", afterPreview: "return def" }],
  }] };
  ready.selectedPaths = new Set(["src/app.ts"]);
  const readyHtml = renderWorkspaceReplacementDialog({ dialog: "preview", replacement: ready,
    replacementText: "def", recoveryBusy: null, blockedOpenPaths: new Set() });
  assert.match(readyHtml, /id="replacement-dialog-text"[^>]*value="def"/);
  assert.match(readyHtml, /replacement-inline old[^>]*>abc</);
  assert.match(readyHtml, /replacement-inline new[^>]*>def</);
  assert.match(readyHtml, /#1 · L7/);
  assert.match(readyHtml, /#2 · L9/);
  assert.match(readyHtml, /id="replacement-open-window"/);
  assert.match(readyHtml, />Open in Replace Window</);
  assert.doesNotMatch(readyHtml, /replacement-update-preview|Update Preview/);

  const textSearchHtml = renderCommandSurface({
    commandSurface: openCommandSurface(createCommandSurfaceState(), "workspace"),
    workspaceOpen: true,
    filesLoading: false,
    files: [], commands: [], workspaceSearch: createWorkspaceSearchState(),
    workspaceSearchControls: createWorkspaceSearchControls(), searchRequestIsCurrent: false,
    replacementText: "", replacementRecoveryCount: 0,
  });
  assert.equal((textSearchHtml.match(/data-workspace-search-option=/g) ?? []).length, 3);
  assert.equal((textSearchHtml.match(/data-search-insert="new-line"/g) ?? []).length, 1);
  assert.match(textSearchHtml, /id="command-surface-open-find"[^>]*disabled/);

  const recentHtml = renderCommandSurface({
    commandSurface: openCommandSurface(createCommandSurfaceState(), "recent"),
    workspaceOpen: true, filesLoading: false,
    files: [{ repositoryId: ".", path: "src/recent.ts", workspacePath: "src/recent.ts" }],
    commands: [], workspaceSearch: createWorkspaceSearchState(),
    workspaceSearchControls: createWorkspaceSearchControls(), searchRequestIsCurrent: false,
    replacementText: "", replacementRecoveryCount: 0,
  });
  assert.match(recentHtml, /id="command-surface-open-find"/);
  assert.doesNotMatch(recentHtml.match(/<button[^>]*id="command-surface-open-find"[^>]*>/)?.[0] ?? "", /disabled/);

  const commandPaletteHtml = renderCommandSurface({
    commandSurface: openCommandSurface(createCommandSurfaceState(), "commands"),
    workspaceOpen: true,
    filesLoading: false,
    files: [], commands: [{
      id: "workspace.quickOpen.open",
      label: "Go to File",
      detail: "Open a project file",
      shortcut: "⌘P",
      ariaShortcuts: ["Meta+P"],
      enabled: true,
    }], workspaceSearch: createWorkspaceSearchState(),
    workspaceSearchControls: createWorkspaceSearchControls(), searchRequestIsCurrent: false,
    replacementText: "", replacementRecoveryCount: 0,
  });
  assert.doesNotMatch(commandPaletteHtml, /data-workspace-search-option=|data-search-insert=/);
  assert.doesNotMatch(commandPaletteHtml, /id="command-surface-open-find"/);
  assert.match(commandPaletteHtml, /aria-keyshortcuts="Meta\+P"/);
  assert.match(commandPaletteHtml, /<kbd>⌘P<\/kbd>/);
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
  const heading = contentHeading("presentation-environment.test.mjs", "scripts/presentation-environment.test.mjs");
  assert.ok(heading.indexOf("<h2>presentation-environment.test.mjs</h2>") < heading.indexOf("<small>scripts/presentation-environment.test.mjs</small>"));
});

test("conflict resolution is represented as a persistent editor preview", () => {
  const document = {
    kind: "conflict-resolution",
    repositoryRoot: "/workspace/repository",
    path: "src/shared.ts",
  };
  const session = { textTabs: [], preview: document, active: { kind: "preview" } };
  const tabs = renderEditorTabs({ session, document, statusClass: () => "file-status-conflicted" });
  const menu = renderEditorTabMenu({ session, open: true, statusClass: () => "file-status-conflicted" });

  assert.match(tabs, /shared\.ts/);
  assert.match(tabs, /Conflict/);
  assert.match(tabs, /file-status-conflicted/);
  assert.match(menu, /Conflict/);
});

test("active Diff preview renders Diff tab without exposing ephemeral backing text tab in strip or menu", () => {
  const document = {
    kind: "working-diff",
    repositoryRoot: "/workspace/repository",
    selection: { section: "unstaged", path: "src/feature.ts" },
  };
  const backingTab = textTabFixture({
    id: "file\0/workspace/repository\0.\0src/feature.ts",
    document: {
      kind: "project-file",
      repositoryRoot: "/workspace/repository",
      repositoryId: ".",
      path: "src/feature.ts",
      workspacePath: "src/feature.ts",
    },
    ephemeral: true,
  });
  const session = {
    textTabs: [backingTab],
    preview: document,
    active: { kind: "preview" },
  };
  const tabs = renderEditorTabs({
    session,
    document,
    statusClass: () => "file-status-modified",
  });
  const menu = renderEditorTabMenu({
    session,
    open: true,
    statusClass: () => "file-status-modified",
  });

  assert.doesNotMatch(tabs, /data-editor-tab=/);
  assert.doesNotMatch(tabs, /data-editor-tab-index=/);
  assert.doesNotMatch(tabs, /data-close-editor-tab-index=/);
  assert.doesNotMatch(tabs, /editor-tab active(?! preview)/);
  assert.doesNotMatch(menu, /data-editor-menu-tab-index=/);

  assert.match(tabs, /data-editor-preview/);
  assert.match(tabs, /data-close-editor-preview/);
  assert.match(tabs, /feature\.ts/);
  assert.match(tabs, /<small>Diff<\/small>/);
  assert.match(tabs, /class="editor-tab preview file-status-modified active"/);

  assert.match(menu, /data-editor-menu-preview/);
  assert.match(menu, /feature\.ts/);
  assert.match(menu, /<small>Diff preview<\/small>/);
});

test("a pinned stash Diff owns a persistent editor tab instead of duplicating the replaceable preview", () => {
  const document = {
    kind: "commit-diff",
    repositoryRoot: "/workspace/repository",
    repositoryId: ".",
    oid: "a".repeat(40),
    path: "src/stashed.ts",
  };
  const session = { textTabs: [], preview: document, active: { kind: "preview" } };
  const tabs = renderEditorTabs({ session, document, pinnedPreviews: [document], statusClass: () => "" });
  const menu = renderEditorTabMenu({ session, pinnedPreviews: [document], open: true, statusClass: () => "" });

  assert.match(tabs, /data-editor-pinned-preview-index="0"/);
  assert.match(tabs, /data-close-editor-pinned-preview-index="0"/);
  assert.doesNotMatch(tabs, /data-editor-preview/);
  assert.match(menu, /data-editor-menu-pinned-preview-index="0"/);
  assert.doesNotMatch(menu, /data-editor-menu-preview/);
});

test("editor tab strip and menu omit ephemeral text tabs while preserving original indices for visible tabs", () => {
  const tab0 = textTabFixture({
    id: "file\0/workspace/repository\0.\0src/hidden-0.ts",
    document: {
      kind: "project-file",
      repositoryRoot: "/workspace/repository",
      repositoryId: ".",
      path: "src/hidden-0.ts",
      workspacePath: "src/hidden-0.ts",
    },
    ephemeral: true,
  });
  const tab1 = textTabFixture({
    id: "file\0/workspace/repository\0.\0src/visible-1.ts",
    document: {
      kind: "project-file",
      repositoryRoot: "/workspace/repository",
      repositoryId: ".",
      path: "src/visible-1.ts",
      workspacePath: "src/visible-1.ts",
    },
    ephemeral: false,
  });
  const tab2 = textTabFixture({
    id: "file\0/workspace/repository\0.\0src/hidden-2.ts",
    document: {
      kind: "project-file",
      repositoryRoot: "/workspace/repository",
      repositoryId: ".",
      path: "src/hidden-2.ts",
      workspacePath: "src/hidden-2.ts",
    },
    ephemeral: true,
  });
  const tab3 = textTabFixture({
    id: "file\0/workspace/repository\0.\0src/visible-3.ts",
    document: {
      kind: "project-file",
      repositoryRoot: "/workspace/repository",
      repositoryId: ".",
      path: "src/visible-3.ts",
      workspacePath: "src/visible-3.ts",
    },
  });
  const session = {
    textTabs: [tab0, tab1, tab2, tab3],
    preview: null,
    active: { kind: "text", id: tab1.id },
  };
  const tabs = renderEditorTabs({
    session,
    document: tab1.document,
    statusClass: () => "file-status-modified",
  });
  const menu = renderEditorTabMenu({
    session,
    open: true,
    statusClass: () => "file-status-modified",
  });

  // Ephemeral tabs must not appear in strip or menu
  assert.doesNotMatch(tabs, /hidden-0\.ts/);
  assert.doesNotMatch(tabs, /hidden-2\.ts/);
  assert.doesNotMatch(tabs, /data-editor-tab="0"/);
  assert.doesNotMatch(tabs, /data-editor-tab="2"/);
  assert.doesNotMatch(tabs, /data-editor-tab-index="0"/);
  assert.doesNotMatch(tabs, /data-editor-tab-index="2"/);
  assert.doesNotMatch(tabs, /data-close-editor-tab-index="0"/);
  assert.doesNotMatch(tabs, /data-close-editor-tab-index="2"/);

  assert.doesNotMatch(menu, /hidden-0\.ts/);
  assert.doesNotMatch(menu, /hidden-2\.ts/);
  assert.doesNotMatch(menu, /data-editor-menu-tab-index="0"/);
  assert.doesNotMatch(menu, /data-editor-menu-tab-index="2"/);

  // Original indices must be retained for visible tabs in both strip and menu
  assert.match(tabs, /data-editor-tab="1"/);
  assert.match(tabs, /data-editor-tab-index="1"/);
  assert.match(tabs, /data-close-editor-tab-index="1"/);
  assert.match(tabs, /visible-1\.ts/);

  assert.match(tabs, /data-editor-tab="3"/);
  assert.match(tabs, /data-editor-tab-index="3"/);
  assert.match(tabs, /data-close-editor-tab-index="3"/);
  assert.match(tabs, /visible-3\.ts/);

  assert.match(menu, /data-editor-menu-tab-index="1"/);
  assert.match(menu, /visible-1\.ts/);
  assert.match(menu, /data-editor-menu-tab-index="3"/);
  assert.match(menu, /visible-3\.ts/);

  // Exactly two visible tabs are rendered
  assert.equal((tabs.match(/class="editor-tab /g) ?? []).length, 2);
  assert.equal((menu.match(/class="editor-tab-menu-item /g) ?? []).length, 2);

  // Also verify mixture when an active Diff preview is present
  const diffDocument = {
    kind: "working-diff",
    repositoryRoot: "/workspace/repository",
    selection: { section: "unstaged", path: "src/hidden-2.ts" },
  };
  const diffSession = {
    textTabs: [tab0, tab1, tab2, tab3],
    preview: diffDocument,
    active: { kind: "preview" },
  };
  const diffTabs = renderEditorTabs({
    session: diffSession,
    document: diffDocument,
    statusClass: () => "file-status-modified",
  });
  const diffMenu = renderEditorTabMenu({
    session: diffSession,
    open: true,
    statusClass: () => "file-status-modified",
  });

  assert.doesNotMatch(diffTabs, /data-editor-tab="0"/);
  assert.doesNotMatch(diffTabs, /data-editor-tab="2"/);
  assert.match(diffTabs, /data-editor-tab="1"/);
  assert.match(diffTabs, /data-editor-tab="3"/);
  assert.match(diffTabs, /data-editor-preview/);
  assert.match(diffTabs, /<span class="editor-tab-label">hidden-2\.ts<\/span><small>Diff<\/small>/);

  assert.doesNotMatch(diffMenu, /data-editor-menu-tab-index="0"/);
  assert.doesNotMatch(diffMenu, /data-editor-menu-tab-index="2"/);
  assert.match(diffMenu, /data-editor-menu-tab-index="1"/);
  assert.match(diffMenu, /data-editor-menu-tab-index="3"/);
  assert.match(diffMenu, /data-editor-menu-preview/);
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

function pushPreview(overrides = {}) {
  return {
    remote: "origin",
    branch: "main",
    sourceRef: "refs/heads/main",
    destinationRef: "refs/heads/main",
    headOid: "head",
    comparisonBaseOid: "base",
    publish: false,
    ordinaryAllowed: true,
    ordinaryBlockReason: null,
    forceWithLeaseAllowed: true,
    forceWithLeaseBlockReason: null,
    tagMode: "none",
    tags: [],
    files: [{ path: "README.md", originalPath: null, status: "modified" }],
    filesTruncated: false,
    commits: [{
      repositoryId: ".",
      oid: "head",
      shortOid: "head",
      parents: ["base"],
      authorName: "Test",
      authorEmail: "test@example.invalid",
      authoredAt: 1,
      decorations: [],
      subject: "Outgoing commit",
    }],
    offset: 0,
    totalCommits: 1,
    hasMore: false,
    truncated: false,
    previewToken: "preview",
    ...overrides,
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

function textTabFixture(overrides = {}) {
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
    ...overrides,
  };
}

function remoteToolbarRoot() {
  const selectors = [
    "#remote-toolbar",
    "#topbar-remote-select",
    "#cancel-remote-operation",
    "#remote-update",
    "#remote-update-hint",
    "#remote-push",
    "#remote-push-hint",
  ];
  const elements = new Map(selectors.map((selector) => [selector, fakeElement()]));
  return {
    elements,
    root: {
      querySelector(selector) {
        return elements.get(selector) ?? null;
      },
    },
  };
}

function fakeElement() {
  const attributes = new Map();
  const classes = new Set();
  return {
    innerHTML: "",
    disabled: false,
    title: "",
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const enabled = force ?? !classes.has(name);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    closest() { return null; },
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

function activityButtonMarkup(html, tool) {
  const markup = html.match(new RegExp(`<button class="activity-button[^>]*data-tool="${tool}"[^>]*>`))?.[0];
  assert.ok(markup, `missing ${tool} activity button`);
  return markup;
}
