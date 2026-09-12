import { bridge } from "./bridge";
import { icon } from "./icons";
import { remotePolicy } from "./remote-policy";
import {
  GitHistoryListView,
  HISTORY_ROW_LIMIT,
  type HistoryListPresentation,
} from "./features/git-history/history-list-view";
import {
  historyScope,
  renderHistoryNavigation as renderHistoryNavigationView,
  type HistoryFilterMenu,
  type HistoryNavigationViewModel,
} from "./features/git-history/history-navigation-view";
import { renderHistoryDialogView } from "./features/git-history/history-dialog-view";
import {
  inspectorPlaceholder,
  renderBranchDetail,
  renderCommitDetail,
} from "./features/git-history/git-detail-view";
import {
  GitHistoryDetailsController,
  type GitHistoryDetailsState,
  type HistoryDetailsChange,
} from "./features/git-history/history-details-controller";
import {
  HistoryFilterController,
} from "./features/git-history/history-filter-controller";
import {
  filteredBranches as filteredBranchesForView,
  logicalBranches as logicalBranchesForView,
  matchingBranches,
  renderBranchGroups as renderBranchGroupsView,
  renderBranchNavigation as renderBranchNavigationView,
  type BranchNavigationViewModel,
} from "./features/git-history/branch-navigation-view";
import {
  RemotePushController,
  type RemotePushChange,
  type RemotePushState,
} from "./features/remote-push/remote-push-controller";
import {
  pushReviewFiles,
  renderRemoteDialogContent,
  renderRemoteToolbarView,
} from "./features/remote-push/remote-push-view";
import {
  ChangesCommitController,
  type ChangesCommitChange,
  type ChangesCommitState,
} from "./features/changes-commit/changes-commit-controller";
import {
  CHANGE_TREE_ROW_HEIGHT,
  changeDisclosureKeys,
  changeTreeRenderWindow,
  changeViewRows,
  renderChangeNavigation,
} from "./features/changes-commit/changes-view";
import {
  ProjectFilesController,
  type ProjectFilesChange,
  type ProjectFilesState,
} from "./features/files-editor/project-files-controller";
import {
  commandSurfaceResultCount as commandSurfaceViewResultCount,
  renderCommandSurface as renderCommandSurfaceView,
  renderWorkspaceReplacementDialog as renderWorkspaceReplacementDialogView,
  type CommandSurfaceViewModel,
} from "./features/files-editor/workspace-navigation-view";
import {
  EditorSurface,
  type ImageSurfaceState,
} from "./features/files-editor/editor-surface";
import { LazyDiffEditor } from "./features/files-editor/lazy-editor-runtime";
import {
  contentHeading as renderContentHeading,
  emptyState as renderEditorEmptyState,
  loadingBlock as renderEditorLoadingBlock,
  renderDiffControls as renderEditorDiffControls,
  renderEditorTabMenu as renderEditorTabMenuView,
  renderEditorTabs as renderEditorTabsView,
  renderMarkdownModeControls,
  retryState as renderEditorRetryState,
} from "./features/files-editor/editor-view";
import {
  PROJECT_TREE_ROW_HEIGHT,
  projectTreeRenderWindow,
  projectTreeRows,
  renderProjectNavigation,
  renderProjectToolbar,
} from "./features/files-editor/project-files-view";
import {
  EditorSessionController,
  type EditorSessionChange,
  type EditorSessionState,
} from "./features/files-editor/editor-session-controller";
import {
  SettingsController,
  type SettingsSection,
  type SettingsState,
} from "./features/settings/settings-controller";
import {
  renderSettingsNavigation,
  renderSettingsSection,
} from "./features/settings/settings-view";
import {
  ShellController,
  type ShellState,
} from "./shell/shell-controller";
import { renderShellView } from "./shell/shell-view";
import { ActivityRailBinding } from "./shell/activity-rail-binding";
import { ShellEventBinding } from "./shell/shell-event-binding";
import { WindowChromeBinding } from "./shell/window-chrome-binding";
import { WindowSession } from "./application/window-session";
import type {
  SessionInvalidationSlice,
} from "./application/session-invalidation";
import {
  RepositoryIntegrationCoordinator,
} from "./application/repository-integration-coordinator";
import { WorkspaceOperationCoordinator } from "./application/workspace-operation-coordinator";
import { RepositoryOperationCoordinator } from "./application/repository-operation-coordinator";
import { createAppState, type AppState } from "./application/app-state";
import { WorkspaceWatchCoordinator } from "./application/workspace-watch-coordinator";
import { workspaceWatchBridge } from "./workspace-watch-bridge";
import type { DiffLayout, DiffPresentation } from "./diff-presentation";
import {
  editorDocumentKey,
  editorDocumentContentKey,
  type EditorDocument,
  type ProjectFileDocument,
  type ProjectImageDocument,
} from "./workbench/editor-document";
import {
  activeTextTab,
  dirtyTextTabs,
  isTextTabDirty,
  textTab,
  type MarkdownEditorMode,
  type TextTabState,
} from "./workbench/editor-session";
import {
  WORKBENCH_LAYOUT_DEFAULTS,
  WORKBENCH_LIMITS,
} from "./workbench/layout-state";
import { attachSplitter } from "./workbench/splitter";
import { adjacentDiffItem, type DiffDirection } from "./workbench/diff-navigation";
import {
  nextPushCommitSelection,
} from "./workbench/push-review";
import type { ActivityTool } from "./workbench/activity-order";
import { isMarkdownPath } from "./workbench/markdown-format";
import {
  loadMarkdownModePreferences,
  markdownModeForDocument,
  rememberMarkdownMode,
  saveMarkdownModePreferences,
} from "./workbench/markdown-mode-preferences";
import { revealTabInStrip } from "./workbench/tab-strip";
import { isImagePreviewPath } from "./workbench/image-preview";
import {
  DEFAULT_EDITOR_FONT_ID,
  EditorFontLoader,
  editorFontFamilyStack,
  isEditorFontId,
  type EditorFontId,
  type EditorFontLoadSource,
} from "./workbench/editor-fonts";
import {
  type AppPreferences,
} from "./workbench/preferences";
import {
  loadRecentRepositories,
  restoreRecentRepository,
  touchRecentRepository,
} from "./workbench/startup-repository";
import {
  filterHistoryText,
  historyDateSince,
  isSnapshotHistoryQuery,
  type HistoryDatePreset,
} from "./workbench/history-query";
import {
  branchKey,
  commitKey,
  historyPathKey,
  historyRefKey,
} from "./workbench/history-identity";
import {
  historyPathCandidates,
  historyPathWorkspaceLabel,
  resolveHistoryPathText,
} from "./workbench/history-path-selection";
import { toggleHistoryRootSelection } from "./workbench/history-root-selection";
import {
  findProjectTreeNode,
  type ProjectTreeNode,
} from "./workbench/project-tree";
import {
  changeGroup,
  includedChanges,
  type ChangeFileView,
  type ChangeGroupId,
} from "./workbench/change-presentation";
import {
  clampCommandSurfaceSelection,
  closeCommandSurface,
  loadRecentFiles,
  moveCommandSurfaceSelection,
  openCommandSurface,
  rankCommands,
  rankProjectFiles,
  touchRecentFile,
  updateCommandSurfaceQuery,
  type NavigationCommand,
  type NavigationMode,
} from "./workbench/navigation";
import { evaluateSearchNavigation } from "./workbench/search-navigation";
import {
  beginWorkspaceSearch,
  completeWorkspaceSearch,
  failWorkspaceSearch,
  invalidateWorkspaceSearch,
  sameWorkspaceSearchOptions,
  workspaceSearchOptions,
  type WorkspaceSearchControls,
} from "./workbench/workspace-search";
import {
  beginReplacementApply,
  beginReplacementPreview,
  closeReplacementPreview,
  completeReplacementApply,
  completeReplacementPreview,
  createWorkspaceReplacementState,
  failReplacement,
  selectAllReplacementFiles,
  setReplacementRecoveries,
  toggleReplacementFile,
} from "./workbench/workspace-replacement";
import {
  buildCommitFileTree,
  type CommitFileTreeNode,
  type CommitFileView,
} from "./workbench/git-presentation";
import type {
  BranchSummary,
  CommitDetails,
  CommitFileChange,
  CommitSummary,
  FileChange,
  HistoryPath,
  HistoryQuery,
  HistoryRef,
  ProjectFile,
  PushMode,
  PushTagMode,
  ReplacementApplyResult,
  RepositoryMutationOutcome,
  RepositorySnapshot,
  WorkspaceTextSearchMatch,
} from "./models";

const COMMIT_FILE_VIEW_KEY = "asterlyn.commitFileView.v1";
const CHANGE_FILE_VIEW_KEY = "asterlyn.changeFileView.v1";
const RECENT_FILE_KEY = "asterlyn.recentFiles.v1";
const COMPLETE_REPOSITORY_SLICES: readonly SessionInvalidationSlice[] = [
  "workspaceCatalog",
  "openDocuments",
  "workingTree",
  "head",
  "refs",
  "history",
  "operation",
];

export class AsterlynApp {
  private readonly pushDiffEditor = new LazyDiffEditor();
  private readonly editorSurface: EditorSurface;
  private readonly historyListView = new GitHistoryListView();
  private readonly editorFontLoader = new EditorFontLoader(window.localStorage);
  private markdownModePreferences = loadMarkdownModePreferences(window.localStorage);
  private imageSurface: ImageSurfaceState | null = null;
  private readonly state = createAppState(loadCommitFileView(window.localStorage));
  private readonly historyFilters = new HistoryFilterController(
    this.state,
    window.localStorage,
  );
  private editorFontRequestGeneration = 0;
  private editorFontStatus: {
    id: EditorFontId | null;
    kind: "idle" | "loading" | "ready" | "error";
    source?: EditorFontLoadSource;
    message?: string;
  } = { id: null, kind: "idle" };
  private expandedUnchangedDiffKey: string | null = null;
  private commitDiffGeneration = 0;
  private remoteDialogReturnFocus: HTMLElement | null = null;
  private lastRenderedEditorDocumentKey: string | null = null;
  private commandSurfaceReturnFocus: HTMLElement | null = null;
  private repositoryChooserOpen = false;
  private repositoryTargetPath: string | null = null;
  private readonly activityRailBinding: ActivityRailBinding;
  private readonly shellEventBinding: ShellEventBinding;
  private readonly windowChromeBinding: WindowChromeBinding;
  private splitterDisposers: Array<() => void> = [];
  private commitDetailSplitterDisposer: (() => void) | null = null;
  private changeCommitSplitterDisposer: (() => void) | null = null;
  private readonly historyController: GitHistoryDetailsController;
  private readonly releaseHistoryController: () => void;
  private readonly remoteController: RemotePushController;
  private readonly releaseRemoteController: () => void;
  private readonly changesController: ChangesCommitController;
  private readonly releaseChangesController: () => void;
  private readonly filesController: ProjectFilesController;
  private readonly releaseFilesController: () => void;
  private readonly editorController: EditorSessionController;
  private readonly releaseEditorController: () => void;
  private readonly settingsController: SettingsController;
  private readonly shellController: ShellController;
  private projectTreeScrollFrame: number | null = null;
  private projectTreeWindowStart = 0;
  private changeTreeScrollFrame: number | null = null;
  private changeTreeWindowStart = 0;
  private readonly windowSession = new WindowSession({
    openProject: (path) => bridge.openProject(path),
    readTrackedChanges: (root) => bridge.readTrackedChanges(root),
    scanUntracked: (root, scanId) => bridge.scanUntracked(root, scanId),
    cancelUntrackedScan: (scanId) => bridge.cancelUntrackedScan(scanId),
  });
  private readonly workspaceOperations = new WorkspaceOperationCoordinator(
    bridge,
    () => {
      const root = this.windowSession.workspace.state.root;
      return root ? { root, generation: this.windowSession.generation } : null;
    },
  );
  private readonly repositoryOperations = new RepositoryOperationCoordinator(this.windowSession);
  private readonly repositoryIntegration: RepositoryIntegrationCoordinator;
  private readonly workspaceWatch: WorkspaceWatchCoordinator;

  constructor(private readonly root: HTMLElement) {
    this.editorSurface = new EditorSurface(root);
    this.activityRailBinding = new ActivityRailBinding(root, {
      order: () => this.shellState.activityOrder,
      activate: (tool) => this.toggleTool(tool),
      commitOrder: (order, focusTool) => this.commitActivityOrder(order, focusTool),
    });
    this.settingsController = new SettingsController(window.localStorage);
    this.shellController = new ShellController(window.localStorage);
    this.historyController = new GitHistoryDetailsController(
      {
        readHistoryPage: (repositoryRoot, query, offset, limit) =>
          bridge.readHistoryPage(repositoryRoot, query, offset, limit),
        readCommitDetails: (repositoryRoot, repositoryId, oid) =>
          bridge.readCommitDetails(repositoryRoot, repositoryId, oid),
      },
      { rowLimit: HISTORY_ROW_LIMIT },
    );
    this.releaseHistoryController = this.historyController.subscribe((change) =>
      this.handleHistoryControllerChange(change),
    );
    this.remoteController = new RemotePushController({
      readPushPreview: (...args) => bridge.readPushPreview(...args),
      readCommitDetails: (...args) => bridge.readCommitDetails(...args),
      readPushFileCommit: (...args) => bridge.readPushFileCommit(...args),
      readCommitDiff: (...args) => bridge.readCommitDiff(...args),
      readCommitImageDiff: (...args) => bridge.readCommitImageDiff(...args),
      fetchRemote: (...args) => bridge.fetchRemote(...args),
      pullCurrent: (...args) => bridge.pullCurrent(...args),
      pushCurrent: (...args) => bridge.pushCurrent(...args),
      cancelRemoteOperation: (...args) => bridge.cancelRemoteOperation(...args),
    });
    this.releaseRemoteController = this.remoteController.subscribe((change) =>
      this.handleRemoteControllerChange(change),
    );
    this.changesController = new ChangesCommitController(
      {
        readLocalDiff: (...args) => bridge.readLocalDiff(...args),
        readLocalImageDiff: (...args) => bridge.readLocalImageDiff(...args),
        revertChanges: (...args) => bridge.revertChanges(...args),
        commitChanges: (...args) => bridge.commitChanges(...args),
      },
      loadChangeFileView(window.localStorage),
    );
    this.releaseChangesController = this.changesController.subscribe((change) =>
      this.handleChangesControllerChange(change),
    );
    this.filesController = new ProjectFilesController({
      listProjectFiles: (root) => bridge.listProjectFiles(root),
    });
    this.releaseFilesController = this.filesController.subscribe((change) =>
      this.handleProjectFilesChange(change),
    );
    this.editorController = new EditorSessionController({
      readTextFile: (...args) => bridge.readTextFile(...args),
      saveTextFile: (...args) => bridge.saveTextFile(...args),
      readImageFile: (...args) => bridge.readImageFile(...args),
    });
    this.releaseEditorController = this.editorController.subscribe((change) =>
      this.handleEditorSessionChange(change),
    );
    this.repositoryIntegration = new RepositoryIntegrationCoordinator(
      this.windowSession,
      {
        remote: this.remoteController,
        changes: this.changesController,
        files: this.filesController,
        history: this.historyController,
      },
      {
        clearBranchSelection: () => {
          this.state.selectedBranch = null;
        },
        installSnapshotHistory: (snapshot, preferTip) =>
          this.installSnapshotHistory(snapshot, preferTip),
        reconcileRefreshedHistory: (snapshot) => {
          this.reconcileHistoryScope(snapshot);
          const query = this.activeHistoryQuery();
          if (isSnapshotHistoryQuery(query)) {
            this.installSnapshotHistory(snapshot, false, true);
          } else {
            this.historyController.loadQuery(snapshot.root, query);
          }
        },
        reconcileWorkingDocument: (snapshot) => this.reconcileWorkingDocument(snapshot),
        hideHistoryTool: () => this.shellController.setLayout({
          ...this.shellState.layout,
          bottomTool: null,
        }),
        showWorkspaceOnlyTools: () => this.shellController.setLayout({
          ...this.shellState.layout,
          leftTool: "files",
          bottomTool: null,
        }),
        renderWorkspace: () => this.renderWorkspace(),
        loadVisibleCommitDetails: () => this.loadVisibleCommitDetails(),
        reloadWorkingDiff: () => {
          if (this.activeDocument().kind === "working-diff") void this.loadSelectedDiff();
        },
        loadProjectFiles: (repositoryRoot, generation) => {
          void this.loadProjectFiles(repositoryRoot, generation);
        },
        showChangesTool: () => this.shellController.setLayout({
          ...this.shellState.layout,
          leftTool: "changes",
        }, true),
        openWorkingDiff: (repositoryRoot, path) => {
          this.activateDiffPreview({
            kind: "working-diff",
            repositoryRoot,
            selection: { path, staged: false },
          });
          void this.loadSelectedDiff();
        },
        replacementRecoveryCount: () => this.state.workspaceReplacement.recoveries.length,
        setStatus: (message, kind) => this.setStatus(message, kind),
        reportError: (error) => this.showError(error),
      },
    );
    this.workspaceWatch = new WorkspaceWatchCoordinator(
      workspaceWatchBridge,
      this.windowSession,
      this.filesController,
      this.editorController,
      {
        reconcileRepository: (snapshot, slices, cause) =>
          this.repositoryIntegration.reconcileWatchedRepository(snapshot, slices, cause),
        reportWarning: (message) => this.setStatus(message, "warning"),
      },
    );
    this.shellEventBinding = new ShellEventBinding(root, {
      workspaceOpen: () => this.windowSession.workspace.state.root !== null,
      remoteDialogOpen: () => this.remoteState.dialog !== null,
      remoteOperationActive: () => this.remoteState.operation !== null,
      pushDiffOpen: () => this.remoteState.pushDiff !== null,
      repositoryMenuOpen: () => this.shellState.repositoryMenuOpen,
      editorTabMenuOpen: () => this.shellState.editorTabMenuOpen,
      settingsOpen: () => this.shellState.page === "settings",
      replacementClosable: () => Boolean(
        this.state.replacementDialog &&
        this.state.workspaceReplacement.status !== "applying" &&
        !this.state.replacementRecoveryBusy
      ),
      commandSurfaceOpen: () => this.state.commandSurface.mode !== null,
      historyFilterOpen: () => this.state.historyFilterMenu !== null,
      historyToolOpen: () => this.shellState.layout.bottomTool === "branches",
      activeReadyTextTab: () => {
        const tab = activeTextTab(this.editorState.session);
        return tab?.status === "ready" ? tab.id : null;
      },
      dirtyTextTabs: () => dirtyTextTabs(this.editorState.session).length,
      toggleRepositoryMenu: () => {
        this.shellController.toggleRepositoryMenu();
        this.renderRepositoryMenu();
      },
      selectRemote: (remote) => {
        if (this.remoteState.dialog) this.closeRemoteDialog(false);
        this.remoteController.selectRemote(remote);
      },
      remoteAction: (kind, anchor) => {
        if (kind === "fetch") void this.runRemoteOperation(kind);
        else this.openRemoteDialog(kind === "pull" ? "update" : "push", anchor);
      },
      cancelRemoteOperation: () => void this.cancelActiveRemoteOperation(),
      refresh: () => void this.refresh(),
      openSettings: () => this.openSettings(),
      closeSettings: () => this.closeSettings(),
      openCommandSurface: (mode) => this.openCommandSurface(mode),
      clearError: () => this.clearError(),
      closeRepositoryDialog: () => this.closeRepositoryDialog(),
      closeRepositoryTargetDialog: () => this.closeRepositoryTargetDialog(),
      openRepositoryTarget: (path, target) => {
        const selected = this.takeRepositoryTargetPath() ?? path;
        if (target === "current") void this.openRepository(selected);
        else void this.openRepositoryInNewWindow(selected);
      },
      requestRepositoryTarget: (path) => void this.requestRepositoryTarget(path),
      closeHistoryDialog: () => this.closeHistoryDialog(),
      dismissCommandSurface: () => this.dismissCommandSurface(),
      closeWorkspaceReplacement: () => this.closeWorkspaceReplacementDialog(),
      closeRemoteDialog: (restoreFocus = true) => this.closeRemoteDialog(restoreFocus),
      toggleEditorTabMenu: () => {
        if (this.editorState.session.textTabs.length === 0 && !this.editorState.session.preview) return;
        this.shellController.toggleEditorTabMenu();
        this.renderEditorTabMenu();
        this.bindEditorTabMenuEvents();
      },
      hideGitTool: () => this.toggleTool("branches"),
      hideLeftTool: () => {
        const tool = this.shellState.layout.leftTool;
        if (tool) this.toggleTool(tool);
      },
      applyLayout: () => this.applyWorkbenchLayout(false),
      closePushDiff: () => this.closePushDiff(),
      closeRepositoryMenu: (restoreFocus) => {
        this.shellController.closeRepositoryMenu();
        this.renderRepositoryMenu();
        if (restoreFocus) this.query<HTMLButtonElement>("#repository-switcher").focus();
      },
      closeEditorTabMenu: () => {
        this.shellController.closeEditorTabMenu();
        this.renderEditorTabMenu();
      },
      closeHistoryFilter: () => {
        this.state.historyFilterMenu = null;
        if (this.shellState.layout.bottomTool === "branches") this.renderHistoryPane();
      },
      saveTextTab: (tabId) => void this.saveTextTab(tabId),
      focusHistoryFilter: () => this.focusHistoryFilter(),
      openEditorFind: () => this.editorSurface.openFindReplace(),
      captureEditor: () => this.captureMountedTextEditor(),
      disposeFeatures: () => this.disposeFeatures(),
    });
    this.windowChromeBinding = new WindowChromeBinding(root, {
      captureEditor: () => this.captureMountedTextEditor(),
      dirtyTextTabs: () => dirtyTextTabs(this.editorState.session).length,
      confirmClose: () => this.saveDirtyTabsBefore("closing Asterlyn"),
      reportError: (error) => this.showError(error),
    });
  }

  private get historyState(): GitHistoryDetailsState {
    return this.historyController.state;
  }

  private get remoteState(): RemotePushState {
    return this.remoteController.state;
  }

  private get changesState(): ChangesCommitState {
    return this.changesController.state;
  }

  private get filesState(): ProjectFilesState {
    return this.filesController.state;
  }

  private get editorState(): EditorSessionState {
    return this.editorController.state;
  }

  private get settingsState(): SettingsState {
    return this.settingsController.state;
  }

  private get shellState(): ShellState {
    return this.shellController.state;
  }

  private handleEditorSessionChange(change: EditorSessionChange): void {
    if (
      change.reason === "load-start" ||
      change.reason === "load-complete" ||
      change.reason === "load-error" ||
      change.reason === "save-start" ||
      change.reason === "save-complete" ||
      change.reason === "save-error" ||
      change.reason === "external-change"
    ) {
      this.renderEditor();
    }
    if (change.error) this.showError(change.error);
  }

  private handleProjectFilesChange(change: ProjectFilesChange): void {
    if (
      change.reason !== "selection" &&
      change.reason !== "disclosure" &&
      this.shellState.layout.leftTool === "files"
    ) this.renderLeftTool();
    if (
      change.catalogChanged &&
      (this.state.commandSurface.mode === "files" || this.state.commandSurface.mode === "recent")
    ) {
      this.renderCommandSurface(true);
    }
    if (
      change.catalogChanged &&
      this.shellState.layout.bottomTool === "branches" &&
      this.state.historyFilterMenu === "paths"
    ) {
      this.renderHistoryPane();
    }
    if (change.error) this.showError(change.error);
  }

  private handleRemoteControllerChange(change: RemotePushChange): void {
    if (change.diffChanged && !this.remoteState.pushDiff) this.pushDiffEditor.destroy();
    if (change.preserveDialogDom) {
      this.renderPushPreviewRefreshState();
    } else if (change.dialogChanged && this.root.querySelector("#remote-action-dialog")) {
      this.renderRemoteDialog();
    }
    if (change.toolbarChanged && this.root.querySelector("#remote-toolbar")) {
      this.renderRemoteToolbar(this.windowSession.repository.state.snapshot);
    }
    if (change.reason === "file-selection") this.updatePushFileSelection();
    if (change.error && change.reason === "operation-complete") this.showError(change.error);
  }

  private handleChangesControllerChange(change: ChangesCommitChange): void {
    if (change.reason === "presentation" && this.shellState.layout.leftTool === "changes") {
      this.renderLeftTool();
    } else if (change.inclusionChanged) {
      this.syncChangeInclusionUi();
      this.refreshCommitComposer();
    }
    if (change.diffChanged && change.reason !== "selection" && this.isWorkingDiffActive()) {
      this.syncWorkingImageSurface();
      this.renderEditor();
    }
    if (change.warning) this.setStatus(change.warning, "warning");
    if (change.error) this.showError(change.error);
  }

  private handleHistoryControllerChange(change: HistoryDetailsChange): void {
    if (change.selectionChanged) this.clearCommitDiffInspection();
    if (change.reason === "file-selection") {
      const path = this.historyState.selectedFile;
      if (path) this.updateCommitFileSelection(path);
      return;
    }
    const historyMounted = Boolean(this.root.querySelector("#history-results"));
    if (change.historyChanged && historyMounted) {
      this.renderHistoryResults();
    } else if (change.selectionChanged && this.historyState.selectedCommit) {
      this.updateHistoryCommitSelection(this.historyState.selectedCommit);
    }
    if (
      (change.selectionChanged || change.detailsChanged) &&
      this.root.querySelector("#git-detail-body")
    ) {
      this.renderGitDetailPane();
    }
    if (
      change.reason === "snapshot" ||
      change.reason === "query-complete" ||
      change.reason === "refresh-complete"
    ) {
      this.loadVisibleCommitDetails();
    }
    if (change.warning) this.setStatus(change.warning, "warning");
    if (change.error) this.showError(change.error);
  }

  async start(): Promise<void> {
    this.shellController.setWindowChromeMode(await bridge.windowChromeMode());
    this.renderShell();
    this.applyAppPreferences();
    this.shellEventBinding.bind();
    this.windowChromeBinding.bind();
    this.activityRailBinding.bind();
    this.bindWorkbenchSplitters();
    this.renderActivityRail();
    this.renderRepositoryMenu();
    void this.activateConfiguredEditorFont();

    if (bridge.isDemo) {
      await this.openRepository("/workspace/asterlyn");
      return;
    }

    const initial = await bridge.initialRepository();
    if (initial) {
      await this.openRepository(initial);
      return;
    }

    await restoreRecentRepository(
      window.localStorage,
      (recent) => this.openRepository(recent, false),
      () => this.chooseRepository(),
    );
  }

  private renderShell(): void {
    this.root.innerHTML = renderShellView({
      shell: this.shellState,
      workspaceOpen: Boolean(this.windowSession.workspace.state.root),
      gitAvailable: Boolean(this.windowSession.repository.state.snapshot),
      demo: bridge.isDemo,
      windowControlsAvailable: this.windowChromeBinding.available,
    });
  }

  private commitActivityOrder(order: ActivityTool[], focusTool: ActivityTool): void {
    if (!this.shellController.setActivityOrder(order)) return;
    this.renderActivityRail();
    this.root.querySelector<HTMLButtonElement>(`[data-tool="${focusTool}"]`)?.focus();
  }

  private disposeFeatures(): void {
    if (this.projectTreeScrollFrame !== null) cancelAnimationFrame(this.projectTreeScrollFrame);
    if (this.changeTreeScrollFrame !== null) cancelAnimationFrame(this.changeTreeScrollFrame);
    this.projectTreeScrollFrame = null;
    this.changeTreeScrollFrame = null;
    this.workspaceWatch.dispose();
    this.repositoryIntegration.dispose();
    this.releaseHistoryController();
    this.historyController.dispose();
    this.releaseRemoteController();
    this.remoteController.dispose();
    this.releaseChangesController();
    this.changesController.dispose();
    this.releaseFilesController();
    this.filesController.dispose();
    this.releaseEditorController();
    this.editorController.dispose();
    this.windowSession.dispose();
    this.settingsController.dispose();
    this.shellController.dispose();
    this.windowChromeBinding.dispose();
    this.activityRailBinding.dispose();
    this.historyListView.unmount();
    this.editorSurface.destroy();
    this.pushDiffEditor.destroy();
  }

  private openSettings(): void {
    if (this.shellState.page === "settings") return;
    this.captureMountedTextEditor();
    if (this.remoteState.dialog && !this.remoteState.operation) {
      this.closeRemoteDialog(false);
    }
    if (this.state.commandSurface.mode) this.dismissCommandSurface();
    this.closeHistoryDialog();
    this.shellController.showPage("settings");
    this.query("#workspace").classList.add("settings-mode");
    this.query("#workbench").classList.add("hidden");
    this.query("#settings-page").classList.remove("hidden");
    this.query("#settings-button").setAttribute("aria-pressed", "true");
    this.renderSettingsPage();
    queueMicrotask(() => this.query<HTMLButtonElement>("#settings-back").focus());
  }

  private closeSettings(): void {
    if (this.shellState.page !== "settings") return;
    this.shellController.showPage("workbench");
    this.query("#workspace").classList.remove("settings-mode");
    this.query("#settings-page").classList.add("hidden");
    this.query("#workbench").classList.remove("hidden");
    this.query("#settings-button").setAttribute("aria-pressed", "false");
    this.applyWorkbenchLayout(false);
    window.requestAnimationFrame(() => {
      this.editorSurface.requestMeasure();
      this.query<HTMLButtonElement>("#settings-button").focus();
    });
  }

  private renderSettingsPage(): void {
    this.query("#settings-navigation").innerHTML = renderSettingsNavigation(
      this.settingsState.section,
    );
    this.query("#settings-content").innerHTML = renderSettingsSection(
      this.settingsState,
      this.editorFontStatus,
    );
    this.bindSettingsEvents();
  }

  private bindSettingsEvents(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-settings-section]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const section = button.dataset.settingsSection as SettingsSection;
          this.settingsController.selectSection(section);
          this.renderSettingsPage();
          queueMicrotask(() =>
            this.root
              .querySelector<HTMLButtonElement>(`[data-settings-section="${section}"]`)
              ?.focus(),
          );
        });
      });
    this.root
      .querySelector<HTMLSelectElement>("#setting-editor-font-family")
      ?.addEventListener("change", (event) => {
        const target = event.currentTarget as HTMLSelectElement;
        if (isEditorFontId(target.value)) {
          void this.selectEditorFont(target.value);
        }
      });
    this.root
      .querySelector<HTMLButtonElement>("#setting-editor-font-retry")
      ?.addEventListener("click", () => {
        const id = this.editorFontStatus.id;
        if (id) void this.selectEditorFont(id);
      });
    this.root.querySelectorAll<HTMLSelectElement>("[data-setting-number]").forEach((select) => {
      select.addEventListener("change", () => {
        const field = select.dataset.settingNumber as keyof Pick<
          AppPreferences,
          | "uiFontSize"
          | "editorFontSize"
          | "editorLineHeight"
          | "editorLetterSpacing"
          | "editorIndentSize"
          | "editorTabSize"
        >;
        this.updatePreferences({ [field]: Number(select.value) }, select.id);
      });
    });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-setting-diff-layout]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const layout = button.dataset.settingDiffLayout as DiffLayout;
          this.updatePreferences({ diffLayout: layout }, `setting-diff-${layout}`);
        });
      });
    this.root
      .querySelector<HTMLInputElement>("#setting-show-whitespace")
      ?.addEventListener("change", (event) => {
        const target = event.currentTarget as HTMLInputElement;
        this.updatePreferences({ showWhitespace: target.checked }, target.id);
      });
  }

  private updatePreferences(
    patch: Partial<AppPreferences>,
    restoreFocusId?: string,
  ): void {
    const previous = this.settingsState.preferences;
    try {
      if (!this.settingsController.update(patch)) return;
    } catch (error) {
      this.showError(error);
      return;
    }
    const next = this.settingsState.preferences;
    this.applyAppPreferences();
    if (
      previous.diffLayout !== next.diffLayout ||
      previous.showWhitespace !== next.showWhitespace
    ) {
      this.editorSurface.setDiffPresentation(this.diffPresentation());
      this.pushDiffEditor.setPresentation(this.diffPresentation());
      this.syncDiffControls();
      this.syncPushDiffControls();
    }
    if (this.shellState.page === "settings") {
      this.renderSettingsPage();
      if (restoreFocusId) {
        queueMicrotask(() => {
          if (restoreFocusId.startsWith("setting-diff-")) {
            const layout = restoreFocusId.slice("setting-diff-".length);
            this.root
              .querySelector<HTMLButtonElement>(`[data-setting-diff-layout="${layout}"]`)
              ?.focus();
          } else {
            this.root.querySelector<HTMLElement>(`#${restoreFocusId}`)?.focus();
          }
        });
      }
    }
  }

  private applyAppPreferences(): void {
    const requestedFont = this.settingsState.preferences.editorFontFamily;
    const effectiveFont = this.editorFontLoader.isLoaded(requestedFont)
      ? requestedFont
      : DEFAULT_EDITOR_FONT_ID;
    document.documentElement.style.setProperty(
      "--editor-font-family",
      editorFontFamilyStack(effectiveFont),
    );
    this.query(".app-shell").style.setProperty(
      "--ui-font-size",
      `${this.settingsState.preferences.uiFontSize}px`,
    );
    this.editorSurface.setPreferences(this.settingsState.preferences);
  }

  private async activateConfiguredEditorFont(): Promise<void> {
    const id = this.settingsState.preferences.editorFontFamily;
    const request = ++this.editorFontRequestGeneration;
    this.editorFontStatus = { id, kind: "loading" };
    try {
      const source = await this.editorFontLoader.load(id);
      if (request !== this.editorFontRequestGeneration) return;
      this.editorFontStatus = { id, kind: "ready", source };
      this.applyAppPreferences();
      if (this.shellState.page === "settings") this.renderSettingsPage();
    } catch (error) {
      if (request !== this.editorFontRequestGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      this.editorFontStatus = { id, kind: "error", message };
      this.applyAppPreferences();
      if (this.shellState.page === "settings") this.renderSettingsPage();
      this.showError(error);
    }
  }

  private async selectEditorFont(id: EditorFontId): Promise<void> {
    const request = ++this.editorFontRequestGeneration;
    this.editorFontStatus = { id, kind: "loading" };
    if (this.shellState.page === "settings") this.renderSettingsPage();
    try {
      const source = await this.editorFontLoader.load(id);
      if (request !== this.editorFontRequestGeneration) return;
      this.editorFontStatus = { id, kind: "ready", source };
      this.updatePreferences({ editorFontFamily: id }, "setting-editor-font-family");
    } catch (error) {
      if (request !== this.editorFontRequestGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      this.editorFontStatus = { id, kind: "error", message };
      if (this.shellState.page === "settings") {
        this.renderSettingsPage();
        queueMicrotask(() =>
          this.query<HTMLSelectElement>("#setting-editor-font-family").focus(),
        );
      }
      this.showError(error);
    }
  }

  private async openRepository(path: string, reportError = true): Promise<boolean> {
    const previousRoot = this.windowSession.workspace.state.root;
    if (
      previousRoot !== null &&
      previousRoot !== path &&
      !(await this.saveDirtyTabsBefore("switching repositories"))
    ) {
      return false;
    }
    this.cancelActiveWorkspaceSearch();
    this.cancelActiveWorkspaceReplacement();
    this.state.workspaceSearch = invalidateWorkspaceSearch(this.state.workspaceSearch);
    this.state.workspaceReplacement = createWorkspaceReplacementState();
    this.state.replacementDialog = null;
    this.state.replacementRecoveryBusy = null;
    this.state.commandSurface = closeCommandSurface(this.state.commandSurface);
    this.commandSurfaceReturnFocus = null;
    this.renderCommandSurface();
    if (this.remoteState.dialog && !this.remoteState.operation) {
      this.closeRemoteDialog(false);
    }
    const transition = this.windowSession.openProject(
      path,
      "activation",
      COMPLETE_REPOSITORY_SLICES,
    );
    const generation = this.windowSession.generation;
    void this.cancelActiveRemoteOperation();
    let pendingRoot: string | null = null;
    this.setLoading(true, "Opening project…");
    try {
      const result = await transition;
      if (!result) return false;
      const opened = result.project;
      const snapshot = opened.repository;
      const repositoryChanged = previousRoot !== null && previousRoot !== opened.root;
      touchRecentRepository(window.localStorage, opened.root);
      if (repositoryChanged) {
        this.captureMountedTextEditor();
        this.imageSurface = null;
      }
      this.windowSession.repository.consumeInvalidation();
      this.editorController.installWorkspace(opened.root);
      this.changesController.installSnapshot(snapshot, {
        clearInclusion: true,
        clearDisclosure: true,
        clearSelection: true,
      });
      this.state.historyQuery = "";
      this.state.historyRecentPaths = [];
      this.closeHistoryDialog();
      this.resetHistoryFilters();
      this.state.gitDetail = "commit";
      this.filesController.installWorkspace(opened.root, snapshot?.changes ?? []);
      this.state.selectedBranch = null;
      if (snapshot) {
        this.installSnapshotHistory(snapshot, true);
        this.loadHistoryPreferences(snapshot);
      } else {
        this.historyController.clear();
        this.shellController.setLayout({
          ...this.shellState.layout,
          leftTool: "files",
          bottomTool: null,
        });
      }
      this.remoteController.installSnapshot(snapshot);
      this.state.error = null;
      this.closeRepositoryDialog();
      this.renderWorkspace();
      if (snapshot && this.shellState.layout.bottomTool === "branches") {
        this.loadVisibleCommitDetails();
      }
      void this.loadProjectFiles(opened.root, generation);
      void this.loadReplacementRecoveries(opened.root, generation);
      pendingRoot = snapshot?.root ?? null;
    } catch (error) {
      if (generation !== this.windowSession.generation) return false;
      if (reportError) this.showError(error);
      if (!this.windowSession.workspace.state.root && bridge.isDemo) this.openRepositoryDialog(path);
      return false;
    } finally {
      if (generation === this.windowSession.generation) this.setLoading(false, "Ready");
    }
    if (pendingRoot && generation === this.windowSession.generation) {
      void this.windowSession.scanUntracked(pendingRoot, generation, true, "activation");
    }
    return this.windowSession.workspace.state.root !== null;
  }

  private async refresh(): Promise<void> {
    const workspaceRoot = this.windowSession.workspace.state.root;
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!workspaceRoot || this.state.loading) return;
    this.cancelActiveWorkspaceSearch();
    this.cancelActiveWorkspaceReplacement();
    this.state.workspaceSearch = invalidateWorkspaceSearch(this.state.workspaceSearch);
    this.state.workspaceReplacement = createWorkspaceReplacementState();
    this.state.replacementDialog = null;
    this.state.replacementRecoveryBusy = null;
    this.state.commandSurface = closeCommandSurface(this.state.commandSurface);
    this.commandSurfaceReturnFocus = null;
    this.renderCommandSurface();
    const transition = this.windowSession.openProject(
      workspaceRoot,
      "manualRefresh",
      COMPLETE_REPOSITORY_SLICES,
    );
    const generation = this.windowSession.generation;
    void this.cancelActiveRemoteOperation();
    let pendingRoot: string | null = null;
    this.clearError();
    this.setLoading(true, snapshot ? "Refreshing repository…" : "Refreshing project files…");
    try {
      const result = await transition;
      if (!result) return;
      const opened = result.project;
      const next = this.repositoryIntegration.acceptManualRefresh(
        opened.root,
        opened.repository,
        generation,
      );
      if (!next) return;
      pendingRoot = next.root;
    } catch (error) {
      if (generation !== this.windowSession.generation) return;
      this.showError(error);
    } finally {
      if (generation === this.windowSession.generation) this.setLoading(false, "Ready");
    }
    if (pendingRoot && generation === this.windowSession.generation) {
      void this.windowSession.scanUntracked(pendingRoot, generation, true, "manualRefresh");
    }
  }

  private reconcileHistoryScope(snapshot: RepositorySnapshot): void {
    const refKeys = new Set(snapshot.branches.map((branch) => branchKey(branch)));
    if (this.state.selectedBranch && !refKeys.has(this.state.selectedBranch)) {
      this.state.selectedBranch = null;
      this.state.gitDetail = "commit";
    }
    this.historyFilters.reconcile(snapshot);
    this.closeHistoryDialog();
  }

  private openCommandSurface(mode: NavigationMode): void {
    const workspaceRoot = this.windowSession.workspace.state.root;
    if (mode !== "commands" && !workspaceRoot) return;
    if (this.state.commandSurface.mode === "workspace" && mode !== "workspace") {
      this.cancelActiveWorkspaceSearch();
      this.state.workspaceSearch = invalidateWorkspaceSearch(this.state.workspaceSearch);
    }
    if (!this.state.commandSurface.mode) {
      this.commandSurfaceReturnFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const retainedQuery =
      mode === "workspace" ? (this.state.workspaceSearch.request?.query ?? "") : "";
    this.state.commandSurface = openCommandSurface(
      this.state.commandSurface,
      mode,
      retainedQuery,
    );
    this.renderCommandSurface(true);
    if (mode === "recent" && workspaceRoot && !this.filesState.loading) {
      void this.loadProjectFiles(workspaceRoot);
    }
  }

  private dismissCommandSurface(): void {
    this.cancelActiveWorkspaceSearch();
    this.state.workspaceSearch = invalidateWorkspaceSearch(this.state.workspaceSearch);
    this.state.commandSurface = closeCommandSurface(this.state.commandSurface);
    this.renderCommandSurface();
    const target = this.commandSurfaceReturnFocus;
    this.commandSurfaceReturnFocus = null;
    queueMicrotask(() => target?.focus());
  }

  private renderCommandSurface(focusInput = false): void {
    const host = this.query("#command-surface");
    const mode = this.state.commandSurface.mode;
    host.classList.toggle("hidden", mode === null);
    if (!mode) {
      host.innerHTML = "";
      return;
    }
    let model = this.commandSurfaceViewModel();
    const resultCount = commandSurfaceViewResultCount(model);
    this.state.commandSurface = clampCommandSurfaceSelection(
      this.state.commandSurface,
      resultCount,
    );
    model = this.commandSurfaceViewModel();
    const selected = this.state.commandSurface.selectedIndex;
    host.innerHTML = renderCommandSurfaceView(model);
    this.bindCommandSurfaceEvents();
    if (focusInput) this.focusCommandSurfaceInput();
    queueMicrotask(() => {
      this.root
        .querySelector<HTMLElement>(`#command-result-${selected}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  private commandSurfaceViewModel(): CommandSurfaceViewModel {
    const mode = this.state.commandSurface.mode;
    return {
      commandSurface: this.state.commandSurface,
      workspaceOpen: this.windowSession.workspace.state.root !== null,
      filesLoading: this.filesState.loading,
      files: mode === "files" || mode === "recent" ? this.visibleNavigationFiles(mode) : [],
      commands: mode === "commands" ? this.visibleNavigationCommands() : [],
      workspaceSearch: this.state.workspaceSearch,
      workspaceSearchControls: this.state.workspaceSearchControls,
      searchRequestIsCurrent: this.workspaceSearchRequestIsCurrent(),
      replacementText: this.state.replacementText,
      replacementRecoveryCount: this.state.workspaceReplacement.recoveries.length,
    };
  }

  private bindCommandSurfaceEvents(): void {
    const input = this.query<HTMLInputElement>("#command-surface-input");
    input.addEventListener("input", () => {
      if (
        this.state.commandSurface.mode === "workspace" &&
        this.state.workspaceSearch.request?.query !== input.value
      ) {
        this.cancelActiveWorkspaceSearch();
        this.state.workspaceSearch = invalidateWorkspaceSearch(this.state.workspaceSearch);
        this.invalidateWorkspaceReplacementPreview();
      }
      this.state.commandSurface = updateCommandSurfaceQuery(
        this.state.commandSurface,
        input.value,
      );
      this.renderCommandSurface(true);
    });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        this.state.commandSurface = moveCommandSurfaceSelection(
          this.state.commandSurface,
          event.key === "ArrowDown" ? 1 : -1,
          this.commandSurfaceResultCount(),
        );
        this.renderCommandSurface(true);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (this.state.commandSurface.mode === "workspace" && !this.workspaceSearchHasCurrentResults()) {
          void this.runWorkspaceSearch();
        } else {
          void this.activateCommandSurfaceSelection();
        }
      }
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-command-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.commandMode as NavigationMode;
        this.openCommandSurface(mode);
      });
    });
    this.root
      .querySelector<HTMLButtonElement>("[data-command-surface-close]")
      ?.addEventListener("click", () => this.dismissCommandSurface());
    this.root
      .querySelector<HTMLButtonElement>("#workspace-search-mode")
      ?.addEventListener("click", () => {
        const mode = this.state.workspaceSearchControls.mode === "literal" ? "regex" : "literal";
        this.updateWorkspaceSearchControls(
          { ...this.state.workspaceSearchControls, mode },
          "workspace-search-mode",
        );
      });
    for (const field of ["include", "exclude"] as const) {
      const id = `workspace-search-${field}`;
      this.root.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener("input", (event) => {
        const target = event.currentTarget as HTMLInputElement;
        this.updateWorkspaceSearchControls(
          {
            ...this.state.workspaceSearchControls,
            [field === "include" ? "includeText" : "excludeText"]: target.value,
          },
          id,
          target.selectionStart ?? target.value.length,
        );
      });
    }
    this.root
      .querySelector<HTMLSelectElement>("#workspace-search-context")
      ?.addEventListener("change", (event) => {
        const target = event.currentTarget as HTMLSelectElement;
        this.updateWorkspaceSearchControls(
          {
            ...this.state.workspaceSearchControls,
            contextLines: Number(target.value),
          },
          "workspace-search-context",
        );
      });
    this.root
      .querySelector<HTMLInputElement>("#workspace-replacement-text")
      ?.addEventListener("input", (event) => {
        const target = event.currentTarget as HTMLInputElement;
        this.state.replacementText = target.value;
        this.invalidateWorkspaceReplacementPreview();
      });
    this.root
      .querySelector<HTMLButtonElement>("#workspace-replacement-preview")
      ?.addEventListener("click", () => void this.previewWorkspaceReplacement());
    this.root
      .querySelector<HTMLButtonElement>("#workspace-recovery-open")
      ?.addEventListener("click", () => {
        this.state.replacementDialog = "recovery";
        this.renderWorkspaceReplacementDialog();
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-command-result]").forEach((button) => {
      button.addEventListener("mousemove", () => {
        const index = Number(button.dataset.commandResult);
        if (Number.isInteger(index) && this.state.commandSurface.selectedIndex !== index) {
          this.state.commandSurface = { ...this.state.commandSurface, selectedIndex: index };
          this.root.querySelectorAll(".command-result.selected").forEach((row) => row.classList.remove("selected"));
          button.classList.add("selected");
        }
      });
      button.addEventListener("click", () => {
        const index = Number(button.dataset.commandResult);
        if (!Number.isInteger(index)) return;
        this.state.commandSurface = { ...this.state.commandSurface, selectedIndex: index };
        void this.activateCommandSurfaceSelection();
      });
    });
  }

  private updateWorkspaceSearchControls(
    controls: WorkspaceSearchControls,
    focusId: string,
    caret?: number,
  ): void {
    this.cancelActiveWorkspaceSearch();
    this.invalidateWorkspaceReplacementPreview();
    this.state.workspaceSearchControls = controls;
    this.state.workspaceSearch = invalidateWorkspaceSearch(this.state.workspaceSearch);
    this.renderCommandSurface();
    queueMicrotask(() => {
      const target = this.root.querySelector<HTMLElement>(`#${focusId}`);
      target?.focus();
      if (target instanceof HTMLInputElement && caret !== undefined) {
        target.setSelectionRange(caret, caret);
      }
    });
  }

  private focusCommandSurfaceInput(): void {
    queueMicrotask(() => {
      const input = this.root.querySelector<HTMLInputElement>("#command-surface-input");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }

  private visibleNavigationFiles(mode: "files" | "recent"): ProjectFile[] {
    const workspaceRoot = this.windowSession.workspace.state.root;
    if (!workspaceRoot) return [];
    const recent = loadRecentFiles(
      window.localStorage,
      RECENT_FILE_KEY,
      workspaceRoot,
      this.filesState.files,
    );
    return mode === "recent"
      ? rankProjectFiles(recent, this.state.commandSurface.query)
      : rankProjectFiles(
          this.filesState.files,
          this.state.commandSurface.query,
          recent,
        );
  }

  private visibleNavigationCommands(): NavigationCommand[] {
    return rankCommands(this.navigationCommands(), this.state.commandSurface.query);
  }

  private commandSurfaceResultCount(): number {
    return commandSurfaceViewResultCount(this.commandSurfaceViewModel());
  }

  private workspaceSearchHasCurrentResults(): boolean {
    return (
      this.state.workspaceSearch.status === "ready" &&
      this.workspaceSearchRequestIsCurrent() &&
      this.state.workspaceSearch.report !== null
    );
  }

  private workspaceSearchRequestIsCurrent(): boolean {
    const request = this.state.workspaceSearch.request;
    return Boolean(
      request &&
      request.query === this.state.commandSurface.query &&
      sameWorkspaceSearchOptions(
        request.options,
        workspaceSearchOptions(this.state.workspaceSearchControls),
      ),
    );
  }

  private async activateCommandSurfaceSelection(): Promise<void> {
    const mode = this.state.commandSurface.mode;
    const index = this.state.commandSurface.selectedIndex;
    if (mode === "files" || mode === "recent") {
      const file = this.visibleNavigationFiles(mode)[index];
      const workspaceRoot = this.windowSession.workspace.state.root;
      if (!file || !workspaceRoot) return;
      this.dismissCommandSurface();
      await this.openProjectFile(workspaceRoot, file);
      return;
    }
    if (mode === "commands") {
      const command = this.visibleNavigationCommands()[index];
      if (command?.enabled) this.executeNavigationCommand(command.id);
      return;
    }
    if (mode === "workspace") {
      const match = this.state.workspaceSearch.report?.matches[index];
      if (match) await this.openWorkspaceSearchMatch(match);
    }
  }

  private navigationCommands(): NavigationCommand[] {
    const snapshot = this.windowSession.repository.state.snapshot;
    const hasWorkspace = this.windowSession.workspace.state.root !== null;
    const tab = activeTextTab(this.editorState.session);
    return [
      { id: "open-repository", label: "Open Project", detail: "Choose a local folder", shortcut: "Ctrl+O", enabled: true },
      { id: "go-file", label: "Go to File", detail: "Open a project file by name", shortcut: "Ctrl+P", enabled: hasWorkspace },
      { id: "recent-files", label: "Recent Files", detail: "Reopen a successful file", shortcut: "Ctrl+E", enabled: hasWorkspace },
      { id: "find-workspace", label: "Find in Files", detail: "Bounded search with reviewed replacement", shortcut: "Ctrl+Shift+F", enabled: hasWorkspace },
      { id: "find-current", label: "Find and Replace in Current File", detail: "Undoable changes stay in the active buffer", shortcut: "Ctrl+F", enabled: Boolean(tab?.status === "ready") },
      { id: "save-current", label: "Save Current File", detail: "Use the conflict-safe E1 save path", shortcut: "Ctrl+S", enabled: Boolean(tab && isTextTabDirty(tab) && !tab.saveRequest) },
      { id: "refresh", label: "Refresh Project", detail: "Reload project files and available Git state", shortcut: "Ctrl+R", enabled: Boolean(hasWorkspace && !this.state.loading) },
      { id: "toggle-files", label: "Toggle Files", detail: "Show or hide the Files tool window", enabled: hasWorkspace },
      { id: "toggle-changes", label: "Toggle Changes", detail: "Show or hide the Changes tool window", enabled: Boolean(snapshot) },
      { id: "toggle-git", label: "Toggle Git", detail: "Show or hide Branches and Log", enabled: Boolean(snapshot) },
    ];
  }

  private executeNavigationCommand(commandId: string): void {
    if (commandId === "go-file" || commandId === "recent-files" || commandId === "find-workspace") {
      this.openCommandSurface(
        commandId === "go-file" ? "files" : commandId === "recent-files" ? "recent" : "workspace",
      );
      return;
    }
    this.dismissCommandSurface();
    switch (commandId) {
      case "open-repository":
        void this.chooseRepository();
        break;
      case "find-current":
        queueMicrotask(() => this.editorSurface.openFindReplace());
        break;
      case "save-current": {
        const tab = activeTextTab(this.editorState.session);
        if (tab) void this.saveTextTab(tab.id);
        break;
      }
      case "refresh":
        void this.refresh();
        break;
      case "toggle-files":
        this.toggleTool("files");
        break;
      case "toggle-changes":
        this.toggleTool("changes");
        break;
      case "toggle-git":
        this.toggleTool("branches");
        break;
    }
  }

  private async runWorkspaceSearch(): Promise<void> {
    const workspaceRoot = this.windowSession.workspace.state.root;
    const query = this.state.commandSurface.query;
    if (!workspaceRoot || query.trim().length === 0) return;
    this.cancelActiveWorkspaceSearch();
    const options = workspaceSearchOptions(this.state.workspaceSearchControls);
    const operation = this.workspaceOperations.startSearch(
      { root: workspaceRoot, generation: this.windowSession.generation },
      query,
      options,
    );
    const started = beginWorkspaceSearch(
      this.state.workspaceSearch,
      this.windowSession.generation,
      workspaceRoot,
      operation.operationId,
      query,
      options,
    );
    this.state.workspaceSearch = started.state;
    this.renderCommandSurface(true);
    const completion = await operation.completion;
    if (completion.status === "stale") return;
    if (completion.status === "success") {
      this.state.workspaceSearch = completeWorkspaceSearch(
        this.state.workspaceSearch,
        started.request,
        completion.value,
      );
      this.renderCommandSurface(true);
    } else {
      this.state.workspaceSearch = failWorkspaceSearch(
        this.state.workspaceSearch,
        started.request,
        errorMessage(completion.error),
      );
      if (this.state.commandSurface.mode === "workspace") this.renderCommandSurface(true);
    }
  }

  private cancelActiveWorkspaceSearch(): void {
    this.workspaceOperations.cancelSearch();
  }

  private invalidateWorkspaceReplacementPreview(): void {
    if (this.state.workspaceReplacement.status === "applying") return;
    this.cancelActiveWorkspaceReplacement();
    this.state.workspaceReplacement = closeReplacementPreview(this.state.workspaceReplacement);
    if (this.state.replacementDialog === "preview") {
      this.state.replacementDialog = null;
      this.renderWorkspaceReplacementDialog();
    }
  }

  private cancelActiveWorkspaceReplacement(): void {
    const replacement = this.state.workspaceReplacement;
    if (
      (replacement.status !== "previewing" &&
        replacement.status !== "ready" &&
        replacement.status !== "applying") ||
      !replacement.request
    ) {
      return;
    }
    this.workspaceOperations.cancelReplacement();
  }

  private async previewWorkspaceReplacement(): Promise<void> {
    const workspaceRoot = this.windowSession.workspace.state.root;
    const searchRequest = this.state.workspaceSearch.request;
    const report = this.state.workspaceSearch.report;
    if (
      !workspaceRoot ||
      !searchRequest ||
      !report ||
      !this.workspaceSearchHasCurrentResults() ||
      report.matches.length === 0
    ) {
      return;
    }
    this.cancelActiveWorkspaceReplacement();
    const operation = this.workspaceOperations.startReplacementPreview(
      { root: workspaceRoot, generation: this.windowSession.generation },
      searchRequest.query,
      this.state.replacementText,
      searchRequest.options,
    );
    const started = beginReplacementPreview(
      this.state.workspaceReplacement,
      this.windowSession.generation,
      workspaceRoot,
      operation.operationId,
      searchRequest.query,
      this.state.replacementText,
      searchRequest.options,
    );
    this.state.workspaceReplacement = started.state;
    this.state.replacementDialog = "preview";
    this.renderWorkspaceReplacementDialog();
    const completion = await operation.completion;
    if (completion.status === "stale") return;
    if (completion.status === "success") {
      this.state.workspaceReplacement = completeReplacementPreview(
        this.state.workspaceReplacement,
        started.request,
        completion.value,
      );
      this.renderWorkspaceReplacementDialog();
    } else {
      this.state.workspaceReplacement = failReplacement(
        this.state.workspaceReplacement,
        started.request,
        errorMessage(completion.error),
      );
      this.renderWorkspaceReplacementDialog();
    }
  }

  private renderWorkspaceReplacementDialog(): void {
    const host = this.query("#workspace-replacement-dialog");
    const mode = this.state.replacementDialog;
    host.classList.toggle("hidden", mode === null);
    const blockedOpenPaths = new Set(
      this.editorState.session.textTabs
        .filter((tab) => isTextTabDirty(tab) || tab.saveRequest !== null)
        .map((tab) => tab.document.workspacePath),
    );
    host.innerHTML = renderWorkspaceReplacementDialogView({
      dialog: mode,
      replacement: this.state.workspaceReplacement,
      recoveryBusy: this.state.replacementRecoveryBusy,
      blockedOpenPaths,
    });
    if (mode) this.bindWorkspaceReplacementDialogEvents();
  }
  private bindWorkspaceReplacementDialogEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-replacement-close]").forEach((button) => {
      button.addEventListener("click", () => this.closeWorkspaceReplacementDialog());
    });
    this.root
      .querySelector<HTMLButtonElement>("#replacement-cancel-operation")
      ?.addEventListener("click", () => this.requestWorkspaceReplacementCancellation());
    this.root
      .querySelector<HTMLInputElement>("#replacement-select-all")
      ?.addEventListener("change", (event) => {
        this.state.workspaceReplacement = selectAllReplacementFiles(
          this.state.workspaceReplacement,
          (event.currentTarget as HTMLInputElement).checked,
        );
        this.renderWorkspaceReplacementDialog();
      });
    this.root.querySelectorAll<HTMLInputElement>("[data-replacement-file]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const path = checkbox.dataset.replacementFile;
        if (!path) return;
        this.state.workspaceReplacement = toggleReplacementFile(
          this.state.workspaceReplacement,
          path,
        );
        this.renderWorkspaceReplacementDialog();
      });
    });
    this.root
      .querySelector<HTMLButtonElement>("#replacement-apply")
      ?.addEventListener("click", () => void this.applyWorkspaceReplacement());
    this.root.querySelectorAll<HTMLButtonElement>("[data-recovery-rollback]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.recoveryRollback;
        if (id) void this.resolveWorkspaceReplacementRecovery(id, "rollback");
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-recovery-keep]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.recoveryKeep;
        if (id) void this.resolveWorkspaceReplacementRecovery(id, "keep");
      });
    });
  }

  private closeWorkspaceReplacementDialog(): void {
    this.cancelActiveWorkspaceReplacement();
    this.state.workspaceReplacement = closeReplacementPreview(this.state.workspaceReplacement);
    this.state.replacementDialog = null;
    this.renderWorkspaceReplacementDialog();
  }

  private requestWorkspaceReplacementCancellation(): void {
    if (this.state.workspaceReplacement.status === "previewing") {
      this.closeWorkspaceReplacementDialog();
      return;
    }
    if (this.state.workspaceReplacement.status !== "applying") return;
    this.cancelActiveWorkspaceReplacement();
    this.state.workspaceReplacement = {
      ...this.state.workspaceReplacement,
      error: "Cancellation requested. Restoring any files already changed…",
    };
    this.renderWorkspaceReplacementDialog();
  }

  private async applyWorkspaceReplacement(): Promise<void> {
    const workspaceRoot = this.windowSession.workspace.state.root;
    const request = this.state.workspaceReplacement.request;
    const preview = this.state.workspaceReplacement.preview;
    if (!workspaceRoot || !request || !preview || this.state.workspaceReplacement.status !== "ready") return;
    this.captureMountedTextEditor();
    const selectedPaths = [...this.state.workspaceReplacement.selectedPaths];
    const blocked = this.editorState.session.textTabs.filter(
      (tab) =>
        selectedPaths.includes(tab.document.workspacePath) &&
        (tab.status !== "ready" || isTextTabDirty(tab) || tab.saveRequest !== null),
    );
    if (blocked.length > 0) {
      this.state.workspaceReplacement = {
        ...this.state.workspaceReplacement,
        error: `Save, close, or unselect ${blocked.map((tab) => tab.document.workspacePath).join(", ")} before replacing.`,
      };
      this.setStatus("Replacement blocked by an open edited file", "warning");
      this.renderWorkspaceReplacementDialog();
      return;
    }
    this.state.workspaceReplacement = beginReplacementApply(this.state.workspaceReplacement);
    this.renderWorkspaceReplacementDialog();
    try {
      const completion = await this.workspaceOperations.applyReplacement(
        { root: workspaceRoot, generation: request.repositoryGeneration },
        preview.planId,
        selectedPaths,
      );
      if (completion.status === "stale") return;
      if (completion.status === "failure") throw completion.error;
      const result = completion.value;
      this.state.workspaceReplacement = completeReplacementApply(
        this.state.workspaceReplacement,
        request,
        result,
      );
      await this.reloadReplacementFiles(selectedPaths);
      await this.refreshWorkspaceAfterReplacement(workspaceRoot, request.repositoryGeneration);
      this.refreshWorkspaceSearchAfterReplacement();
      await this.loadReplacementRecoveries(workspaceRoot, this.windowSession.generation);
      if (result.status === "rolledBack") {
        this.state.replacementDialog = null;
        this.setStatus("Replacement stopped; every changed file was restored", "success");
      } else {
        this.state.replacementDialog = "recovery";
        this.setStatus(
          result.status === "applied"
            ? "Replacement applied; recovery retained until you keep or roll back"
            : "Replacement needs recovery review",
          result.status === "applied" ? "success" : "warning",
        );
      }
      this.renderWorkspaceReplacementDialog();
    } catch (error) {
      this.state.workspaceReplacement = failReplacement(
        this.state.workspaceReplacement,
        request,
        errorMessage(error),
      );
      await this.loadReplacementRecoveries(workspaceRoot, this.windowSession.generation);
      if (this.state.workspaceReplacement.recoveries.length > 0) {
        this.state.replacementDialog = "recovery";
      }
      this.renderWorkspaceReplacementDialog();
      this.showError(error);
    }
  }

  private async loadReplacementRecoveries(
    repositoryRoot: string,
    generation = this.windowSession.generation,
  ): Promise<void> {
    this.state.workspaceReplacement = {
      ...this.state.workspaceReplacement,
      recoveriesLoading: true,
    };
    try {
      const recoveries = await this.workspaceOperations.listRecoveries(repositoryRoot);
      if (generation !== this.windowSession.generation || this.windowSession.workspace.state.root !== repositoryRoot) return;
      this.state.workspaceReplacement = setReplacementRecoveries(
        this.state.workspaceReplacement,
        recoveries,
      );
      if (recoveries.length > 0 && !this.state.loading) {
        this.setStatus(
          `${recoveries.length} replacement recovery ${recoveries.length === 1 ? "record needs" : "records need"} review`,
          "warning",
        );
      }
      if (this.state.commandSurface.mode === "workspace") this.renderCommandSurface();
      if (this.state.replacementDialog === "recovery") this.renderWorkspaceReplacementDialog();
    } catch (error) {
      if (generation !== this.windowSession.generation) return;
      this.state.workspaceReplacement = {
        ...this.state.workspaceReplacement,
        recoveriesLoading: false,
      };
      this.setStatus("Replacement recovery could not be inspected", "warning");
      this.showError(error);
    }
  }

  private refreshWorkspaceSearchAfterReplacement(): void {
    this.cancelActiveWorkspaceSearch();
    this.state.workspaceSearch = invalidateWorkspaceSearch(this.state.workspaceSearch);
    if (
      this.state.commandSurface.mode === "workspace" &&
      this.state.commandSurface.query.trim().length > 0
    ) {
      void this.runWorkspaceSearch();
    } else {
      this.renderCommandSurface();
    }
  }

  private async resolveWorkspaceReplacementRecovery(
    recoveryId: string,
    action: "keep" | "rollback",
  ): Promise<void> {
    const workspaceRoot = this.windowSession.workspace.state.root;
    const recovery = this.state.workspaceReplacement.recoveries.find(
      (candidate) => candidate.recoveryId === recoveryId,
    );
    if (!workspaceRoot || !recovery || this.state.replacementRecoveryBusy) return;
    this.captureMountedTextEditor();
    const paths = recovery.files.map((file) => file.workspacePath);
    const blocked = this.editorState.session.textTabs.filter(
      (tab) =>
        paths.includes(tab.document.workspacePath) &&
        (tab.status !== "ready" || isTextTabDirty(tab) || tab.saveRequest !== null),
    );
    if (action === "rollback" && blocked.length > 0) {
      this.setStatus(
        `Save or close edited recovery files before rollback: ${blocked.map((tab) => tab.document.workspacePath).join(", ")}`,
        "warning",
      );
      return;
    }
    this.state.replacementRecoveryBusy = { id: recoveryId, action };
    this.renderWorkspaceReplacementDialog();
    try {
      let rollbackResult: ReplacementApplyResult | null = null;
      if (action === "keep") {
        await this.workspaceOperations.finalize(workspaceRoot, recoveryId);
      } else {
        rollbackResult = await this.workspaceOperations.rollback(workspaceRoot, recoveryId);
        await this.reloadReplacementFiles(paths);
      }
      this.state.replacementRecoveryBusy = null;
      if (action === "rollback") {
        await this.refreshWorkspaceAfterReplacement(workspaceRoot, this.windowSession.generation);
        this.refreshWorkspaceSearchAfterReplacement();
      }
      if (this.windowSession.workspace.state.root !== workspaceRoot) return;
      await this.loadReplacementRecoveries(workspaceRoot, this.windowSession.generation);
      const unresolved = this.state.workspaceReplacement.recoveries.length;
      if (unresolved > 0) {
        this.state.replacementDialog = "recovery";
        this.setStatus(
          rollbackResult?.status === "needsRecovery"
            ? "Some files changed outside Asterlyn and were preserved; recovery still needs review"
            : `${unresolved} replacement recovery ${unresolved === 1 ? "record needs" : "records need"} review`,
          "warning",
        );
      } else {
        this.state.replacementDialog = null;
        this.setStatus(
          action === "keep" ? "Replacement changes kept" : "Replacement originals restored",
          "success",
        );
      }
      this.renderWorkspaceReplacementDialog();
    } catch (error) {
      this.state.replacementRecoveryBusy = null;
      await this.loadReplacementRecoveries(workspaceRoot, this.windowSession.generation);
      this.renderWorkspaceReplacementDialog();
      this.showError(error);
    }
  }

  private async refreshWorkspaceAfterReplacement(
    repositoryRoot: string,
    generation: number,
  ): Promise<void> {
    const current = this.windowSession.repository.state.snapshot;
    if (this.windowSession.workspace.state.root !== repositoryRoot || generation !== this.windowSession.generation) return;
    this.windowSession.cancelUntrackedScan();
    const opened = await this.windowSession.refreshProject(repositoryRoot, generation);
    if (!opened) return;
    const refreshed = opened.repository;
    const next = refreshed && current
      ? { ...refreshed, commits: current.commits }
      : refreshed;
    this.repositoryIntegration.acceptWorkspaceReplacement(next);
    await this.loadProjectFiles(repositoryRoot, generation);
    if (this.windowSession.repository.state.snapshot) {
      await this.windowSession.scanUntracked(
        repositoryRoot,
        generation,
        true,
        "workspaceReplacement",
      );
    }
  }

  private async reloadReplacementFiles(workspacePaths: string[]): Promise<void> {
    await this.editorController.reloadPaths(workspacePaths);
    this.renderEditor();
  }

  private async openWorkspaceSearchMatch(match: WorkspaceTextSearchMatch): Promise<void> {
    const workspaceRoot = this.windowSession.workspace.state.root;
    if (!workspaceRoot || workspaceRoot !== this.state.workspaceSearch.request?.repositoryRoot) {
      this.setStatus("Search result belongs to another workspace", "warning");
      return;
    }
    await this.openProjectFile(workspaceRoot, match, match);
  }

  private renderRemoteToolbar(snapshot: RepositorySnapshot | null): void {
    renderRemoteToolbarView(
      this.root,
      snapshot,
      this.remoteState,
      this.state.loading,
    );
  }

  private openRemoteDialog(
    dialog: "update" | "push",
    returnFocus: HTMLElement,
  ): void {
    if (this.state.loading || !this.remoteController.openDialog(dialog)) return;
    this.remoteDialogReturnFocus = returnFocus;
    queueMicrotask(() => {
      this.root
        .querySelector<HTMLButtonElement>("#remote-dialog-close")
        ?.focus();
    });
  }

  private closeRemoteDialog(restoreFocus = true): void {
    if (!this.remoteController.closeDialog()) return;
    const target = this.remoteDialogReturnFocus;
    this.remoteDialogReturnFocus = null;
    if (restoreFocus) queueMicrotask(() => target?.focus());
  }

  private renderRemoteDialog(): void {
    const host = this.query("#remote-action-dialog");
    const dialog = this.remoteState.dialog;
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!dialog || !snapshot) {
      host.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
    const focusedId =
      document.activeElement instanceof HTMLElement && host.contains(document.activeElement)
        ? document.activeElement.id
        : null;
    host.classList.remove("hidden");
    host.innerHTML = renderRemoteDialogContent({
      snapshot,
      state: this.remoteState,
      workspaceRoot: this.windowSession.workspace.state.root,
      preferences: this.settingsState.preferences,
      selectedProjectFileAvailable: this.pushSelectedProjectFile() !== null,
    });
    this.bindRemoteDialogEvents();
    if (dialog === "push" && this.remoteState.pushDiff) {
      queueMicrotask(() => this.mountPushDiffSurface());
    }
    if (focusedId) {
      queueMicrotask(() =>
        this.root.querySelector<HTMLElement>(`#${focusedId}`)?.focus(),
      );
    }
  }

  private bindRemoteDialogEvents(): void {
    this.root.querySelector<HTMLSelectElement>("#push-remote-select")?.addEventListener("change", (event) => {
      const remote = (event.currentTarget as HTMLSelectElement).value;
      if (remote) this.remoteController.selectRemote(remote);
    });
    this.root.querySelector<HTMLButtonElement>("#push-all-commits")?.addEventListener("click", () => {
      void this.remoteController.selectPushCommit(null);
    });
    this.root.querySelector<HTMLButtonElement>("#remote-dialog-close")?.addEventListener(
      "click",
      () => this.closeRemoteDialog(),
    );
    this.root.querySelector<HTMLButtonElement>("#remote-dialog-cancel")?.addEventListener(
      "click",
      () => this.closeRemoteDialog(),
    );
    this.root
      .querySelector<HTMLButtonElement>("#remote-dialog-cancel-operation")
      ?.addEventListener("click", () => void this.cancelActiveRemoteOperation());
    this.root
      .querySelector<HTMLButtonElement>("#remote-dialog-confirm-update")
      ?.addEventListener("click", () => void this.confirmRemoteDialog("pull"));
    this.root
      .querySelector<HTMLButtonElement>("#remote-dialog-confirm-push")
      ?.addEventListener("click", () => {
        if (!this.remoteState.pushPreviewRefreshing) void this.confirmRemoteDialog("push");
      });
    this.root.querySelector<HTMLInputElement>("#push-tags-enabled")?.addEventListener("change", (event) => {
      this.remoteController.setPushTagsEnabled((event.currentTarget as HTMLInputElement).checked);
    });
    this.root.querySelector<HTMLSelectElement>("#push-tag-mode")?.addEventListener("change", (event) => {
      this.remoteController.setPushTagMode(
        (event.currentTarget as HTMLSelectElement).value as Exclude<PushTagMode, "none">,
      );
    });
    this.root.querySelector<HTMLButtonElement>("#push-mode-toggle")?.addEventListener("click", () => {
      this.remoteController.togglePushModeMenu();
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-push-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        this.remoteController.setPushMode(button.dataset.pushMode as PushMode);
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-push-commit]").forEach((button) => {
      button.addEventListener("click", () => {
        const oid = button.dataset.pushCommit;
        if (oid) {
          void this.remoteController.selectPushCommit(
            nextPushCommitSelection(this.remoteState.pushSelectedCommit, oid),
          );
        }
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-push-file]").forEach((button) => {
      button.addEventListener("click", () => {
        const path = button.dataset.pushFile;
        if (!path) return;
        this.remoteController.selectPushFile(path);
        void this.remoteController.openSelectedPushFileDiff();
      });
    });
    this.root.querySelectorAll<HTMLDetailsElement>("[data-push-directory]").forEach((details) => {
      details.addEventListener("toggle", () => {
        const path = details.dataset.pushDirectory;
        if (!path) return;
        this.remoteController.setPushDirectoryExpanded(path, details.open);
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-push-file-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.pushFileAction;
        if (action === "view") {
          this.remoteController.togglePushFileView();
        } else if (action === "expand") {
          this.remoteController.expandPushDirectories();
        } else if (action === "collapse") {
          const preview = this.remoteState.pushPreview;
          if (!preview) return;
          const files = pushReviewFiles(preview, this.remoteState);
          this.remoteController.collapsePushDirectories([
            ".",
            ...commitFileDirectoryPaths(buildCommitFileTree(files)),
          ]);
          this.renderRemoteDialog();
        } else if (action === "open") {
          void this.openSelectedPushFile();
        } else if (action === "diff") {
          void this.remoteController.openSelectedPushFileDiff();
        }
      });
    });
    this.root.querySelector<HTMLButtonElement>("#push-load-more")?.addEventListener(
      "click",
      () => void this.remoteController.loadMorePushPreview(),
    );
    this.root.querySelector<HTMLButtonElement>("#push-diff-close")?.addEventListener(
      "click",
      () => this.closePushDiff(),
    );
    this.root.querySelector<HTMLElement>("#push-diff-backdrop")?.addEventListener(
      "click",
      (event) => {
        if (event.target === event.currentTarget) this.closePushDiff();
      },
    );
    this.bindPushDiffEvents();
  }


  private renderPushFileToolbarState(): void {
    const selected = this.remoteState.pushSelectedFile !== null;
    const diff = this.root.querySelector<HTMLButtonElement>('[data-push-file-action="diff"]');
    const open = this.root.querySelector<HTMLButtonElement>('[data-push-file-action="open"]');
    if (diff) diff.disabled = !selected || this.remoteState.pushFileActionLoading;
    if (open) open.disabled = !selected || this.pushSelectedProjectFile() === null;
  }

  private renderPushPreviewRefreshState(): void {
    const confirm = this.root.querySelector<HTMLButtonElement>("#remote-dialog-confirm-push");
    if (confirm) {
      confirm.setAttribute("aria-disabled", "true");
      confirm.dataset.refreshing = "true";
    }
    const remote = this.root.querySelector<HTMLSelectElement>("#push-remote-select");
    if (remote) remote.disabled = true;
    const count = this.root.querySelector<HTMLElement>(".push-tag-count");
    if (count) {
      count.innerHTML = '<span class="spinner" aria-hidden="true"></span> Refreshing review…';
    }
  }

  private updatePushFileSelection(): void {
    const path = this.remoteState.pushSelectedFile;
    this.root.querySelectorAll<HTMLButtonElement>("[data-push-file]").forEach((row) => {
      const selected = row.dataset.pushFile === path;
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-selected", String(selected));
    });
    this.renderPushFileToolbarState();
  }

  private pushSelectedProjectFile(): ProjectFile | null {
    const path = this.remoteState.pushSelectedFile;
    return path
      ? this.filesState.files.find(
          (file) => file.repositoryId === "." && file.path === path,
        ) ?? null
      : null;
  }

  private async openSelectedPushFile(): Promise<void> {
    const workspaceRoot = this.windowSession.workspace.state.root;
    const file = this.pushSelectedProjectFile();
    if (!workspaceRoot || !file) return;
    this.closeRemoteDialog(false);
    this.shellController.setLayout({ ...this.shellState.layout, leftTool: "files" });
    this.applyWorkbenchLayout(true);
    this.renderActivityRail();
    await this.openProjectFile(workspaceRoot, file);
    if (this.windowSession.workspace.state.root === workspaceRoot) this.locateCurrentProjectFile();
  }


  private mountPushDiffSurface(): void {
    const state = this.remoteState.pushDiff;
    const host = this.root.querySelector<HTMLElement>("#push-diff-editor-host");
    if (!state?.patch || !host) return;
    this.pushDiffEditor.mount(
      host,
      state.patch.patch || "No textual diff is available for this file.",
      state.file.path,
      this.settingsState.preferences,
      this.diffPresentation(),
    );
  }

  private bindPushDiffEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-push-diff-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.pushDiffAction;
        if (action === "previous-change" || action === "next-change") {
          this.pushDiffEditor.navigateChange(action === "next-change" ? 1 : -1);
        } else if (action === "previous-file" || action === "next-file") {
          const preview = this.remoteState.pushPreview;
          const current = this.remoteState.pushDiff?.file.path;
          if (!preview || !current) return;
          const path = adjacentDiffItem(
            pushReviewFiles(preview, this.remoteState).map((file) => file.path),
            current,
            action === "next-file" ? 1 : -1,
          );
          if (!path) return;
          this.remoteController.selectPushFile(path);
          void this.remoteController.openSelectedPushFileDiff();
        } else if (action === "open-source") {
          void this.openSelectedPushFile();
        } else if (action === "toggle-unchanged") {
          void this.remoteController.togglePushDiffUnchangedLines();
        }
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-push-diff-layout]").forEach((button) => {
      button.addEventListener("click", () => {
        this.updatePreferences({ diffLayout: button.dataset.pushDiffLayout as DiffLayout });
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-push-diff-whitespace]")?.addEventListener("click", () => {
      this.updatePreferences({ showWhitespace: !this.settingsState.preferences.showWhitespace });
    });
  }


  private closePushDiff(): void {
    const path = this.remoteController.closePushDiff();
    if (path) {
      queueMicrotask(() => {
        Array.from(this.root.querySelectorAll<HTMLButtonElement>("[data-push-file]"))
          .find((button) => button.dataset.pushFile === path)
          ?.focus();
      });
    }
  }

  private async confirmRemoteDialog(kind: "pull" | "push"): Promise<void> {
    const succeeded = await this.runRemoteOperation(kind);
    if (succeeded) this.closeRemoteDialog();
  }

  private async runRemoteOperation(kind: "fetch" | "pull" | "push"): Promise<boolean> {
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!snapshot || this.state.loading || this.remoteState.operation) return false;
    const policy = remotePolicy(snapshot, this.remoteState.selectedRemote);
    if (!policy[kind].enabled || (kind !== "pull" && !policy.selectedRemote)) return false;
    if (kind === "pull" && !(await this.saveDirtyTabsBefore("pulling changes"))) {
      return false;
    }
    if (kind === "push" && !this.remoteState.pushPreview) return false;

    const generation = this.windowSession.beginTransition();
    this.clearError();
    this.setLoading(true, `${remoteActionLabel(kind)} in progress…`);
    let pendingRoot: string | null = null;
    let succeeded = false;
    let failed = false;

    try {
      const result = await this.remoteController.runOperation(kind);
      if (generation !== this.windowSession.generation || result.status === "stale") return false;
      if (result.status === "success") {
        const next = this.repositoryIntegration.acceptRemoteOutcome(result.outcome);
        if (kind === "pull") {
          this.captureMountedTextEditor();
          if (dirtyTextTabs(this.editorState.session).length === 0) {
            this.editorController.resetSession();
          }
          this.renderLeftTool();
          this.renderEditor();
        }
        pendingRoot = next.root;
        succeeded = true;
      } else if (result.status === "failure") {
        failed = true;
        this.showError(result.error);
        try {
          const opened = await this.windowSession.refreshProject(snapshot.root, generation);
          if (!opened) return false;
          const reconciled = opened.repository;
          if (!reconciled) throw new Error("The active project is no longer a Git repository.");
          this.repositoryIntegration.acceptRemoteOutcome(
            { snapshot: reconciled, invalidatedSlices: [...COMPLETE_REPOSITORY_SLICES] },
            true,
          );
          pendingRoot = reconciled.root;
        } catch {
          this.setStatus("Remote operation ended; refresh required", "warning");
        }
      }
    } finally {
      if (generation === this.windowSession.generation) {
        this.setLoading(false, "Ready");
        if (succeeded) this.setStatus(`${remoteActionLabel(kind)} completed`, "success");
        else if (failed) this.setStatus("Remote operation needs review", "warning");
      }
    }
    if (pendingRoot && generation === this.windowSession.generation) {
      void this.windowSession.scanUntracked(pendingRoot, generation, true, "remoteOperation");
    }
    return succeeded;
  }

  private async cancelActiveRemoteOperation(): Promise<void> {
    const operation = this.remoteState.operation;
    if (!operation || operation.cancelling) return;
    if (this.windowSession.repository.state.snapshot?.root === operation.root) {
      this.setStatus(`Cancelling ${operation.kind}…`, "busy");
    }
    await this.remoteController.cancelActiveOperation();
  }

  private toggleTool(tool: ActivityTool): void {
    if (!this.windowSession.workspace.state.root || (tool !== "files" && !this.windowSession.repository.state.snapshot)) return;
    this.shellController.reduceLayout(
      tool === "branches"
        ? { type: "toggle-bottom-tool", tool }
        : { type: "toggle-left-tool", tool },
    );
    this.applyWorkbenchLayout(true);
    this.renderActivityRail();
    if (tool === "branches" && this.shellState.layout.bottomTool === "branches") {
      this.renderBottomTool();
      this.loadVisibleCommitDetails();
    } else if (tool !== "branches" && this.shellState.layout.leftTool === tool) {
      this.renderLeftTool();
    }
  }

  private renderActivityRail(): void {
    const rail = this.query<HTMLElement>(".activity-rail");
    const spacer = this.query<HTMLElement>(".rail-spacer");
    for (const tool of this.shellState.activityOrder) {
      const button = rail.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`);
      if (button) rail.insertBefore(button, spacer);
    }
    this.root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
      const tool = button.dataset.tool as ActivityTool;
      const enabled = Boolean(
        this.windowSession.workspace.state.root && (tool === "files" || this.windowSession.repository.state.snapshot),
      );
      const active =
        tool === "branches"
          ? this.shellState.layout.bottomTool === "branches"
          : this.shellState.layout.leftTool === tool;
      button.classList.toggle("active", active);
      button.classList.toggle("unavailable", !enabled);
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-disabled", String(!enabled));
      button.title = enabled
        ? `${button.getAttribute("aria-label") ?? "Tool window"} — drag to reorder`
        : tool === "files"
          ? "Open a project folder first — drag to reorder"
          : "Git is unavailable for this folder — drag to reorder";
    });
  }

  private bindWorkbenchSplitters(): void {
    for (const dispose of this.splitterDisposers) dispose();
    this.splitterDisposers = [
      attachSplitter(this.query("#left-splitter"), {
        orientation: "vertical",
        getValue: () => this.shellState.layout.leftWidth,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.leftMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.leftMin,
            this.query("#workbench").clientWidth -
              WORKBENCH_LIMITS.editorMin -
              WORKBENCH_LIMITS.separatorSize,
          ),
        }),
        onChange: (value) => this.resizeWorkbench("leftWidth", value),
        onDragStateChange: (dragging) => {
          this.query("#workbench").classList.toggle(
            "resizing-left-tool",
            dragging,
          );
        },
        onCommit: () => this.persistWorkbenchLayout(),
        onReset: () =>
          this.resizeWorkbench("leftWidth", WORKBENCH_LAYOUT_DEFAULTS.leftWidth),
      }),
      attachSplitter(this.query("#bottom-splitter"), {
        orientation: "horizontal",
        direction: -1,
        getValue: () => this.shellState.layout.bottomHeight,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.bottomMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.bottomMin,
            this.query("#workbench").clientHeight -
              WORKBENCH_LIMITS.editorHeightMin -
              WORKBENCH_LIMITS.separatorSize,
          ),
        }),
        onChange: (value) => this.resizeWorkbench("bottomHeight", value),
        onCommit: () => this.persistWorkbenchLayout(),
        onReset: () =>
          this.resizeWorkbench(
            "bottomHeight",
            WORKBENCH_LAYOUT_DEFAULTS.bottomHeight,
          ),
      }),
      attachSplitter(this.query("#branch-tree-splitter"), {
        orientation: "vertical",
        getValue: () => this.shellState.layout.branchTreeWidth,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.branchTreeMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.branchTreeMin,
            this.query("#git-tool-grid").clientWidth -
              WORKBENCH_LIMITS.branchCommitMin -
              WORKBENCH_LIMITS.branchDetailsMin -
              WORKBENCH_LIMITS.separatorSize * 2,
          ),
        }),
        onChange: (value) => this.resizeWorkbench("branchTreeWidth", value),
        onDragStateChange: (dragging) => {
          this.query("#git-tool-grid").classList.toggle("resizing-columns", dragging);
        },
        onCommit: () => this.persistWorkbenchLayout(),
        onReset: () =>
          this.resizeWorkbench(
            "branchTreeWidth",
            WORKBENCH_LAYOUT_DEFAULTS.branchTreeWidth,
          ),
      }),
      attachSplitter(this.query("#branch-details-splitter"), {
        orientation: "vertical",
        direction: -1,
        getValue: () => this.shellState.layout.branchDetailsWidth,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.branchDetailsMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.branchDetailsMin,
            this.query("#git-tool-grid").clientWidth -
              this.shellState.layout.branchTreeWidth -
              WORKBENCH_LIMITS.branchCommitMin -
              WORKBENCH_LIMITS.separatorSize * 2,
          ),
        }),
        onChange: (value) => this.resizeWorkbench("branchDetailsWidth", value),
        onDragStateChange: (dragging) => {
          this.query("#git-tool-grid").classList.toggle("resizing-columns", dragging);
        },
        onCommit: () => this.persistWorkbenchLayout(),
        onReset: () =>
          this.resizeWorkbench(
            "branchDetailsWidth",
            WORKBENCH_LAYOUT_DEFAULTS.branchDetailsWidth,
          ),
      }),
    ];
  }

  private resizeWorkbench(
    dimension:
      | "leftWidth"
      | "bottomHeight"
      | "branchTreeWidth"
      | "branchDetailsWidth"
      | "commitSummaryHeight"
      | "changesCommitHeight"
      | "diffBeforePercent",
    value: number,
  ): void {
    this.shellController.reduceLayout({
      type: "resize",
      dimension,
      value,
    });
    const property = {
      leftWidth: "--left-tool-width",
      bottomHeight: "--bottom-tool-height",
      branchTreeWidth: "--branch-tree-width",
      branchDetailsWidth: "--branch-details-width",
      commitSummaryHeight: "--commit-summary-height",
      changesCommitHeight: "--changes-commit-height",
      diffBeforePercent: null,
    }[dimension];
    if (property) {
      this.query("#workbench").style.setProperty(
        property,
        `${this.shellState.layout[dimension]}px`,
      );
    }
    if (dimension === "leftWidth" || dimension === "bottomHeight") {
      this.scheduleEditorMeasure();
    }
  }

  private persistWorkbenchLayout(): void {
    this.shellController.persistLayout();
  }

  private applyWorkbenchLayout(persist: boolean): void {
    const workbench = this.query("#workbench");
    this.shellController.clampLayout(workbench.clientWidth, workbench.clientHeight);
    workbench.style.setProperty("--left-tool-width", `${this.shellState.layout.leftWidth}px`);
    workbench.style.setProperty(
      "--bottom-tool-height",
      `${this.shellState.layout.bottomHeight}px`,
    );
    workbench.style.setProperty(
      "--branch-tree-width",
      `${this.shellState.layout.branchTreeWidth}px`,
    );
    workbench.style.setProperty(
      "--branch-details-width",
      `${this.shellState.layout.branchDetailsWidth}px`,
    );
    workbench.style.setProperty(
      "--commit-summary-height",
      `${this.shellState.layout.commitSummaryHeight}px`,
    );
    workbench.style.setProperty(
      "--changes-commit-height",
      `${this.shellState.layout.changesCommitHeight}px`,
    );
    const leftOpen = this.shellState.layout.leftTool !== null;
    const bottomOpen = this.shellState.layout.bottomTool !== null;
    workbench.classList.toggle("left-tool-open", leftOpen);
    workbench.classList.toggle("bottom-tool-open", bottomOpen);
    this.query("#left-tool").toggleAttribute("hidden", !leftOpen);
    this.query("#left-splitter").toggleAttribute("hidden", !leftOpen);
    this.query("#bottom-tool").toggleAttribute("hidden", !bottomOpen);
    this.query("#bottom-splitter").toggleAttribute("hidden", !bottomOpen);
    if (persist) this.persistWorkbenchLayout();
    this.scheduleEditorMeasure();
  }

  private scheduleEditorMeasure(): void {
    this.editorSurface.requestMeasure();
  }

  private renderWorkspace(): void {
    const workspaceRoot = this.windowSession.workspace.state.root;
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!workspaceRoot) return;
    this.renderTopbar(workspaceRoot, snapshot);
    this.applyWorkbenchLayout(false);
    this.renderActivityRail();
    this.renderLeftTool();
    this.renderBottomTool();
    this.renderEditor();
    this.renderStatus(snapshot);
  }

  private renderTopbar(
    workspaceRoot: string,
    snapshot: RepositorySnapshot | null,
  ): void {
    this.renderRepositoryMenu(workspaceRoot);
    this.renderRemoteToolbar(snapshot);
  }

  private renderRepositoryMenu(currentRoot = this.windowSession.workspace.state.root): void {
    const button = this.query<HTMLButtonElement>("#repository-switcher");
    const menu = this.query("#repository-menu");
    const currentName = currentRoot ? basename(currentRoot) : "No project";
    this.query("#repository-name").textContent = currentName;
    button.title = currentRoot ?? "Open a project";
    button.setAttribute(
      "aria-label",
      currentRoot ? `Project menu for ${currentName}` : "Open project menu",
    );
    button.setAttribute("aria-expanded", String(this.shellState.repositoryMenuOpen));
    menu.classList.toggle("hidden", !this.shellState.repositoryMenuOpen);
    if (!this.shellState.repositoryMenuOpen) {
      menu.innerHTML = "";
      return;
    }

    const recent = loadRecentRepositories(window.localStorage).filter(
      (path) => path !== currentRoot,
    );
    menu.innerHTML = `
      <button class="repository-menu-action" id="choose-repository-from-menu" type="button" role="menuitem">
        ${icon("folder", 16)}<span>Open…</span>
      </button>
      <div class="repository-menu-separator" role="separator"></div>
      <div class="repository-menu-heading">Recent Projects</div>
      ${
        recent.length > 0
          ? recent
              .map(
                (path) => `<button class="repository-menu-project" type="button" role="menuitem" data-recent-repository="${escapeAttribute(path)}" title="${escapeAttribute(path)}"><span class="repository-menu-project-mark">${escapeHtml(projectMonogram(path))}</span><span class="repository-menu-project-copy"><strong>${escapeHtml(basename(path))}</strong><small>${escapeHtml(path)}</small></span></button>`,
              )
              .join("")
          : '<div class="repository-menu-empty">No other recent projects</div>'
      }`;
    this.root
      .querySelector<HTMLButtonElement>("#choose-repository-from-menu")
      ?.addEventListener("click", () => {
        this.shellController.closeRepositoryMenu();
        this.renderRepositoryMenu();
        void this.chooseRepository();
      });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-recent-repository]")
      .forEach((item) => {
        item.addEventListener("click", () => {
          const path = item.dataset.recentRepository;
          if (!path) return;
          this.shellController.closeRepositoryMenu();
          this.renderRepositoryMenu();
          void this.requestRepositoryTarget(path);
        });
      });
  }

  private renderLeftTool(): void {
    const workspaceRoot = this.windowSession.workspace.state.root;
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!workspaceRoot || !this.shellState.layout.leftTool) return;
    const title = this.query("#navigator-title");
    const count = this.query("#navigator-count");
    const actions = this.query("#navigator-actions");
    const hide = this.query<HTMLButtonElement>("#hide-left-tool");
    const body = this.query("#navigator-body");
    this.changeCommitSplitterDisposer?.();
    this.changeCommitSplitterDisposer = null;

    if (this.shellState.layout.leftTool === "changes") {
      if (!snapshot) return;
      const preserveScroll = body.dataset.navigatorView === "changes";
      const scrollTop = preserveScroll
        ? body.querySelector<HTMLElement>("#change-results")?.scrollTop ?? 0
        : 0;
      body.dataset.navigatorView = "changes";
      body.onscroll = null;
      title.textContent = "Changes";
      hide.setAttribute("aria-label", "Hide Changes tool window");
      hide.title = "Hide Changes tool window";
      count.textContent = snapshot.changes.length.toString();
      count.title = `${snapshot.changes.length} changed files`;
      actions.innerHTML = "";
      const changeRows = changeViewRows(snapshot, this.changesState);
      const changeWindow = changeTreeRenderWindow(
        changeRows.length,
        scrollTop,
        body.clientHeight,
      );
      this.changeTreeWindowStart = changeWindow?.start ?? 0;
      body.innerHTML = `<div class="changes-tool-layout"><div class="changes-tool-navigation">${renderChangeNavigation(snapshot, this.changesState, scrollTop, body.clientHeight)}</div><div class="workbench-splitter horizontal changes-commit-splitter" id="changes-commit-splitter" aria-label="Resize commit message area"></div>${this.renderCommitComposer(snapshot)}</div>`;
      this.bindChangeEvents();
      this.bindCommitComposer(snapshot);
      this.bindChangeCommitSplitter();
      if (preserveScroll) {
        const results = body.querySelector<HTMLElement>("#change-results");
        if (results) results.scrollTop = scrollTop;
      }
      const results = body.querySelector<HTMLElement>("#change-results");
      if (results) results.onscroll = () => this.handleChangeTreeScroll(results);
      return;
    }

    title.textContent = basename(workspaceRoot);
    hide.setAttribute("aria-label", "Hide Files tool window");
    hide.title = "Hide Files tool window";
    const visibleEntries = this.filesState.files.length + this.filesState.ignoredEntries.length;
    count.textContent = visibleEntries.toString();
    count.title = `${this.filesState.files.length} editable files and ${this.filesState.ignoredEntries.length} ignored entries`;
    const preserveScroll = body.dataset.navigatorView === "files";
    const scrollTop = body.scrollTop;
    const scrollLeft = body.scrollLeft;
    const tree = this.projectTree();
    body.dataset.navigatorView = "files";
    const activePath = this.activeProjectWorkspacePath(workspaceRoot);
    actions.innerHTML = renderProjectToolbar(this.filesState, tree, activePath);
    const projectRows = projectTreeRows(tree, this.filesState.expandedDirectories);
    const window = projectTreeRenderWindow(projectRows.length, scrollTop, body.clientHeight);
    this.projectTreeWindowStart = window?.start ?? 0;
    body.innerHTML = renderProjectNavigation(
      this.filesState,
      tree,
      scrollTop,
      body.clientHeight,
    );
    body.onscroll = () => this.handleProjectTreeScroll(body);
    this.bindProjectEvents();
    if (preserveScroll) {
      body.scrollTop = scrollTop;
      body.scrollLeft = scrollLeft;
    }
  }

  private renderBottomTool(): void {
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!snapshot || this.shellState.layout.bottomTool !== "branches") return;
    this.renderBranchPane(snapshot);
    this.renderHistoryPane();
    this.renderGitDetailPane(snapshot);
  }

  private renderBranchPane(snapshot: RepositorySnapshot): void {
    if (this.shellState.layout.bottomTool !== "branches") return;
    this.query("#branch-navigation-body").innerHTML =
      this.renderBranchNavigation(snapshot);
    this.renderBranchCount(snapshot);
    this.bindBranchEvents();
  }

  private renderHistoryPane(): void {
    if (!this.windowSession.repository.state.snapshot || this.shellState.layout.bottomTool !== "branches") return;
    const commits = this.filteredHistoryCommits();
    this.query("#history-navigation-body").innerHTML =
      this.renderHistoryNavigation();
    this.historyListView.mount(this.query("#history-results"), {
      selectCommit: (key, restoreFocus) => this.selectCommit(key, restoreFocus),
      expandLinearHistory: (firstKey) => {
        this.state.historyCollapseLinear = false;
        this.renderHistoryPane();
        if (firstKey) this.focusHistoryCommit(firstKey);
      },
      retryPaging: () => {
        this.historyController.retryPaging();
      },
      scroll: (host) => this.handleHistoryScroll(host),
    });
    this.renderHistoryCount(commits.length);
    this.bindHistoryEvents();
  }

  private renderGitDetailPane(snapshot = this.windowSession.repository.state.snapshot): void {
    if (!snapshot || this.shellState.layout.bottomTool !== "branches") return;
    this.commitDetailSplitterDisposer?.();
    this.commitDetailSplitterDisposer = null;
    this.query("#git-detail-body").innerHTML = this.renderGitDetail(snapshot);
    this.bindGitDetailEvents(snapshot);
  }

  private async loadProjectFiles(
    repositoryRoot: string,
    repositoryGeneration = this.windowSession.generation,
  ): Promise<void> {
    if (
      repositoryGeneration !== this.windowSession.generation ||
      this.windowSession.workspace.state.root !== repositoryRoot ||
      this.filesState.root !== repositoryRoot
    ) return;
    await this.filesController.refresh();
    if (
      repositoryGeneration === this.windowSession.generation &&
      this.windowSession.workspace.state.root === repositoryRoot
    ) this.workspaceWatch.activate();
  }

  private projectTree(): ProjectTreeNode[] {
    return this.filesController.tree();
  }

  private bindProjectEvents(): void {
    const workspaceRoot = this.windowSession.workspace.state.root;
    if (!workspaceRoot) return;
    this.root
      .querySelector<HTMLButtonElement>("#retry-project-files")
      ?.addEventListener("click", () => {
        void this.loadProjectFiles(workspaceRoot);
      });
    this.root
      .querySelector<HTMLButtonElement>("#locate-project-file")
      ?.addEventListener("click", () => this.locateCurrentProjectFile());
    this.root
      .querySelector<HTMLButtonElement>("#expand-project-folder")
      ?.addEventListener("click", () => this.setSelectedProjectFolderExpanded(true));
    this.root
      .querySelector<HTMLButtonElement>("#collapse-project-folder")
      ?.addEventListener("click", () => this.setSelectedProjectFolderExpanded(false));
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-project-directory-toggle]")
      .forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const path = button.dataset.projectDirectoryToggle;
          if (!path) return;
          const expanded = this.filesState.expandedDirectories.has(path);
          if (!this.filesController.setDirectoryExpanded(path, !expanded)) return;
          this.renderLeftTool();
          queueMicrotask(() => {
            Array.from(
              this.root.querySelectorAll<HTMLElement>("[data-project-directory]"),
            )
              .find((row) => row.dataset.projectDirectory === path)
              ?.focus();
          });
        });
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-project-directory]")
      .forEach((row) => {
        row.addEventListener("click", () => {
          const path = row.dataset.projectDirectory;
          if (!path) return;
          this.filesController.select(path, "directory");
          this.markProjectTreeSelection(path);
        });
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-project-file]").forEach((row) => {
      row.addEventListener("click", () => {
        const path = row.dataset.projectFile;
        const currentRoot = this.windowSession.workspace.state.root;
        if (!path || !currentRoot) return;
        this.filesController.select(path, "file");
        this.markProjectTreeSelection(path);
        if (row.dataset.projectStatus === "ignored") {
          this.setStatus("Ignored entries are shown for context and are not opened", "normal");
          return;
        }
        const file = this.filesState.files.find(
          (candidate) => candidate.workspacePath === path,
        ) ?? { repositoryId: ".", path, workspacePath: path };
        void this.openProjectFile(currentRoot, file);
      });
    });
  }

  private handleProjectTreeScroll(body: HTMLElement): void {
    if (this.shellState.layout.leftTool !== "files") return;
    const rows = projectTreeRows(
      this.projectTree(),
      this.filesState.expandedDirectories,
    );
    const window = projectTreeRenderWindow(rows.length, body.scrollTop, body.clientHeight);
    const nextStart = window?.start ?? 0;
    if (
      nextStart === this.projectTreeWindowStart ||
      this.projectTreeScrollFrame !== null
    ) return;
    this.projectTreeScrollFrame = requestAnimationFrame(() => {
      this.projectTreeScrollFrame = null;
      if (this.shellState.layout.leftTool !== "files") return;
      this.renderLeftTool();
    });
  }

  private markProjectTreeSelection(path: string): void {
    this.root.querySelectorAll<HTMLElement>("[data-project-node]").forEach((row) => {
      const selected = row.dataset.projectNode === path;
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-selected", String(selected));
    });
    const directorySelected = this.filesState.selection?.kind === "directory";
    this.root.querySelectorAll<HTMLButtonElement>(
      "#expand-project-folder, #collapse-project-folder",
    ).forEach((button) => {
      button.disabled = !directorySelected;
    });
  }

  private locateCurrentProjectFile(): void {
    const workspaceRoot = this.windowSession.workspace.state.root;
    if (!workspaceRoot) return;
    const activePath = this.activeProjectWorkspacePath(workspaceRoot);
    if (!activePath) return;
    if (!this.filesController.revealFile(activePath)) {
      this.setStatus("The current file is outside the bounded project tree", "warning");
      return;
    }
    const targetIndex = projectTreeRows(
      this.projectTree(),
      this.filesState.expandedDirectories,
    ).findIndex(({ node }) => node.path === activePath);
    const body = this.query<HTMLElement>("#navigator-body");
    if (targetIndex >= 0) body.scrollTop = targetIndex * PROJECT_TREE_ROW_HEIGHT;
    this.renderLeftTool();
    queueMicrotask(() => {
      const target = Array.from(
        this.root.querySelectorAll<HTMLElement>("[data-project-node]"),
      ).find((row) => row.dataset.projectNode === activePath);
      target?.scrollIntoView({ block: "center" });
      target?.focus();
    });
  }

  private activeProjectWorkspacePath(workspaceRoot: string): string | null {
    const active = this.activeDocument();
    if (active.kind === "welcome" || active.repositoryRoot !== workspaceRoot) return null;
    if (active.kind === "project-file" || active.kind === "project-image") {
      return active.workspacePath;
    }
    if (active.kind === "working-diff") return active.selection.path;
    return (
      this.filesState.files.find(
        (file) => file.repositoryId === active.repositoryId && file.path === active.path,
      )?.workspacePath ?? null
    );
  }

  private setSelectedProjectFolderExpanded(expanded: boolean): void {
    const selection = this.filesState.selection;
    if (!selection || selection.kind !== "directory" || !this.windowSession.workspace.state.root) return;
    if (!this.filesController.setSelectedSubtreeExpanded(expanded)) return;
    this.renderLeftTool();
    queueMicrotask(() => {
      const target = Array.from(
        this.root.querySelectorAll<HTMLElement>("[data-project-directory]"),
      ).find((row) => row.dataset.projectDirectory === selection.path);
      target?.scrollIntoView({ block: "nearest" });
      target?.focus();
    });
  }

  private async openProjectFile(
    repositoryRoot: string,
    file: ProjectFile,
    searchMatch?: WorkspaceTextSearchMatch,
  ): Promise<void> {
    if (!searchMatch && isImagePreviewPath(file.path)) {
      await this.openProjectImage(repositoryRoot, file);
      return;
    }
    this.captureMountedTextEditor();
    const document: ProjectFileDocument = {
      kind: "project-file",
      repositoryRoot,
      repositoryId: file.repositoryId,
      path: file.path,
      workspacePath: file.workspacePath,
    };
    const documentKey = editorDocumentKey(document);
    const existing = textTab(this.editorState.session, documentKey);
    if (searchMatch && existing && (isTextTabDirty(existing) || existing.saveRequest)) {
      this.setStatus(
        "Search location was not applied because this file has unsaved edits",
        "warning",
      );
      return;
    }
    if (searchMatch && existing?.status === "loading") {
      this.setStatus("Wait for the current file load, then run the search again", "warning");
      return;
    }
    const markdownMode = isMarkdownPath(document.path)
      ? markdownModeForDocument(this.markdownModePreferences, documentKey)
      : "source";
    const opened = await this.editorController.openText(
      repositoryRoot,
      file,
      markdownMode,
      Boolean(searchMatch && existing?.status === "ready"),
    );
    if (opened.status === "limit") {
      const currentRoot = this.windowSession.workspace.state.root;
      const activePath = currentRoot
        ? this.activeProjectWorkspacePath(currentRoot)
        : null;
      if (activePath) {
        this.filesController.select(activePath, "file");
        this.markProjectTreeSelection(activePath);
      }
      this.setStatus(
        "All 20 open files contain unsaved changes; save or close one before opening another",
        "warning",
      );
      return;
    }
    if (opened.status === "stale") {
      if (searchMatch && this.windowSession.workspace.state.root === repositoryRoot) {
        this.setStatus("Search location could not be refreshed safely", "warning");
      }
      return;
    }
    if (opened.status === "failure") return;
    this.rememberRecentFile(repositoryRoot, file);
    if (searchMatch) this.applySearchNavigation(opened.tab, searchMatch);
  }

  private async openProjectImage(
    repositoryRoot: string,
    file: ProjectFile,
  ): Promise<void> {
    this.captureMountedTextEditor();
    const document: ProjectImageDocument = {
      kind: "project-image",
      repositoryRoot,
      repositoryId: file.repositoryId,
      path: file.path,
      workspacePath: file.workspacePath,
    };
    const key = editorDocumentKey(document);
    this.editorController.activatePreview(document);
    if (this.imageSurface?.key === key && this.imageSurface.status === "ready") {
      this.renderLeftTool();
      this.renderEditor();
      return;
    }
    const request = this.editorController.beginImageLoad(document);
    this.imageSurface = {
      key,
      version: request.version,
      status: "loading",
      error: null,
      image: null,
      diff: null,
    };
    this.renderLeftTool();
    this.renderEditor();
    const result = await request.completion;
    if (
      result.status === "stale" ||
      editorDocumentKey(this.activeDocument()) !== key
    ) return;
    if (result.status === "ready") {
      this.imageSurface = {
        key,
        version: request.version,
        status: "ready",
        error: null,
        image: result.image,
        diff: null,
      };
      this.rememberRecentFile(repositoryRoot, file);
      this.renderEditor();
    } else {
      this.imageSurface = {
        key,
        version: request.version,
        status: "error",
        error: errorMessage(result.error),
        image: null,
        diff: null,
      };
      this.renderEditor();
      this.showError(result.error);
    }
  }

  private rememberRecentFile(repositoryRoot: string, file: ProjectFile): void {
    touchRecentFile(
      window.localStorage,
      RECENT_FILE_KEY,
      repositoryRoot,
      file,
    );
  }

  private applySearchNavigation(
    tab: TextTabState,
    match: WorkspaceTextSearchMatch,
  ): void {
    const decision = evaluateSearchNavigation(
      this.windowSession.workspace.state.root,
      tab,
      match,
    );
    if (decision !== "ready") {
      const message =
        decision === "wrongWorkspace"
          ? "Search result belongs to another workspace"
          : decision === "dirty"
            ? "Search location was not applied because this file has unsaved edits"
            : decision === "invalidRange"
              ? "Search location is no longer valid; run the search again"
              : "Search result is stale; run the search again";
      this.setStatus(message, "warning");
      return;
    }
    this.dismissCommandSurface();
    this.renderEditor();
    queueMicrotask(() => {
      if (!this.editorSurface.selectRange(match.fromUtf16, match.toUtf16)) {
        this.setStatus("Search location is no longer valid; run the search again", "warning");
      }
    });
  }

  private renderHistoryNavigation(): string {
    return renderHistoryNavigationView(this.historyNavigationViewModel());
  }

  private historyNavigationViewModel(): HistoryNavigationViewModel {
    const snapshot = this.windowSession.repository.state.snapshot!;
    return {
      snapshot,
      files: this.filesState.files,
      filesLoading: this.filesState.loading,
      filesError: this.filesState.error,
      filesTruncated: this.filesState.truncated,
      presentation: this.historyListPresentation(),
      query: this.state.historyQuery,
      caseSensitive: this.state.historyCaseSensitive,
      regularExpression: this.state.historyRegularExpression,
      refs: this.state.historyRefs,
      authorEmails: this.state.historyAuthorEmails,
      currentAuthor: this.state.historyCurrentAuthor,
      datePreset: this.state.historyDatePreset,
      paths: this.state.historyPaths,
      repositoryIds: this.state.historyRepositoryIds,
      recentPaths: this.state.historyRecentPaths,
      order: this.state.historyOrder,
      firstParent: this.state.historyFirstParent,
      excludeMerges: this.state.historyExcludeMerges,
      collapseLinear: this.state.historyCollapseLinear,
      filterMenu: this.state.historyFilterMenu,
      branchSubmenu: this.state.historyBranchSubmenu,
      favoriteRefs: this.state.historyFavoriteRefs,
      recentRefs: this.state.historyRecentRefs,
    };
  }

  private allMatchingHistoryBranches(
    branch: BranchSummary,
    snapshot: RepositorySnapshot,
  ): BranchSummary[] {
    return matchingBranches(branch, this.branchNavigationViewModel(snapshot), true);
  }

  private setLogicalBranchScope(
    branch: BranchSummary,
    snapshot: RepositorySnapshot,
  ): void {
    const branches = this.allMatchingHistoryBranches(branch, snapshot);
    const references = branches.map(historyReference);
    this.state.historyRefs = new Map(
      references.map((reference) => [historyRefKey(reference), reference]),
    );
    this.state.selectedBranch = branches.length === 1 ? branchKey(branches[0]!) : null;
    this.state.gitDetail = branches.length === 1 ? "branch" : "commit";
    for (const reference of references) this.recordRecentHistoryRef(reference);
  }

  private openHistoryDialog(kind: NonNullable<AppState["historyDialog"]>): void {
    this.state.historyDialog = kind;
    this.state.historyDialogQuery = "";
    this.state.historyDialogError = null;
    this.state.historyFilterMenu = null;
    this.state.historyBranchSubmenu = null;
    if (kind === "branches") {
      this.state.historyRefDraft = new Map(this.state.historyRefs);
    } else {
      this.state.historyPathDraft = new Map(this.state.historyPaths);
      this.state.historyPathText = Array.from(this.state.historyPaths.values())
        .map((path) => historyPathWorkspaceLabel(path, this.filesState.files))
        .join("\n");
    }
    this.renderHistoryPane();
    this.renderHistoryDialog();
  }

  private closeHistoryDialog(): void {
    if (!this.state.historyDialog) return;
    this.state.historyDialog = null;
    this.state.historyDialogError = null;
    const host = this.query("#history-dialog");
    host.classList.add("hidden");
    host.innerHTML = "";
  }

  private renderHistoryDialog(): void {
    const host = this.query("#history-dialog");
    const kind = this.state.historyDialog;
    if (!kind) {
      host.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
    host.classList.remove("hidden");
    host.innerHTML = renderHistoryDialogView({
      kind,
      snapshot: this.windowSession.repository.state.snapshot!,
      files: this.filesState.files,
      query: this.state.historyDialogQuery,
      error: this.state.historyDialogError,
      refDraft: this.state.historyRefDraft,
      favoriteRefs: this.state.historyFavoriteRefs,
      pathDraft: this.state.historyPathDraft,
      pathText: this.state.historyPathText,
      collapsedTreePaths: this.state.historyTreeCollapsed,
    });
    this.bindHistoryDialogEvents();
  }

  private historyListPresentation(): HistoryListPresentation {
    const snapshot = this.windowSession.repository.state.snapshot!;
    const filtered = this.filteredHistory();
    return {
      status: this.historyState.history.status,
      error: this.historyState.history.error,
      loadedCommits: this.historyState.history.commits,
      commits: filtered.commits,
      textError: filtered.error,
      selectedCommit: this.historyState.selectedCommit,
      collapseLinear: this.state.historyCollapseLinear,
      bridgeOmittedParents: this.shouldBridgeOmittedGraphParents(filtered.commits),
      repositoryRoots: snapshot.repositoryRoots,
      branches: snapshot.branches,
      loadingMore: this.historyState.loadingMore,
      pagingError: this.historyState.pagingError,
      hasMore: this.historyState.hasMore,
    };
  }

  private shouldBridgeOmittedGraphParents(commits: CommitSummary[]): boolean {
    const source = this.historyState.history.source;
    const query = source?.kind === "query" ? source.query : null;
    const omitsIntermediateCommits =
      commits.length < this.historyState.history.commits.length ||
      Boolean(
        query &&
          (query.authorEmails.length > 0 ||
            query.currentAuthor ||
            query.paths.length > 0 ||
            query.excludeMerges),
      );
    if (!query || !omitsIntermediateCommits || query.refs.length === 0) return false;
    const refsByRoot = new Map<string, number>();
    for (const reference of query.refs) {
      refsByRoot.set(reference.repositoryId, (refsByRoot.get(reference.repositoryId) ?? 0) + 1);
    }
    return Array.from(new Set(commits.map((commit) => commit.repositoryId))).every(
      (repositoryId) => refsByRoot.get(repositoryId) === 1,
    );
  }

  private filteredHistory(): ReturnType<typeof filterHistoryText> {
    return filterHistoryText(this.historyState.history.commits, this.state.historyQuery, {
      caseSensitive: this.state.historyCaseSensitive,
      regularExpression: this.state.historyRegularExpression,
    });
  }

  private filteredHistoryCommits(): CommitSummary[] {
    return this.filteredHistory().commits;
  }

  private renderBranchNavigation(snapshot: RepositorySnapshot): string {
    return renderBranchNavigationView(this.branchNavigationViewModel(snapshot));
  }

  private renderBranchGroups(snapshot: RepositorySnapshot): string {
    return renderBranchGroupsView(this.branchNavigationViewModel(snapshot));
  }

  private logicalBranches(snapshot: RepositorySnapshot): BranchSummary[] {
    return logicalBranchesForView(this.branchNavigationViewModel(snapshot));
  }

  private filteredBranches(snapshot: RepositorySnapshot): BranchSummary[] {
    return filteredBranchesForView(this.branchNavigationViewModel(snapshot));
  }

  private branchNavigationViewModel(snapshot: RepositorySnapshot): BranchNavigationViewModel {
    return {
      snapshot,
      query: this.state.branchQuery,
      selectedRepositoryIds: this.state.historyRepositoryIds,
      selectedRefs: this.state.historyRefs,
      collapsedGroups: this.state.collapsedBranchGroups,
    };
  }

  private bindChangeEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-change-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.changeAction;
        if (action === "refresh") {
          void this.refresh();
        } else if (action === "revert") {
          void this.revertSelectedChange();
        } else if (action === "diff") {
          this.openSelectedChangeDiff();
        } else if (action === "view") {
          const view = this.changesState.fileView === "tree" ? "flat" : "tree";
          this.changesController.setFileView(view);
          saveChangeFileView(window.localStorage, view);
        } else if (action === "expand") {
          this.changesController.expandDirectories();
        } else if (action === "collapse") {
          const snapshot = this.windowSession.repository.state.snapshot;
          if (snapshot) {
            this.changesController.collapseDirectories(changeDisclosureKeys(snapshot));
          }
        }
      });
    });

    this.root.querySelectorAll<HTMLInputElement>("[data-include-path]").forEach((checkbox) => {
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        const path = checkbox.dataset.includePath;
        if (path) this.setChangePathsIncluded([path], checkbox.checked);
      });
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-include-group]").forEach((checkbox) => {
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        const snapshot = this.windowSession.repository.state.snapshot;
        const group = checkbox.dataset.includeGroup as ChangeGroupId | undefined;
        if (!snapshot || !group) return;
        this.setChangePathsIncluded(
          snapshot.changes.filter((change) => changeGroup(change) === group).map((change) => change.path),
          checkbox.checked,
        );
      });
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-include-directory]").forEach((checkbox) => {
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        const snapshot = this.windowSession.repository.state.snapshot;
        const path = checkbox.dataset.includeDirectory;
        const group = checkbox.dataset.includeDirectoryGroup as ChangeGroupId | undefined;
        if (!snapshot || !path || !group) return;
        this.setChangePathsIncluded(
          snapshot.changes
            .filter(
              (change) =>
                changeGroup(change) === group &&
                (change.path === path || change.path.startsWith(`${path}/`)),
            )
            .map((change) => change.path),
          checkbox.checked,
        );
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-change-disclosure]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.changeDisclosure;
        if (!key) return;
        const expanded = !this.changesState.collapsedDirectories.has(key);
        this.changesController.setDirectoryExpanded(key, !expanded);
        this.renderLeftTool();
      });
    });
    this.root.querySelectorAll<HTMLElement>("[data-change-path]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest(".change-checkbox")) return;
        const path = row.dataset.changePath;
        if (!path) return;
        this.selectChangeRow(row, false);
      });
      row.addEventListener("keydown", (event) => {
        if (event.target !== row) return;
        if (event.key === "Enter") {
          event.preventDefault();
          this.selectChangeRow(row, true);
          return;
        }
        if (event.key === " ") {
          const path = row.dataset.changePath;
          if (!path) return;
          event.preventDefault();
          this.setChangePathsIncluded(
            [path],
            this.changesState.excludedPaths.has(path),
          );
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const rows = Array.from(this.root.querySelectorAll<HTMLElement>("[data-change-path]"))
          .filter((candidate) => candidate.offsetParent !== null);
        const current = rows.indexOf(row);
        if (current < 0) return;
        event.preventDefault();
        const target =
          event.key === "Home"
            ? rows[0]
            : event.key === "End"
              ? rows.at(-1)
              : rows[current + (event.key === "ArrowDown" ? 1 : -1)];
        if (target) this.selectChangeRow(target, true);
      });
    });
    this.syncChangeInclusionUi();
  }

  private handleChangeTreeScroll(results: HTMLElement): void {
    if (this.shellState.layout.leftTool !== "changes" || !this.windowSession.repository.state.snapshot) return;
    const rows = changeViewRows(this.windowSession.repository.state.snapshot, this.changesState);
    const window = changeTreeRenderWindow(
      rows.length,
      results.scrollTop,
      results.clientHeight,
    );
    const nextStart = window?.start ?? 0;
    if (
      nextStart === this.changeTreeWindowStart ||
      this.changeTreeScrollFrame !== null
    ) return;
    this.changeTreeScrollFrame = requestAnimationFrame(() => {
      this.changeTreeScrollFrame = null;
      if (this.shellState.layout.leftTool !== "changes") return;
      this.renderLeftTool();
    });
  }

  private selectChangeRow(
    row: HTMLElement,
    restoreFocus: boolean,
  ): void {
    const path = row.dataset.changePath;
    if (!path || !this.windowSession.repository.state.snapshot) return;
    this.changesController.selectChange(path);
    if (this.changesState.selectedChange && this.windowSession.repository.state.snapshot) {
      this.activateDiffPreview({
        kind: "working-diff",
        repositoryRoot: this.windowSession.repository.state.snapshot.root,
        selection: { ...this.changesState.selectedChange },
      });
    }
    this.root.querySelectorAll<HTMLElement>("[data-change-path]").forEach((candidate) => {
      const primary = candidate.dataset.changePath === path;
      candidate.classList.toggle("primary", primary);
      candidate.setAttribute("aria-selected", String(primary));
    });
    const selected = this.selectedChangeModel(this.windowSession.repository.state.snapshot);
    const diff = this.root.querySelector<HTMLButtonElement>("[data-change-action='diff']");
    const revert = this.root.querySelector<HTMLButtonElement>("[data-change-action='revert']");
    if (diff) diff.disabled = false;
    if (revert) {
      const unsupported =
        !selected ||
        this.windowSession.repository.state.snapshot.branch.unborn ||
        selected.conflicted ||
        selected.submodule ||
        selected.worktreeStatus === "untracked" ||
        selected.indexStatus === "added" ||
        selected.indexStatus === "copied";
      revert.disabled = unsupported;
      revert.title = unsupported
        ? "Select an ordinary tracked file to revert"
        : "Revert selected file to HEAD";
    }
    this.renderEditor();
    if (this.changesState.selectedChange) void this.loadSelectedDiff();
    if (restoreFocus) this.focusChangeRow(path);
  }

  private setChangePathsIncluded(paths: string[], included: boolean): void {
    this.changesController.setPathsIncluded(paths, included);
  }

  private syncChangeInclusionUi(): void {
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!snapshot || this.shellState.layout.leftTool !== "changes") return;
    this.root.querySelectorAll<HTMLInputElement>("[data-include-path]").forEach((checkbox) => {
      const path = checkbox.dataset.includePath!;
      checkbox.checked = !this.changesState.excludedPaths.has(path);
      checkbox.indeterminate = false;
      checkbox.closest(".change-row")?.classList.toggle("excluded", !checkbox.checked);
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-include-group]").forEach((checkbox) => {
      const group = checkbox.dataset.includeGroup as ChangeGroupId;
      const paths = snapshot.changes
        .filter((change) => changeGroup(change) === group)
        .map((change) => change.path);
      this.setAggregateCheckbox(checkbox, paths);
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-include-directory]").forEach((checkbox) => {
      const path = checkbox.dataset.includeDirectory!;
      const group = checkbox.dataset.includeDirectoryGroup as ChangeGroupId;
      const paths = snapshot.changes
        .filter(
          (change) =>
            changeGroup(change) === group &&
            (change.path === path || change.path.startsWith(`${path}/`)),
        )
        .map((change) => change.path);
      this.setAggregateCheckbox(checkbox, paths);
    });
  }

  private setAggregateCheckbox(checkbox: HTMLInputElement, paths: string[]): void {
    const included = paths.filter((path) => !this.changesState.excludedPaths.has(path)).length;
    checkbox.checked = paths.length > 0 && included === paths.length;
    checkbox.indeterminate = included > 0 && included < paths.length;
  }

  private focusChangeRow(path: string): void {
    const mounted = Array.from(
      this.root.querySelectorAll<HTMLElement>("[data-change-path]"),
    ).find((row) => row.dataset.changePath === path);
    if (mounted) {
      mounted.focus();
      return;
    }
    const snapshot = this.windowSession.repository.state.snapshot;
    const results = this.root.querySelector<HTMLElement>("#change-results");
    if (!snapshot || !results) return;
    const index = changeViewRows(snapshot, this.changesState).findIndex(
      (row) => row.kind === "file" && row.change.path === path,
    );
    if (index < 0) return;
    results.scrollTop = index * CHANGE_TREE_ROW_HEIGHT;
    this.renderLeftTool();
    queueMicrotask(() => {
      Array.from(this.root.querySelectorAll<HTMLElement>("[data-change-path]"))
        .find((row) => row.dataset.changePath === path)
        ?.focus();
    });
  }

  private bindHistoryEvents(): void {
    const input = this.root.querySelector<HTMLInputElement>("#history-filter");
    input?.addEventListener("input", () => {
      this.state.historyQuery = input.value;
      this.renderHistoryResults();
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        event.stopPropagation();
        input.value = "";
        this.state.historyQuery = "";
        this.renderHistoryResults();
        return;
      }
      if (event.key === "Enter" || event.key === "ArrowDown") {
        const first = this.root.querySelector<HTMLButtonElement>("[data-commit]");
        if (!first) return;
        event.preventDefault();
        const key = first.dataset.commitKey;
        if (key) this.selectCommit(key, true);
      }
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-text-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.historyTextMode === "case") {
          this.state.historyCaseSensitive = !this.state.historyCaseSensitive;
        } else {
          this.state.historyRegularExpression = !this.state.historyRegularExpression;
        }
        this.renderHistoryPane();
        this.focusHistoryFilter();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-menu]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const menu = button.dataset.historyMenu as HistoryFilterMenu | undefined;
        if (!menu) return;
        this.state.historyFilterMenu = this.state.historyFilterMenu === menu ? null : menu;
        this.state.historyBranchSubmenu = null;
        this.renderHistoryPane();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-branch-submenu]").forEach((button) => {
      const open = () => {
        const submenu = button.dataset.historyBranchSubmenu;
        if (!submenu || this.state.historyBranchSubmenu === submenu) return;
        this.state.historyBranchSubmenu = submenu;
        this.renderHistoryPane();
      };
      button.addEventListener("pointerenter", open);
      button.addEventListener("click", open);
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-open-dialog]").forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.historyOpenDialog as AppState["historyDialog"];
        if (kind) this.openHistoryDialog(kind);
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-quick-ref]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.historyQuickRef;
        const branch = key ? this.branchForKey(key) : null;
        const snapshot = this.windowSession.repository.state.snapshot;
        if (!key || !branch || !snapshot) return;
        // Keep every catalog match in the query so later root-checkbox changes preserve the
        // workspace-level branch meaning; repositoryIds still controls which roots participate.
        this.setLogicalBranchScope(branch, snapshot);
        this.state.historyFilterMenu = null;
        this.state.historyBranchSubmenu = null;
        this.applyHistoryQuery(true);
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-history-clear-users]")?.addEventListener("click", () => {
      this.state.historyCurrentAuthor = false;
      this.state.historyAuthorEmails.clear();
      this.applyHistoryQuery();
    });
    this.root.querySelector<HTMLButtonElement>("[data-history-me]")?.addEventListener("click", () => {
      this.state.historyCurrentAuthor = !this.state.historyCurrentAuthor;
      this.applyHistoryQuery();
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-author]").forEach((button) => {
      button.addEventListener("click", () => {
        const email = button.dataset.historyAuthor;
        if (!email) return;
        const authors = new Set(this.state.historyAuthorEmails);
        if (authors.has(email)) authors.delete(email);
        else authors.add(email);
        this.state.historyAuthorEmails = authors;
        this.applyHistoryQuery();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-date]").forEach((button) => {
      button.addEventListener("click", () => {
        const preset = button.dataset.historyDate as HistoryDatePreset | undefined;
        if (!preset) return;
        this.state.historyDatePreset = preset;
        this.state.historySinceEpoch = historyDateSince(preset);
        this.applyHistoryQuery();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-order]").forEach((button) => {
      button.addEventListener("click", () => {
        this.state.historyOrder = button.dataset.historyOrder === "date" ? "date" : "topological";
        this.applyHistoryQuery();
      });
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-history-root]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const repositoryId = checkbox.dataset.historyRoot;
        const snapshot = this.windowSession.repository.state.snapshot;
        if (!repositoryId || !snapshot) return;
        this.state.historyRepositoryIds = toggleHistoryRootSelection(
          snapshot.repositoryRoots.map((root) => root.id),
          this.state.historyRepositoryIds,
          repositoryId,
          checkbox.checked,
        );
        this.applyHistoryQuery();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-quick-path]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.historyQuickPath;
        const path = key ? this.pathForKey(key) : null;
        if (!key || !path) return;
        this.state.historyPaths = new Map([[key, path]]);
        this.recordRecentHistoryPath(path);
        this.state.historyFilterMenu = null;
        this.applyHistoryQuery();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-graph-option]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.historyGraphOption === "first-parent") {
          this.state.historyFirstParent = !this.state.historyFirstParent;
        } else {
          this.state.historyExcludeMerges = !this.state.historyExcludeMerges;
        }
        this.applyHistoryQuery();
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-history-collapse-linear]")?.addEventListener("click", () => {
      this.state.historyCollapseLinear = !this.state.historyCollapseLinear;
      this.renderHistoryPane();
    });
  }

  private bindHistoryDialogEvents(): void {
    const kind = this.state.historyDialog;
    if (!kind) return;
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-dialog-cancel]").forEach((button) => {
      button.addEventListener("click", () => this.closeHistoryDialog());
    });
    const search = this.root.querySelector<HTMLInputElement>("#history-dialog-search");
    search?.addEventListener("input", () => {
      this.state.historyDialogQuery = search.value;
      const position = search.selectionStart ?? search.value.length;
      this.renderHistoryDialog();
      const replacement = this.root.querySelector<HTMLInputElement>("#history-dialog-search");
      replacement?.focus();
      replacement?.setSelectionRange(position, position);
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-history-dialog-ref]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.historyDialogRef;
        const branch = key ? this.branchForKey(key) : null;
        if (!key || !branch) return;
        if (input.checked) this.state.historyRefDraft.set(key, branch);
        else this.state.historyRefDraft.delete(key);
        this.updateHistoryDialogApplyCount(this.state.historyRefDraft.size || "all");
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-dialog-favorite]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.historyDialogFavorite;
        const branch = key ? this.branchForKey(key) : null;
        if (!branch) return;
        this.toggleFavoriteHistoryRef(branch);
        this.renderHistoryDialog();
      });
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-history-dialog-path]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.historyDialogPath;
        const candidate = key
          ? historyPathCandidates(this.filesState.files).find(
              (path) => historyPathKey(path) === key,
            )
          : null;
        if (!key || !candidate) return;
        if (input.checked) {
          for (const [selectedKey, selected] of this.state.historyPathDraft) {
            if (
              selected.repositoryId === candidate.repositoryId &&
              (selected.path.startsWith(`${candidate.path}/`) ||
                candidate.path.startsWith(`${selected.path}/`))
            ) {
              this.state.historyPathDraft.delete(selectedKey);
            }
          }
          this.state.historyPathDraft.set(key, {
            repositoryId: candidate.repositoryId,
            path: candidate.path,
          });
        } else {
          this.state.historyPathDraft.delete(key);
        }
        this.renderHistoryDialog();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-tree-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.historyTreeToggle;
        if (!key) return;
        if (this.state.historyTreeCollapsed.has(key)) this.state.historyTreeCollapsed.delete(key);
        else this.state.historyTreeCollapsed.add(key);
        this.renderHistoryDialog();
      });
    });
    this.root.querySelector<HTMLTextAreaElement>("#history-path-text")?.addEventListener("input", (event) => {
      this.state.historyPathText = (event.currentTarget as HTMLTextAreaElement).value;
      this.state.historyDialogError = null;
    });
    this.root.querySelector<HTMLTextAreaElement>("#history-path-text")?.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.applyHistoryDialog();
      }
    });
    this.root.querySelector<HTMLButtonElement>("[data-history-dialog-clear]")?.addEventListener("click", () => {
      if (kind === "branches") this.state.historyRefDraft.clear();
      else this.state.historyPathDraft.clear();
      this.renderHistoryDialog();
    });
    this.root.querySelector<HTMLButtonElement>("[data-history-dialog-apply]")?.addEventListener("click", () => {
      this.applyHistoryDialog();
    });
    queueMicrotask(() => {
      if (kind === "branches") this.root.querySelector<HTMLInputElement>("#history-dialog-search")?.focus();
      else if (kind === "paths-text") this.root.querySelector<HTMLTextAreaElement>("#history-path-text")?.focus();
    });
  }

  private applyHistoryDialog(): void {
    const kind = this.state.historyDialog;
    if (!kind) return;
    if (kind === "branches") {
      this.state.historyRefs = new Map(this.state.historyRefDraft);
      const selected = Array.from(this.state.historyRefs.entries());
      this.state.selectedBranch = selected.length === 1 ? selected[0]![0] : null;
      this.state.gitDetail = selected.length === 1 ? "branch" : "commit";
      for (const reference of this.state.historyRefs.values()) {
        this.recordRecentHistoryRef(reference);
      }
    } else if (kind === "paths-text") {
      const result = resolveHistoryPathText(
        this.state.historyPathText,
        historyPathCandidates(this.filesState.files),
      );
      if (result.error) {
        this.state.historyDialogError = result.error;
        this.renderHistoryDialog();
        return;
      }
      this.state.historyPathDraft = new Map(
        result.paths.map((path) => [historyPathKey(path), path]),
      );
      this.state.historyPaths = new Map(this.state.historyPathDraft);
      for (const path of this.state.historyPaths.values()) this.recordRecentHistoryPath(path);
    } else {
      this.state.historyPaths = new Map(this.state.historyPathDraft);
      for (const path of this.state.historyPaths.values()) this.recordRecentHistoryPath(path);
    }
    this.closeHistoryDialog();
    this.applyHistoryQuery();
  }

  private updateHistoryDialogApplyCount(count: number | string): void {
    const button = this.root.querySelector<HTMLButtonElement>("[data-history-dialog-apply]");
    if (button && this.state.historyDialog === "branches") button.textContent = `Apply ${count}`;
  }

  private renderHistoryResults(): void {
    if (!this.windowSession.repository.state.snapshot || this.shellState.layout.bottomTool !== "branches") return;
    const commits = this.filteredHistoryCommits();
    this.historyListView.render(this.historyListPresentation());
    this.renderHistoryCount(commits.length);
  }

  private renderHistoryCount(filteredCount: number): void {
    const count = this.query("#history-count");
    count.textContent =
      this.historyState.history.status === "loading"
        ? "…"
        : this.historyState.history.status === "error"
          ? "!"
          : filteredCount.toString();
    count.title = `${filteredCount} of ${this.historyState.history.commits.length} commits in ${historyScope(this.historyNavigationViewModel()).label}`;
    const refresh = this.root.querySelector<HTMLElement>("#history-refresh-status");
    if (refresh) refresh.textContent = this.historyState.refreshing ? "Refreshing…" : "";
  }

  private handleHistoryScroll(results: HTMLElement): void {
    this.historyController.handleScroll({
      scrollTop: results.scrollTop,
      scrollHeight: results.scrollHeight,
      clientHeight: results.clientHeight,
    });
  }

  private renderBranchCount(snapshot: RepositorySnapshot): void {
    const visible = this.filteredBranches(snapshot).length;
    const total = this.logicalBranches(snapshot).length;
    const count = this.query("#branch-count");
    count.textContent = String(visible);
    count.title = `${visible} of ${total} logical refs`;
  }

  private focusHistoryFilter(): void {
    const input = this.root.querySelector<HTMLInputElement>("#history-filter");
    input?.focus();
    input?.select();
  }

  private selectCommit(key: string, restoreFocus = false): void {
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!snapshot) return;
    this.state.gitDetail = "commit";
    if (!this.historyController.selectCommit(snapshot.root, key, true)) return;
    this.updateHistoryCommitSelection(key);
    this.renderGitDetailPane();
    if (restoreFocus) this.focusHistoryCommit(key);
  }

  private updateHistoryCommitSelection(key: string): void {
    this.historyListView.updateSelection(key);
  }

  private focusHistoryCommit(key: string): void {
    this.historyListView.focusCommit(key);
  }

  private bindBranchEvents(): void {
    const input = this.root.querySelector<HTMLInputElement>("#branch-filter");
    input?.addEventListener("input", () => {
      const snapshot = this.windowSession.repository.state.snapshot;
      if (!snapshot) return;
      this.state.branchQuery = input.value;
      this.query("#branch-results").innerHTML = this.renderBranchGroups(snapshot);
      this.renderBranchCount(snapshot);
      this.bindBranchRows();
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        input.value = "";
        this.state.branchQuery = "";
        const snapshot = this.windowSession.repository.state.snapshot;
        if (!snapshot) return;
        this.query("#branch-results").innerHTML = this.renderBranchGroups(snapshot);
        this.renderBranchCount(snapshot);
        this.bindBranchRows();
        return;
      }
      if (event.key === "Enter" || event.key === "ArrowDown") {
        const first = this.root.querySelector<HTMLButtonElement>("[data-branch]");
        if (!first) return;
        event.preventDefault();
        const key = first.dataset.branchKey;
        if (key) this.selectBranch(key, true);
      }
    });
    this.bindBranchRows();
  }

  private bindBranchRows(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-branch-group-toggle]")
      .forEach((button) => {
        button.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          button.click();
        });
        button.addEventListener("click", () => {
          const kind = button.dataset.branchGroupToggle as BranchSummary["kind"] | undefined;
          if (!kind) return;
          const collapsed = new Set(this.state.collapsedBranchGroups);
          if (collapsed.has(kind)) collapsed.delete(kind);
          else collapsed.add(kind);
          this.state.collapsedBranchGroups = collapsed;
          this.query("#branch-navigation-body").innerHTML =
            this.renderBranchNavigation(this.windowSession.repository.state.snapshot!);
          this.renderBranchCount(this.windowSession.repository.state.snapshot!);
          this.bindBranchEvents();
          this.root
            .querySelector<HTMLButtonElement>(`[data-branch-group-toggle="${kind}"]`)
            ?.focus();
        });
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-branch]").forEach((row) => {
      row.addEventListener("click", () => {
        const key = row.dataset.branchKey;
        if (key) this.selectBranch(key);
      });
      row.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const rows = Array.from(
          this.root.querySelectorAll<HTMLButtonElement>("[data-branch]"),
        ).filter((candidate) => !candidate.closest("[hidden]"));
        const current = rows.indexOf(row);
        if (current < 0) return;
        event.preventDefault();
        const target =
          event.key === "Home"
            ? rows[0]
            : event.key === "End"
              ? rows.at(-1)
              : rows[current + (event.key === "ArrowDown" ? 1 : -1)];
        const key = target?.dataset.branchKey;
        if (key) this.selectBranch(key, true);
      });
    });
  }

  private selectBranch(key: string, restoreFocus = false): void {
    const snapshot = this.windowSession.repository.state.snapshot;
    const branch = snapshot?.branches.find((candidate) => branchKey(candidate) === key);
    if (!snapshot || !branch) return;
    const branches = this.allMatchingHistoryBranches(branch, snapshot);
    const selectedExclusively =
      branches.length === this.state.historyRefs.size &&
      branches.every((candidate) => this.state.historyRefs.has(branchKey(candidate)));
    if (selectedExclusively) {
      this.state.historyRefs.clear();
      this.state.selectedBranch = null;
      this.state.gitDetail = "commit";
      this.applyHistoryQuery(true);
      if (restoreFocus) {
        const rows = this.root.querySelectorAll<HTMLButtonElement>("[data-branch]");
        Array.from(rows)
          .find((row) => row.dataset.branchKey === key)
          ?.focus();
      }
      return;
    }
    this.setLogicalBranchScope(branch, snapshot);
    this.applyHistoryQuery(true);
    if (restoreFocus) {
      const rows = this.root.querySelectorAll<HTMLButtonElement>("[data-branch]");
      Array.from(rows)
        .find((row) => row.dataset.branchKey === key)
        ?.focus();
    }
  }

  private renderEditor(): void {
    const workspaceRoot = this.windowSession.workspace.state.root;
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!workspaceRoot) return;
    this.editorSurface.retain(this.editorState.session.textTabs.map((tab) => tab.id));
    const document = this.activeDocument();
    const editorPanel = this.query("#editor-panel");
    const header = this.query("#content-header");
    const tabbar = this.query("#editor-tabbar");
    const activeKey = editorDocumentKey(document);
    const revealActiveTab = activeKey !== this.lastRenderedEditorDocumentKey;
    this.lastRenderedEditorDocumentKey = activeKey;
    tabbar.innerHTML = renderEditorTabsView({
      session: this.editorState.session,
      document,
      statusClass: (workspacePath) => this.editorTabFileStatusClass(workspacePath),
    });
    this.renderEditorContextActions(document);
    this.renderEditorTabMenu();
    this.bindEditorTabEvents();
    this.renderDocumentStatus();
    const showContextHeader =
      document.kind === "working-diff" || document.kind === "commit-diff";
    editorPanel.classList.toggle("show-context-header", showContextHeader);
    if (!showContextHeader) header.innerHTML = "";
    if (revealActiveTab) this.revealActiveEditorTab();

    if (document.kind === "welcome") {
      this.showEditorHtml(
        "welcome",
        renderEditorEmptyState(
          "Editor workspace ready",
          "Open a project file to edit it, or choose a changed or committed file to inspect its Diff.",
          "folder",
        ),
      );
      return;
    }

    if (document.kind === "project-image") {
      this.renderProjectImage(document);
      return;
    }

    if (document.kind === "project-file") {
      const tab = activeTextTab(this.editorState.session);
      if (!tab) {
        this.editorController.activateWelcome();
        this.renderEditor();
        return;
      }
      if (tab.status === "loading") {
        this.showEditorHtml(
          editorDocumentContentKey(document, `loading:${tab.loadEpoch}`),
          renderEditorLoadingBlock("Loading text file…"),
        );
      } else if (tab.status === "error") {
        this.showEditorHtml(
          editorDocumentContentKey(document, `error:${tab.loadEpoch}:${tab.error ?? "unknown"}`),
          renderEditorRetryState(
            "Could not open text file",
            tab.error ?? "The file could not be loaded.",
            "retry-text-file",
            "folder",
          ),
        );
        this.query("#retry-text-file").addEventListener("click", () => {
          void this.openProjectFile(document.repositoryRoot, {
            repositoryId: document.repositoryId,
            path: document.path,
            workspacePath: document.workspacePath,
          });
        });
      } else {
        const markdown = isMarkdownPath(tab.document.path);
        const key = editorDocumentContentKey(
          document,
          `text:${tab.loadEpoch}:${markdown ? tab.markdownMode : "source"}`,
        );
        if (markdown) {
          this.mountMarkdownEditor(key, tab);
        } else {
          this.mountTextEditor(key, tab);
        }
      }
      return;
    }

    if (document.kind === "working-diff") {
      const selected = document.selection;
      const imageDiff = isImagePreviewPath(selected.path);
      header.innerHTML = `
        ${renderContentHeading(basename(selected.path), selected.path)}
        <div class="header-actions">${this.diffControls(document, imageDiff)}<span class="scope-pill">Local changes</span></div>
      `;
      this.bindDiffControls();
      if (imageDiff) {
        this.renderImageDiff(document, () => void this.loadSelectedDiff());
        return;
      }
      if (this.changesState.workingPatchLoading) {
        this.showEditorHtml(
          editorDocumentContentKey(document, "loading"),
          renderEditorLoadingBlock("Loading patch…"),
        );
      } else if (this.changesState.workingPatchError) {
        this.showEditorHtml(
          editorDocumentContentKey(
            document,
            `error:${this.changesState.workingPatchError}`,
          ),
          renderEditorRetryState(
            "Could not load patch",
            this.changesState.workingPatchError,
            "retry-working-diff",
            "changes",
          ),
        );
        this.query("#retry-working-diff").addEventListener("click", () => {
          void this.loadSelectedDiff();
        });
      } else if (this.changesState.workingPatch) {
        this.mountEditorDiff(
          editorDocumentContentKey(
            document,
            `patch:${this.changesState.workingPatchVersion}`,
          ),
          this.changesState.workingPatch.patch ||
            "No textual diff is available for this selection.",
          selected.path,
        );
      }
      return;
    }

    if (!snapshot) {
      this.editorController.closePreview();
      this.renderEditor();
      return;
    }
    const commit = snapshot.commits.find((item) => item.oid === document.oid);
    const shortOid = commit?.shortOid ?? document.oid.slice(0, 8);
    const imageDiff = isImagePreviewPath(document.path);
    header.innerHTML = `
      ${renderContentHeading(basename(document.path), document.path)}
      <div class="header-actions">${this.diffControls(document, imageDiff)}<code class="oid">${escapeHtml(shortOid)}</code></div>
    `;
    this.bindDiffControls();
    if (imageDiff) {
      this.renderImageDiff(document, () => void this.loadSelectedCommitDiff());
      return;
    }
    if (this.state.commitPatchLoading) {
      this.showEditorHtml(
        editorDocumentContentKey(document, "loading"),
        renderEditorLoadingBlock("Loading commit patch…"),
      );
    } else if (this.state.commitPatchError) {
      this.showEditorHtml(
        editorDocumentContentKey(
          document,
          `error:${this.state.commitPatchError}`,
        ),
        renderEditorRetryState(
          "Could not load patch",
          this.state.commitPatchError,
          "retry-commit-patch",
          "changes",
        ),
      );
      this.query("#retry-commit-patch").addEventListener("click", () => {
        void this.loadSelectedCommitDiff();
      });
    } else if (this.state.commitPatch) {
      this.mountEditorDiff(
        editorDocumentContentKey(
          document,
          `patch:${this.state.commitPatchVersion}`,
        ),
        this.state.commitPatch.patch || "No textual diff is available for this file.",
        document.path,
      );
    }
  }

  private showEditorHtml(key: string, html: string): void {
    this.editorSurface.showHtml(key, html, () => this.captureMountedTextEditor());
  }

  private renderProjectImage(document: ProjectImageDocument): void {
    this.editorSurface.renderProjectImage(
      document,
      this.imageSurface,
      () => this.captureMountedTextEditor(),
      () => {
        void this.openProjectImage(document.repositoryRoot, {
          repositoryId: document.repositoryId,
          path: document.path,
          workspacePath: document.workspacePath,
        });
      },
    );
  }

  private renderImageDiff(
    document: Exclude<EditorDocument, { kind: "welcome" | "project-file" | "project-image" }>,
    retry: () => void,
  ): void {
    this.editorSurface.renderImageDiff(
      document,
      this.imageSurface,
      () => this.captureMountedTextEditor(),
      retry,
    );
  }

  private mountEditorDiff(key: string, patch: string, path: string): void {
    this.editorSurface.mountDiff(
      key,
      patch,
      path,
      this.settingsState.preferences,
      this.diffPresentation(),
      () => this.captureMountedTextEditor(),
    );
  }

  private mountTextEditor(key: string, tab: TextTabState): void {
    this.editorSurface.mountText(
      key,
      tab,
      this.settingsState.preferences,
      () => this.captureMountedTextEditor(),
      (tabId, content) => this.handleEditorContentChange(tabId, content),
    );
  }

  private mountMarkdownEditor(key: string, tab: TextTabState): void {
    this.editorSurface.mountMarkdown(
      key,
      tab,
      this.settingsState.preferences,
      () => this.captureMountedTextEditor(),
      (tabId, content) => this.handleEditorContentChange(tabId, content),
    );
  }

  private handleEditorContentChange(tabId: string, content: string): void {
    const previous = textTab(this.editorState.session, tabId);
    const wasDirty = previous ? isTextTabDirty(previous) : false;
    this.editorController.markEdited(tabId, content);
    const current = textTab(this.editorState.session, tabId);
    if (
      previous &&
      current &&
      (wasDirty !== isTextTabDirty(current) || previous.conflict)
    ) {
      this.renderEditor();
    }
  }
  private renderEditorContextActions(document: EditorDocument): void {
    const host = this.query("#editor-context-actions");
    const tab = document.kind === "project-file" ? activeTextTab(this.editorState.session) : null;
    if (!tab || tab.status !== "ready" || !isMarkdownPath(tab.document.path)) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = renderMarkdownModeControls(tab);
    host
      .querySelectorAll<HTMLButtonElement>("[data-markdown-mode]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const active = activeTextTab(this.editorState.session);
          const mode = button.dataset.markdownMode as MarkdownEditorMode;
          if (!active || active.id !== tab.id || active.markdownMode === mode) return;
          this.captureMountedTextEditor();
          this.editorController.setMarkdownMode(tab.id, mode);
          this.markdownModePreferences = rememberMarkdownMode(
            this.markdownModePreferences,
            tab.id,
            mode,
          );
          saveMarkdownModePreferences(
            window.localStorage,
            this.markdownModePreferences,
          );
          this.renderEditor();
        });
      });
  }

  private renderEditorTabMenu(): void {
    const toggle = this.query<HTMLButtonElement>("#editor-tab-menu-toggle");
    const menu = this.query("#editor-tab-menu");
    const hasDocuments =
      this.editorState.session.textTabs.length > 0 || this.editorState.session.preview !== null;
    if (!hasDocuments) this.shellController.closeEditorTabMenu();
    toggle.disabled = !hasDocuments;
    toggle.setAttribute("aria-expanded", String(this.shellState.editorTabMenuOpen));
    menu.classList.toggle("hidden", !this.shellState.editorTabMenuOpen);
    menu.innerHTML = renderEditorTabMenuView({
      session: this.editorState.session,
      open: this.shellState.editorTabMenuOpen,
      statusClass: (workspacePath) => this.editorTabFileStatusClass(workspacePath),
    });
  }

  private bindEditorTabMenuEvents(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-editor-menu-tab-index]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const index = Number(button.dataset.editorMenuTabIndex);
          const tab = this.editorState.session.textTabs[index];
          if (!tab) return;
          this.shellController.closeEditorTabMenu();
          this.activateEditorTextTab(tab, true);
        });
      });
    this.root
      .querySelector<HTMLButtonElement>("[data-editor-menu-preview]")
      ?.addEventListener("click", () => {
        const preview = this.editorState.session.preview;
        if (!preview) return;
        this.shellController.closeEditorTabMenu();
        this.captureMountedTextEditor();
        this.editorController.reactivatePreview();
        this.renderLeftTool();
        this.renderEditor();
        this.revealActiveEditorTab();
      });
  }

  private editorTabFileStatusClass(workspacePath: string): string {
    const node = findProjectTreeNode(this.projectTree(), workspacePath);
    return `file-status-${node?.status ?? "unmodified"}`;
  }

  private renderDocumentStatus(): void {
    const encoding = this.query("#document-encoding");
    const tab = activeTextTab(this.editorState.session);
    const visible = tab?.status === "ready";
    const label = visible ? (tab.utf8Bom ? "UTF-8 BOM" : "UTF-8") : "";
    encoding.textContent = label;
    encoding.setAttribute(
      "title",
      visible ? `Current file encoding: ${label}` : "Current file encoding",
    );
    encoding.classList.toggle("hidden", !visible);
  }

  private revealActiveEditorTab(): void {
    window.requestAnimationFrame(() => {
      const tabbar = this.query<HTMLElement>("#editor-tabbar");
      const active = tabbar.querySelector<HTMLElement>(
        '.editor-tab[aria-selected="true"]',
      );
      if (!active) return;
      revealTabInStrip(tabbar, active);
    });
  }

  private activateEditorTextTab(tab: TextTabState, forceReveal = false): void {
    this.captureMountedTextEditor();
    this.editorController.activateText(tab.id);
    this.renderEditor();
    if (forceReveal) this.revealActiveEditorTab();
  }

  private bindEditorTabEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-editor-tab-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.editorTabIndex);
        const tab = this.editorState.session.textTabs[index];
        if (!tab) return;
        this.activateEditorTextTab(tab);
      });
    });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-close-editor-tab-index]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const index = Number(button.dataset.closeEditorTabIndex);
          const tab = this.editorState.session.textTabs[index];
          if (tab) void this.requestCloseTextTab(tab.id);
        });
      });
    this.root.querySelector<HTMLButtonElement>("[data-editor-preview]")?.addEventListener(
      "click",
      () => {
        const preview = this.editorState.session.preview;
        if (!preview) return;
        this.captureMountedTextEditor();
        this.editorController.reactivatePreview();
        this.renderLeftTool();
        this.renderEditor();
      },
    );
    this.root
      .querySelector<HTMLButtonElement>("[data-close-editor-preview]")
      ?.addEventListener("click", () => {
        this.captureMountedTextEditor();
        this.editorController.closePreview();
        this.imageSurface = null;
        this.renderEditor();
      });
    this.bindEditorTabMenuEvents();
  }

  private captureMountedTextEditor(): void {
    this.editorSurface.capture(
      this.editorState.session,
      (tabId, content) => this.editorController.captureText(tabId, content),
    );
  }

  private async saveTextTab(tabId: string): Promise<boolean> {
    this.editorSurface.capture(
      this.editorState.session,
      (mountedTabId, content) => this.editorController.captureText(mountedTabId, content),
      tabId,
    );
    const tab = textTab(this.editorState.session, tabId);
    if (!tab) return true;
    const result = await this.editorController.saveText(tabId, tab.content);
    if (result.status === "clean") return true;
    if (result.status === "busy") {
      this.setStatus("Wait for the current file operation before continuing", "warning");
      return false;
    }
    if (result.status === "stale" || result.status === "failure") {
      this.renderLeftTool();
      return false;
    }
    this.renderLeftTool();
    this.windowSession.scheduleTrackedRefresh(
      result.tab.document.repositoryRoot,
      "save",
      [result.tab.document.workspacePath],
    );
    if (result.status === "saved") {
      this.setStatus(`Saved ${basename(result.tab.document.workspacePath)}`, "success");
      return true;
    }
    this.setStatus("Saved captured changes; newer edits remain unsaved", "warning");
    return false;
  }

  private async requestCloseTextTab(tabId: string): Promise<void> {
    this.captureMountedTextEditor();
    const tab = textTab(this.editorState.session, tabId);
    if (!tab) return;
    if (isTextTabDirty(tab) || tab.saveRequest) {
      if (tab.saveRequest) {
        this.setStatus("Wait for the file to finish saving", "warning");
        return;
      }
      const save = window.confirm(
        `Save changes to ${tab.document.workspacePath} before closing?\n\nCancel keeps the tab open.`,
      );
      if (!save || !(await this.saveTextTab(tabId))) return;
    }
    if (this.editorController.closeText(tabId)) {
      this.editorSurface.disposeTextTab(tabId);
      this.renderLeftTool();
      this.renderEditor();
    }
  }

  private async saveDirtyTabsBefore(action: string): Promise<boolean> {
    this.captureMountedTextEditor();
    const dirty = dirtyTextTabs(this.editorState.session);
    if (dirty.length === 0) return true;
    const save = window.confirm(
      `Save ${dirty.length} unsaved file${dirty.length === 1 ? "" : "s"} before ${action}?\n\nCancel keeps the current workspace open.`,
    );
    if (!save) return false;
    for (const tab of dirty) {
      if (!(await this.saveTextTab(tab.id))) return false;
    }
    return dirtyTextTabs(this.editorState.session).length === 0;
  }

  private activeDocument(): EditorDocument {
    return this.editorController.activeDocument();
  }

  private activateDiffPreview(
    document: Exclude<EditorDocument, { kind: "welcome" | "project-file" }>,
  ): void {
    this.captureMountedTextEditor();
    this.editorController.activatePreview(document);
  }

  private diffControls(
    document: Extract<EditorDocument, { kind: "working-diff" | "commit-diff" }>,
    imageDiff: boolean,
  ): string {
    const textReady = !imageDiff && (document.kind === "working-diff"
      ? this.changesState.workingPatch !== null
      : this.state.commitPatch !== null);
    return renderEditorDiffControls({
      imageDiff,
      textReady,
      previousFile: this.adjacentDiffPath(document, -1),
      nextFile: this.adjacentDiffPath(document, 1),
      canOpenSource: this.diffProjectFile(document) !== null,
      expanded: this.isDiffExpanded(document),
      preferences: this.settingsState.preferences,
    });
  }

  private bindDiffControls(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-diff-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.diffAction;
        if (action === "previous-change" || action === "next-change") {
          const moved = this.editorSurface.navigateDiffChange(action === "next-change" ? 1 : -1);
          if (!moved) {
            this.setStatus(
              `No ${action === "next-change" ? "next" : "previous"} change in this file`,
              "normal",
            );
          }
        } else if (action === "previous-file" || action === "next-file") {
          this.navigateDiffFile(action === "next-file" ? 1 : -1);
        } else if (action === "open-source") {
          void this.openDiffSourceFile();
        } else if (action === "toggle-unchanged") {
          this.toggleDiffUnchangedLines();
        }
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-diff-layout]").forEach((button) => {
      button.addEventListener("click", () => {
        const layout = button.dataset.diffLayout as DiffLayout;
        if (layout === this.settingsState.preferences.diffLayout) return;
        this.updatePreferences({ diffLayout: layout });
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-diff-whitespace]")?.addEventListener(
      "click",
      () => {
        this.updatePreferences({
          showWhitespace: !this.settingsState.preferences.showWhitespace,
        });
      },
    );
  }

  private adjacentDiffPath(
    document: Extract<EditorDocument, { kind: "working-diff" | "commit-diff" }>,
    direction: DiffDirection,
  ): string | null {
    const paths = document.kind === "working-diff"
      ? this.windowSession.repository.state.snapshot?.changes.map((change) => change.path) ?? []
      : this.historyState.details?.files.map((file) => file.path) ?? [];
    const current = document.kind === "working-diff" ? document.selection.path : document.path;
    return adjacentDiffItem(paths, current, direction);
  }

  private navigateDiffFile(direction: DiffDirection): void {
    const document = this.activeDocument();
    if (document.kind !== "working-diff" && document.kind !== "commit-diff") return;
    const path = this.adjacentDiffPath(document, direction);
    if (!path) {
      this.setStatus(`No ${direction === 1 ? "next" : "previous"} changed file`, "normal");
      return;
    }
    if (document.kind === "commit-diff") {
      this.selectCommitFile(path, false);
      return;
    }
    const snapshot = this.windowSession.repository.state.snapshot;
    const selected = snapshot?.changes.find((change) => change.path === path);
    if (!snapshot || !selected) return;
    this.changesController.selectChange(selected.path);
    this.activateDiffPreview({
      kind: "working-diff",
      repositoryRoot: snapshot.root,
      selection: { path: selected.path, staged: false },
    });
    if (this.shellState.layout.leftTool === "changes") this.renderLeftTool();
    this.renderEditor();
    this.loadSelectedDiff();
  }

  private diffProjectFile(
    document: Extract<EditorDocument, { kind: "working-diff" | "commit-diff" }>,
  ): ProjectFile | null {
    return document.kind === "working-diff"
      ? this.filesState.files.find(
          (file) => file.repositoryId === "." && file.path === document.selection.path,
        ) ?? null
      : this.filesState.files.find(
          (file) => file.repositoryId === document.repositoryId && file.path === document.path,
        ) ?? null;
  }

  private async openDiffSourceFile(): Promise<void> {
    const document = this.activeDocument();
    if (document.kind !== "working-diff" && document.kind !== "commit-diff") return;
    const file = this.diffProjectFile(document);
    if (!file) {
      this.setStatus("The current Diff file is not present in the project tree", "warning");
      return;
    }
    this.shellController.setLayout({ ...this.shellState.layout, leftTool: "files" });
    this.applyWorkbenchLayout(true);
    this.renderActivityRail();
    await this.openProjectFile(document.repositoryRoot, file);
    if (this.windowSession.workspace.state.root === document.repositoryRoot) this.locateCurrentProjectFile();
  }

  private isDiffExpanded(
    document: Extract<EditorDocument, { kind: "working-diff" | "commit-diff" }>,
  ): boolean {
    return this.expandedUnchangedDiffKey === editorDocumentKey(document);
  }

  private toggleDiffUnchangedLines(): void {
    const document = this.activeDocument();
    if (document.kind !== "working-diff" && document.kind !== "commit-diff") return;
    const key = editorDocumentKey(document);
    this.expandedUnchangedDiffKey = this.expandedUnchangedDiffKey === key ? null : key;
    if (document.kind === "working-diff") void this.loadSelectedDiff();
    else void this.loadSelectedCommitDiff();
  }

  private syncDiffControls(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-diff-layout]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.diffLayout === this.settingsState.preferences.diffLayout),
      );
    });
    this.root
      .querySelector<HTMLButtonElement>("[data-diff-whitespace]")
      ?.setAttribute("aria-pressed", String(this.settingsState.preferences.showWhitespace));
  }

  private syncPushDiffControls(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-push-diff-layout]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.pushDiffLayout === this.settingsState.preferences.diffLayout),
      );
    });
    this.root
      .querySelector<HTMLButtonElement>("[data-push-diff-whitespace]")
      ?.setAttribute("aria-pressed", String(this.settingsState.preferences.showWhitespace));
  }

  private diffPresentation(): DiffPresentation {
    return {
      layout: this.settingsState.preferences.diffLayout,
      showWhitespace: this.settingsState.preferences.showWhitespace,
      splitPercentage: this.shellState.layout.diffBeforePercent,
      onSplitPercentageChange: (value, committed) => {
        this.resizeWorkbench("diffBeforePercent", value);
        if (committed) this.persistWorkbenchLayout();
      },
    };
  }

  private loadSelectedDiff(): void {
    const snapshot = this.windowSession.repository.state.snapshot;
    const document = this.activeDocument();
    const selected = this.changesController.selectedChange();
    if (
      !snapshot ||
      !selected ||
      document.kind !== "working-diff" ||
      document.repositoryRoot !== snapshot.root ||
      document.selection.path !== selected.path
    ) return;
    void this.changesController.loadSelectedDiff(this.isDiffExpanded(document));
  }

  private isWorkingDiffActive(): boolean {
    const document = this.activeDocument();
    return document.kind === "working-diff" && document.repositoryRoot === this.windowSession.repository.state.snapshot?.root;
  }

  private syncWorkingImageSurface(): void {
    const document = this.activeDocument();
    if (document.kind !== "working-diff" || !isImagePreviewPath(document.selection.path)) {
      if (this.imageSurface?.key.startsWith("working\0")) this.imageSurface = null;
      return;
    }
    const key = editorDocumentKey(document);
    const version = this.changesState.workingPatchVersion;
    this.imageSurface = this.changesState.workingPatchLoading
      ? { key, version, status: "loading", error: null, image: null, diff: null }
      : this.changesState.workingPatchError
        ? { key, version, status: "error", error: this.changesState.workingPatchError, image: null, diff: null }
        : { key, version, status: "ready", error: null, image: null, diff: this.changesState.workingImageDiff };
  }

  private loadVisibleCommitDetails(): void {
    const snapshot = this.windowSession.repository.state.snapshot;
    if (
      snapshot &&
      this.shellState.layout.bottomTool === "branches" &&
      this.state.gitDetail === "commit"
    ) {
      this.historyController.ensureSelectedDetails(snapshot.root);
    }
  }

  private async loadSelectedCommitDiff(restoreFocus = false): Promise<void> {
    const snapshot = this.windowSession.repository.state.snapshot;
    const details = this.historyState.details;
    const file = details ? this.selectedCommitFile(details) : null;
    const document = this.activeDocument();
    if (
      !snapshot ||
      !details ||
      !file ||
      document.kind !== "commit-diff" ||
      document.repositoryRoot !== snapshot.root ||
      document.repositoryId !== details.repositoryId ||
      document.oid !== details.oid ||
      document.path !== file.path
    ) {
      return;
    }
    const oid = details.oid;
    const key = commitKey(details);
    const repositoryId = details.repositoryId;
    const generation = ++this.commitDiffGeneration;
    this.state.commitPatch = null;
    this.state.commitPatchLoading = true;
    this.state.commitPatchError = null;
    const imageDiff = isImagePreviewPath(file.path);
    const imageKey = editorDocumentKey(document);
    if (imageDiff) {
      this.imageSurface = {
        key: imageKey,
        version: generation,
        status: "loading",
        error: null,
        image: null,
        diff: null,
      };
    }
    this.renderEditor();
    if (restoreFocus) this.focusCommitFile(file.path);

    try {
      if (imageDiff) {
        const diff = await bridge.readCommitImageDiff(
          snapshot.root,
          repositoryId,
          oid,
          file.path,
          file.originalPath,
        );
        const activeDocument = this.activeDocument();
        if (
          generation !== this.commitDiffGeneration ||
          this.windowSession.repository.state.snapshot?.root !== snapshot.root ||
          this.historyState.selectedCommit !== key ||
          this.historyState.selectedFile !== file.path ||
          activeDocument.kind !== "commit-diff" ||
          editorDocumentKey(activeDocument) !== imageKey ||
          diff.path !== file.path
        ) {
          return;
        }
        this.imageSurface = {
          key: imageKey,
          version: generation,
          status: "ready",
          error: null,
          image: null,
          diff,
        };
        this.state.commitPatchLoading = false;
        this.state.commitPatchVersion = generation;
        this.renderEditor();
        if (restoreFocus) this.focusCommitFile(file.path);
        return;
      }
      const diff = await bridge.readCommitDiff(
        snapshot.root,
        repositoryId,
        oid,
        file.path,
        file.originalPath,
        this.isDiffExpanded(document),
      );
      const activeDocument = this.activeDocument();
      if (
        generation !== this.commitDiffGeneration ||
        this.windowSession.repository.state.snapshot?.root !== snapshot.root ||
        this.historyState.selectedCommit !== key ||
        this.historyState.selectedFile !== file.path ||
        activeDocument.kind !== "commit-diff" ||
        activeDocument.repositoryId !== repositoryId ||
        activeDocument.oid !== oid ||
        activeDocument.path !== file.path ||
        diff.repositoryId !== repositoryId ||
        diff.oid !== oid ||
        diff.path !== file.path
      ) {
        return;
      }
      this.state.commitPatch = diff;
      this.state.commitPatchLoading = false;
      this.state.commitPatchVersion = generation;
      this.renderEditor();
      if (restoreFocus) this.focusCommitFile(file.path);
      if (diff.truncated) this.setStatus("Patch truncated at 4 MiB", "warning");
    } catch (error) {
      const activeDocument = this.activeDocument();
      if (
        generation !== this.commitDiffGeneration ||
        this.windowSession.repository.state.snapshot?.root !== snapshot.root ||
        this.historyState.selectedCommit !== key ||
        this.historyState.selectedFile !== file.path ||
        activeDocument.kind !== "commit-diff" ||
        activeDocument.repositoryId !== repositoryId ||
        activeDocument.oid !== oid ||
        activeDocument.path !== file.path
      ) {
        return;
      }
      this.state.commitPatchLoading = false;
      this.state.commitPatchError = errorMessage(error);
      if (imageDiff) {
        this.imageSurface = {
          key: imageKey,
          version: generation,
          status: "error",
          error: errorMessage(error),
          image: null,
          diff: null,
        };
      }
      this.renderEditor();
      if (restoreFocus) this.focusCommitFile(file.path);
      this.showError(error);
    }
  }

  private bindCommitFileEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-commit-file]").forEach((row) => {
      row.addEventListener("click", () => {
        const path = row.dataset.commitFile;
        if (path) this.selectCommitFile(path, false);
      });
      row.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const rows = Array.from(
          this.root.querySelectorAll<HTMLButtonElement>("[data-commit-file]"),
        );
        const current = rows.indexOf(row);
        if (current < 0) return;
        event.preventDefault();
        const target =
          event.key === "Home"
            ? rows[0]
            : event.key === "End"
              ? rows.at(-1)
              : rows[current + (event.key === "ArrowDown" ? 1 : -1)];
        const path = target?.dataset.commitFile;
        if (!path) return;
        this.selectCommitFile(path, true);
      });
    });
  }

  private selectCommitFile(path: string, restoreFocus: boolean): void {
    const snapshot = this.windowSession.repository.state.snapshot;
    const details = this.historyState.details;
    if (!snapshot || !details || !details.files.some((file) => file.path === path)) {
      return;
    }
    if (!this.historyController.selectFile(path)) return;
    this.state.gitDetail = "commit";
    this.activateDiffPreview({
      kind: "commit-diff",
      repositoryRoot: snapshot.root,
      repositoryId: details.repositoryId,
      oid: details.oid,
      path,
    });
    this.state.commitPatch = null;
    this.state.commitPatchLoading = true;
    this.state.commitPatchError = null;
    this.updateCommitFileSelection(path);
    if (restoreFocus) this.focusCommitFile(path);
    void this.loadSelectedCommitDiff(restoreFocus);
  }

  private updateCommitFileSelection(path: string): void {
    this.root
      .querySelectorAll<HTMLButtonElement>("#git-detail-body [data-commit-file]")
      .forEach((row) => {
        const selected = row.dataset.commitFile === path;
        row.classList.toggle("selected", selected);
        row.setAttribute("aria-pressed", String(selected));
      });
  }

  private focusCommitFile(path: string): void {
    const rows = this.root.querySelectorAll<HTMLButtonElement>("[data-commit-file]");
    Array.from(rows)
      .find((row) => row.dataset.commitFile === path)
      ?.focus();
  }

  private selectedCommitFile(details: CommitDetails): CommitFileChange | null {
    return (
      details.files.find((file) => file.path === this.historyState.selectedFile) ??
      details.files[0] ??
      null
    );
  }

  private clearCommitDiffInspection(): void {
    this.commitDiffGeneration += 1;
    this.state.collapsedCommitFileDirectories.clear();
    this.state.commitPatch = null;
    this.state.commitPatchLoading = false;
    this.state.commitPatchError = null;
    if (this.imageSurface?.key.startsWith("commit\0")) this.imageSurface = null;
  }

  private installSnapshotHistory(
    snapshot: RepositorySnapshot,
    preferTip = false,
    preserveFilters = false,
  ): void {
    if (!preserveFilters) this.resetHistoryFilters();
    this.historyController.installSnapshot(
      snapshot.root,
      snapshot.commits,
      this.activeHistoryQuery(),
      preferTip,
    );
  }

  private resetHistoryFilters(): void {
    this.historyFilters.reset();
    this.state.historyFilterMenu = null;
    this.state.historyBranchSubmenu = null;
  }

  private loadHistoryPreferences(snapshot: RepositorySnapshot): void {
    this.historyFilters.loadPreferences(snapshot);
  }

  private recordRecentHistoryRef(reference: HistoryRef): void {
    const root = this.windowSession.repository.state.snapshot?.root;
    if (root) this.historyFilters.recordRecentRef(root, reference);
  }

  private toggleFavoriteHistoryRef(branch: BranchSummary): void {
    const root = this.windowSession.repository.state.snapshot?.root;
    if (root) this.historyFilters.toggleFavorite(root, branch);
  }

  private recordRecentHistoryPath(path: HistoryPath): void {
    this.historyFilters.recordRecentPath(path);
  }

  private branchForKey(key: string): BranchSummary | null {
    return this.windowSession.repository.state.snapshot?.branches.find((branch) => branchKey(branch) === key) ?? null;
  }

  private pathForKey(key: string): HistoryPath | null {
    const candidate = historyPathCandidates(this.filesState.files).find(
      (path) => historyPathKey(path) === key,
    );
    return candidate
      ? { repositoryId: candidate.repositoryId, path: candidate.path }
      : null;
  }

  private activeHistoryQuery(): HistoryQuery {
    return this.historyFilters.query();
  }

  private applyHistoryQuery(preferTip = false): void {
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!snapshot) return;
    const query = this.activeHistoryQuery();
    if (isSnapshotHistoryQuery(query)) {
      this.installSnapshotHistory(snapshot, preferTip);
      this.renderHistoryPane();
      this.renderGitDetailPane();
      this.loadVisibleCommitDetails();
      return;
    }
    this.historyController.loadQuery(snapshot.root, query);
    this.renderHistoryPane();
    this.renderGitDetailPane();
  }

  private clearWorkingDiff(): void {
    this.changesController.clearWorkingDiff(false);
    if (this.imageSurface?.key.startsWith("working\0")) this.imageSurface = null;
  }

  private selectedChangeModel(_snapshot: RepositorySnapshot): FileChange | null {
    return this.changesController.selectedChange();
  }

  private openSelectedChangeDiff(): void {
    const snapshot = this.windowSession.repository.state.snapshot;
    const selected = snapshot ? this.selectedChangeModel(snapshot) : null;
    if (!snapshot || !selected) return;
    this.changesController.selectChange(selected.path);
    this.activateDiffPreview({
      kind: "working-diff",
      repositoryRoot: snapshot.root,
      selection: { path: selected.path, staged: false },
    });
    this.renderEditor();
    this.loadSelectedDiff();
  }

  private async revertSelectedChange(): Promise<void> {
    const snapshot = this.windowSession.repository.state.snapshot;
    const selected = snapshot ? this.selectedChangeModel(snapshot) : null;
    if (!snapshot || !selected || this.state.loading) return;
    const dirty = dirtyTextTabs(this.editorState.session).find(
      (tab) => tab.document.repositoryId === "." && tab.document.path === selected.path,
    );
    if (dirty) {
      this.setStatus("Save or undo the unsaved editor changes before reverting this file", "warning");
      return;
    }
    const label = selected.originalPath
      ? `${selected.originalPath} → ${selected.path}`
      : selected.path;
    if (
      !window.confirm(
        `Revert 1 tracked file to HEAD?\n\n${label}\n\nThis overwrites its staged and working-tree changes.`,
      )
    ) {
      return;
    }

    const generation = this.windowSession.beginTransition();
    let pendingRoot: string | null = null;
    let refreshAfterFailure = false;
    let revertFailure: unknown = null;
    this.setLoading(true, "Reverting selected file…");
    try {
      const result = await this.changesController.revertSelected();
      if (generation !== this.windowSession.generation || result.status === "stale") return;
      if (result.status === "success") {
        const next = this.repositoryIntegration.applyWorkingTreeMutation(result.value);
        this.renderWorkspace();
        if (this.activeDocument().kind === "working-diff") this.loadSelectedDiff();
        pendingRoot = next.root;
        this.setStatus("Selected file reverted", "success");
      } else if (result.status === "failure") {
        refreshAfterFailure = true;
        revertFailure = result.error;
      }
    } finally {
      if (generation === this.windowSession.generation) this.setLoading(false, "Ready");
    }
    if (refreshAfterFailure && generation === this.windowSession.generation) {
      await this.refresh();
      if (revertFailure) this.showError(revertFailure);
    } else if (pendingRoot && generation === this.windowSession.generation) {
      void this.windowSession.scanUntracked(pendingRoot, generation, true, "gitMutation");
    }
  }

  private renderCommitComposer(snapshot: RepositorySnapshot): string {
    const included = includedChanges(snapshot.changes, this.changesState.excludedPaths);
    const conflict = snapshot.changes.some((change) => change.conflicted);
    const submodule = included.some((change) => change.submodule);
    const blockedMessage = conflict
      ? "Resolve conflicts before committing."
      : submodule
        ? "Exclude submodule changes; commit them from their own Git root."
        : included.length === 0
          ? "Select at least one file to commit."
          : "";
    const disabled =
      included.length === 0 ||
      conflict ||
      submodule ||
      this.changesState.commitMessage.trim().length === 0 ||
      this.state.loading;
    return `
      <section class="commit-tool" id="commit-tool" aria-label="Create commit">
        <div class="commit-form">
          <label for="commit-message">Commit Message</label>
          <textarea id="commit-message" placeholder="Commit Message">${escapeHtml(this.changesState.commitMessage)}</textarea>
          <div class="commit-hint"><span>Ctrl/Cmd + Enter</span><span>${this.changesState.commitMessage.trim().length}/72</span></div>
          ${blockedMessage ? `<div class="commit-blocker" role="status">${escapeHtml(blockedMessage)}</div>` : ""}
          <div class="commit-actions"><button class="primary-button commit-button" id="commit-button" type="button" ${disabled ? "disabled" : ""}>Commit ${included.length || ""}</button></div>
        </div>
      </section>`;
  }

  private bindCommitComposer(snapshot: RepositorySnapshot): void {
    const included = includedChanges(snapshot.changes, this.changesState.excludedPaths);
    const blocked =
      snapshot.changes.some((change) => change.conflicted) ||
      included.some((change) => change.submodule);
    const textarea = this.root.querySelector<HTMLTextAreaElement>("#commit-message");
    const button = this.root.querySelector<HTMLButtonElement>("#commit-button");
    textarea?.addEventListener("input", () => {
      this.changesController.setCommitMessage(textarea.value);
      if (button) {
        button.disabled = textarea.value.trim().length === 0 || included.length === 0 || blocked;
      }
      const counter = textarea.parentElement?.querySelector(
        ".commit-hint span:last-child",
      );
      if (counter) counter.textContent = `${textarea.value.trim().length}/72`;
    });
    textarea?.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (!button?.disabled) void this.commit();
      }
    });
    button?.addEventListener("click", () => void this.commit());
  }

  private refreshCommitComposer(): void {
    const snapshot = this.windowSession.repository.state.snapshot;
    const current = this.root.querySelector<HTMLElement>("#commit-tool");
    if (!snapshot || !current) return;
    current.outerHTML = this.renderCommitComposer(snapshot);
    this.bindCommitComposer(snapshot);
  }

  private bindChangeCommitSplitter(): void {
    this.changeCommitSplitterDisposer?.();
    this.changeCommitSplitterDisposer = null;
    const splitter = this.root.querySelector<HTMLElement>("#changes-commit-splitter");
    const layout = this.root.querySelector<HTMLElement>(".changes-tool-layout");
    if (!splitter || !layout) return;
    this.changeCommitSplitterDisposer = attachSplitter(splitter, {
      orientation: "horizontal",
      direction: -1,
      getValue: () => this.shellState.layout.changesCommitHeight,
      getRange: () => ({
        minimum: WORKBENCH_LIMITS.changesCommitMin,
        maximum: Math.max(
          WORKBENCH_LIMITS.changesCommitMin,
          layout.clientHeight -
            WORKBENCH_LIMITS.changesFilesMin -
            WORKBENCH_LIMITS.separatorSize,
        ),
      }),
      onChange: (value) => this.resizeWorkbench("changesCommitHeight", value),
      onCommit: () => this.persistWorkbenchLayout(),
      onReset: () =>
        this.resizeWorkbench(
          "changesCommitHeight",
          WORKBENCH_LAYOUT_DEFAULTS.changesCommitHeight,
        ),
    });
  }

  private renderGitDetail(snapshot: RepositorySnapshot): string {
    if (this.state.gitDetail === "branch") {
      const branch = selectedBranch(snapshot, this.state.selectedBranch);
      return branch
        ? renderBranchDetail({
            snapshot,
            branch,
            safety: this.branchSafety(snapshot),
            loading: this.state.loading,
            newBranchName: this.state.newBranchName,
          })
        : inspectorPlaceholder();
    }
    const commit = selectedCommit(
      this.historyState.history.commits,
      this.historyState.selectedCommit,
    );
    if (!commit) return inspectorPlaceholder();
    const details =
      this.historyState.details?.oid === commit.oid &&
      this.historyState.details.repositoryId === commit.repositoryId
        ? this.historyState.details
        : null;
    return renderCommitDetail({
      snapshot,
      commit,
      details,
      loading: this.historyState.detailsLoading,
      error: this.historyState.detailsError,
      selectedFile: this.historyState.selectedFile,
      fileView: this.state.commitFileView,
      collapsedDirectories: this.state.collapsedCommitFileDirectories,
    });
  }

  private bindGitDetailEvents(snapshot: RepositorySnapshot): void {
    if (this.state.gitDetail === "branch") {
      const branch = selectedBranch(snapshot, this.state.selectedBranch);
      if (branch) this.bindBranchInspector(branch, snapshot);
      return;
    }
    this.bindCommitFileEvents();
    this.root
      .querySelectorAll<HTMLDetailsElement>("[data-commit-file-directory]")
      .forEach((details) => {
        details.addEventListener("toggle", () => {
          const path = details.dataset.commitFileDirectory;
          if (!path) return;
          const renderedExpanded = details.dataset.commitFileRenderedExpanded === "true";
          if (details.open) this.state.collapsedCommitFileDirectories.delete(path);
          else this.state.collapsedCommitFileDirectories.add(path);
          if (details.open !== renderedExpanded) this.renderGitDetailPane(snapshot);
        });
      });
    this.root
      .querySelector<HTMLButtonElement>("#commit-file-view-toggle")
      ?.addEventListener("click", () => {
        this.state.commitFileView = this.state.commitFileView === "tree" ? "flat" : "tree";
        saveCommitFileView(window.localStorage, this.state.commitFileView);
        this.renderGitDetailPane(snapshot);
        this.root.querySelector<HTMLButtonElement>("#commit-file-view-toggle")?.focus();
      });
    this.root
      .querySelector<HTMLButtonElement>("#commit-file-expand-all")
      ?.addEventListener("click", () => {
        this.state.collapsedCommitFileDirectories.clear();
        this.renderGitDetailPane(snapshot);
        this.root.querySelector<HTMLButtonElement>("#commit-file-expand-all")?.focus();
      });
    this.root
      .querySelector<HTMLButtonElement>("#commit-file-collapse-all")
      ?.addEventListener("click", () => {
        const details = this.historyState.details;
        if (!details) return;
        this.state.collapsedCommitFileDirectories = new Set([
          ".",
          ...commitFileDirectoryPaths(buildCommitFileTree(details.files)),
        ]);
        this.renderGitDetailPane(snapshot);
        this.root.querySelector<HTMLButtonElement>("#commit-file-collapse-all")?.focus();
      });
    this.root
      .querySelector<HTMLButtonElement>("#retry-commit-details")
      ?.addEventListener("click", () => {
        const root = this.windowSession.repository.state.snapshot?.root;
        if (root) this.historyController.retryDetails(root);
      });
    const splitter = this.root.querySelector<HTMLElement>("#commit-summary-splitter");
    const layout = this.root.querySelector<HTMLElement>(".commit-detail-layout");
    if (splitter && layout) {
      this.commitDetailSplitterDisposer = attachSplitter(splitter, {
        orientation: "horizontal",
        direction: -1,
        getValue: () => this.shellState.layout.commitSummaryHeight,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.commitSummaryMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.commitSummaryMin,
            layout.clientHeight -
              WORKBENCH_LIMITS.commitFilesMin -
              WORKBENCH_LIMITS.separatorSize,
          ),
        }),
        onChange: (value) => this.resizeWorkbench("commitSummaryHeight", value),
        onCommit: () => this.persistWorkbenchLayout(),
        onReset: () =>
          this.resizeWorkbench(
            "commitSummaryHeight",
            WORKBENCH_LAYOUT_DEFAULTS.commitSummaryHeight,
          ),
      });
    }
  }

  private async commit(): Promise<void> {
    this.captureMountedTextEditor();
    if (dirtyTextTabs(this.editorState.session).length > 0) {
      if (await this.saveDirtyTabsBefore("creating the commit")) {
        await this.refresh();
        this.setStatus("Files saved; review the refreshed selection before committing", "warning");
      }
      return;
    }
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!snapshot || !this.changesController.canCommit() || this.state.loading) return;
    const generation = this.windowSession.beginTransition();
    let pendingRoot: string | null = null;
    let refreshAfter = false;
    let commitFailure: unknown = null;
    this.setLoading(true, "Creating commit…");
    try {
      const outcome = await this.changesController.commit();
      if (generation !== this.windowSession.generation || outcome.status === "stale") return;
      if (outcome.status === "failure") {
        commitFailure = outcome.error;
        refreshAfter = true;
      } else {
        if (outcome.status !== "success") return;
        const result = outcome.value;
        if (result.snapshot) {
          const next = result.snapshot;
          this.repositoryIntegration.applyMutation(
            { snapshot: next, invalidatedSlices: result.invalidatedSlices },
            "gitMutation",
          );
          this.renderWorkspace();
          this.loadVisibleCommitDetails();
          if (this.activeDocument().kind === "working-diff") this.loadSelectedDiff();
          pendingRoot = next.root;
        } else {
          refreshAfter = true;
        }
        this.setStatus(
          result.verificationWarning
            ? "Commit finished, but Git changed concurrently; inspect refreshed history before committing again"
            : result.refreshError
              ? "Commit created; refreshing repository status…"
              : "Commit created",
          result.verificationWarning || result.refreshError ? "warning" : "success",
        );
      }
    } finally {
      if (generation === this.windowSession.generation) this.setLoading(false, "Ready");
    }
    if (refreshAfter && generation === this.windowSession.generation) {
      await this.refresh();
      if (commitFailure) this.showError(commitFailure);
    } else if (pendingRoot && generation === this.windowSession.generation) {
      void this.windowSession.scanUntracked(pendingRoot, generation, true, "gitMutation");
    }
  }

  private async switchBranch(branch: BranchSummary): Promise<void> {
    const snapshot = this.windowSession.repository.state.snapshot;
    if (
      !snapshot ||
      branch.kind !== "local" ||
      branch.current ||
      !this.branchSafety(snapshot).ready ||
      this.state.loading
    ) {
      return;
    }
    await this.runBranchMutation(
      `Checking out ${branch.name}…`,
      `Checked out ${branch.name}`,
      (root) => bridge.switchBranch(root, branch.fullName),
    );
  }

  private async createBranch(): Promise<void> {
    const snapshot = this.windowSession.repository.state.snapshot;
    const name = this.state.newBranchName.trim();
    if (
      !snapshot ||
      !name ||
      !this.branchSafety(snapshot).ready ||
      this.state.loading
    ) {
      return;
    }
    await this.runBranchMutation(
      `Creating ${name}…`,
      `Created and checked out ${name}`,
      (root) => bridge.createBranch(root, name),
    );
    if (this.windowSession.repository.state.snapshot?.branch.head === name) {
      this.state.newBranchName = "";
      this.renderBottomTool();
    }
  }

  private async runBranchMutation(
    loadingMessage: string,
    successMessage: string,
    mutation: (repositoryRoot: string) => Promise<RepositoryMutationOutcome>,
  ): Promise<void> {
    const snapshot = this.windowSession.repository.state.snapshot;
    if (!snapshot) return;
    if (!(await this.saveDirtyTabsBefore("changing branches"))) return;
    const operation = this.repositoryOperations.start(snapshot.root, () => mutation(snapshot.root));
    const generation = operation.generation;
    this.clearError();
    let pendingRoot: string | null = null;
    let succeeded = false;
    this.setLoading(true, loadingMessage);
    this.renderBottomTool();
    try {
      const completion = await operation.completion;
      if (completion.status === "stale") return;
      if (completion.status === "failure") throw completion.error;
      const next = this.repositoryIntegration.applyMutation(completion.outcome, "gitMutation", {
        clearInclusion: true,
        clearSelection: true,
      });
      this.captureMountedTextEditor();
      if (dirtyTextTabs(this.editorState.session).length === 0) {
        this.editorController.resetSession();
      }
      this.renderWorkspace();
      this.loadVisibleCommitDetails();
      void this.loadProjectFiles(next.root, generation);
      pendingRoot = next.root;
      succeeded = true;
    } catch (error) {
      if (generation !== this.windowSession.generation) return;
      this.showError(error);
    } finally {
      if (generation === this.windowSession.generation) {
        this.setLoading(false, "Ready");
        this.renderBottomTool();
        if (succeeded) this.setStatus(successMessage, "success");
      }
    }
    if (pendingRoot && generation === this.windowSession.generation) {
      void this.windowSession.scanUntracked(pendingRoot, generation, true, "gitMutation");
    }
  }

  private reconcileWorkingDocument(snapshot: RepositorySnapshot): void {
    const document = this.activeDocument();
    if (document.kind !== "working-diff") return;
    const stillValid = snapshot.changes.some(
      (change) => change.path === document.selection.path,
    );
    if (stillValid) {
      this.clearWorkingDiff();
      this.loadSelectedDiff();
      return;
    }
    const replacement =
      this.changesState.selectedChange?.path === document.selection.path
        ? this.changesState.selectedChange
        : null;
    if (replacement) {
      this.activateDiffPreview({
        kind: "working-diff",
        repositoryRoot: snapshot.root,
        selection: { ...replacement },
      });
      this.clearWorkingDiff();
      this.loadSelectedDiff();
      return;
    }
    this.editorController.closePreview();
    this.clearWorkingDiff();
  }

  private renderStatus(snapshot: RepositorySnapshot | null): void {
    if (!snapshot) {
      this.query("#branch-status").innerHTML = `${icon("folder", 14)}<span>Folder</span><span class="sync-status">Git unavailable</span>`;
      return;
    }
    const branch = snapshot.branch;
    const label = branch.detached
      ? `Detached at ${branch.oid?.slice(0, 8) ?? "unknown"}`
      : branch.head ?? "No branch";
    const sync = [
      branch.ahead ? `↑${branch.ahead}` : "",
      branch.behind ? `↓${branch.behind}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    this.query("#branch-status").innerHTML = `${icon("branch", 14)}<span>${escapeHtml(label)}</span>${sync ? `<span class="sync-status">${sync}</span>` : ""}${snapshot.operation ? `<span class="operation-status">${escapeHtml(snapshot.operation)}</span>` : ""}`;
  }

  private setLoading(loading: boolean, message: string): void {
    this.state.loading = loading;
    this.editorSurface.setReadOnly(loading);
    this.root.classList.toggle("is-busy", loading);
    this.query<HTMLButtonElement>("#refresh-button").disabled =
      loading || !this.windowSession.workspace.state.root;
    this.renderRemoteToolbar(this.windowSession.repository.state.snapshot);
    this.setStatus(message, loading ? "busy" : "normal");
  }

  private setStatus(
    message: string,
    kind: "normal" | "busy" | "warning" | "success",
  ): void {
    this.query("#status-message").textContent = message;
    this.query("#status-indicator").className = `status-indicator ${kind}`;
  }

  private showError(error: unknown): void {
    const message = errorMessage(error);
    this.state.error = message;
    this.query("#toast-message").textContent = message;
    this.query("#toast").classList.remove("hidden");
    this.setStatus("Operation failed", "warning");
  }

  private clearError(): void {
    this.state.error = null;
    this.query("#toast").classList.add("hidden");
  }

  private async chooseRepository(): Promise<void> {
    if (this.repositoryChooserOpen || this.state.loading) return;
    this.repositoryChooserOpen = true;
    const switcher = this.query<HTMLButtonElement>("#repository-switcher");
    switcher.disabled = true;
    try {
      const choice = await bridge.chooseRepositoryDirectory(
        this.windowSession.workspace.state.root,
      );
      if (choice.kind === "selected") {
        await this.requestRepositoryTarget(choice.path);
      } else if (choice.kind === "unsupported") {
        this.openRepositoryDialog();
      }
    } catch (error) {
      this.showError(error);
    } finally {
      this.repositoryChooserOpen = false;
      switcher.disabled = false;
    }
  }

  private async requestRepositoryTarget(path: string): Promise<void> {
    this.closeRepositoryDialog();
    const currentRoot = this.windowSession.workspace.state.root;
    if (!currentRoot || currentRoot === path) {
      await this.openRepository(path);
      return;
    }
    this.repositoryTargetPath = path;
    this.query("#repository-target-path").textContent = path;
    this.query("#repository-target-dialog").classList.remove("hidden");
    window.setTimeout(
      () => this.query<HTMLButtonElement>("#repository-target-new").focus(),
      0,
    );
  }

  private async openRepositoryInNewWindow(path: string): Promise<void> {
    try {
      await bridge.openRepositoryWindow(path);
      this.setStatus("Project opened in a new window", "success");
    } catch (error) {
      this.showError(error);
    }
  }

  private takeRepositoryTargetPath(): string | null {
    const path = this.repositoryTargetPath;
    this.closeRepositoryTargetDialog();
    return path;
  }

  private closeRepositoryTargetDialog(): void {
    this.repositoryTargetPath = null;
    this.query("#repository-target-dialog").classList.add("hidden");
    this.query<HTMLButtonElement>("#repository-switcher").focus();
  }

  private openRepositoryDialog(path = ""): void {
    const dialog = this.query("#repository-dialog");
    const input = this.query<HTMLInputElement>("#repository-input");
    input.value = path || this.windowSession.workspace.state.root || "";
    dialog.classList.remove("hidden");
    window.setTimeout(() => input.focus(), 0);
  }

  private closeRepositoryDialog(): void {
    if (!this.windowSession.workspace.state.root && !bridge.isDemo) return;
    this.query("#repository-dialog").classList.add("hidden");
  }

  private branchSafety(snapshot: RepositorySnapshot): {
    ready: boolean;
    message: string;
    blockers: string[];
  } {
    const blockers = snapshot.changes.map((change) => change.path);
    if (blockers.length > 0) {
      return {
        ready: false,
        message: `${blockers.length} changed ${blockers.length === 1 ? "path blocks" : "paths block"} branch mutation. Commit, stash, or remove the changes first.`,
        blockers,
      };
    }
    if (snapshot.untrackedState === "pending") {
      return {
        ready: false,
        message: "Checking for untracked files before branch mutation…",
        blockers: [],
      };
    }
    if (snapshot.untrackedState === "failed") {
      return {
        ready: false,
        message: "The untracked-file check failed. Refresh before changing branches.",
        blockers: [],
      };
    }
    return {
      ready: true,
      message: "The index and working tree are clean. Asterlyn will verify again immediately before switching.",
      blockers: [],
    };
  }

  private bindBranchInspector(
    branch: BranchSummary,
    snapshot: RepositorySnapshot,
  ): void {
    this.root.querySelector<HTMLButtonElement>("#checkout-branch")?.addEventListener(
      "click",
      () => void this.switchBranch(branch),
    );
    const input = this.root.querySelector<HTMLInputElement>("#new-branch-name");
    const button = this.root.querySelector<HTMLButtonElement>("#create-branch-button");
    input?.addEventListener("input", () => {
      this.state.newBranchName = input.value;
      if (button) {
        button.disabled =
          !this.branchSafety(snapshot).ready ||
          input.value.trim().length === 0 ||
          this.state.loading;
      }
    });
    this.root.querySelector<HTMLFormElement>("#create-branch-form")?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        if (!button?.disabled) void this.createBranch();
      },
    );
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing application element: ${selector}`);
    return element;
  }
}

function commitFileDirectoryPaths(nodes: readonly CommitFileTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path, ...commitFileDirectoryPaths(node.children));
  }
  return paths;
}

function loadCommitFileView(storage: Pick<Storage, "getItem">): CommitFileView {
  try {
    return storage.getItem(COMMIT_FILE_VIEW_KEY) === "flat" ? "flat" : "tree";
  } catch {
    return "tree";
  }
}

function saveCommitFileView(
  storage: Pick<Storage, "setItem">,
  view: CommitFileView,
): void {
  try {
    storage.setItem(COMMIT_FILE_VIEW_KEY, view);
  } catch {
    // A denied preference write must not affect commit inspection.
  }
}

function loadChangeFileView(storage: Pick<Storage, "getItem">): ChangeFileView {
  try {
    return storage.getItem(CHANGE_FILE_VIEW_KEY) === "flat" ? "flat" : "tree";
  } catch {
    return "tree";
  }
}

function saveChangeFileView(
  storage: Pick<Storage, "setItem">,
  view: ChangeFileView,
): void {
  try {
    storage.setItem(CHANGE_FILE_VIEW_KEY, view);
  } catch {
    // This display preference is optional and never contains repository truth.
  }
}

function selectedCommit(
  commits: CommitSummary[],
  key: string | null,
): CommitSummary | null {
  return commits.find((commit) => commitKey(commit) === key) ?? commits[0] ?? null;
}

function selectedBranch(
  snapshot: RepositorySnapshot,
  key: string | null,
): BranchSummary | null {
  if (!key) return null;
  return snapshot.branches.find((branch) => branchKey(branch) === key) ?? null;
}

function historyReference(
  branch: Pick<BranchSummary, "repositoryId" | "fullName">,
): HistoryRef {
  return { repositoryId: branch.repositoryId, fullName: branch.fullName };
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
  return normalized.split("/").pop() || normalized;
}

function projectMonogram(path: string): string {
  const name = basename(path).trim();
  return (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "P").toLocaleUpperCase();
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function remoteActionLabel(kind: "fetch" | "pull" | "push"): string {
  return kind === "pull" ? "Update" : capitalize(kind);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    if (value.kind === "remoteCancelled") {
      if (value.remoteStateMayHaveChanged === true) {
        return "Push cancellation was requested. The remote outcome is unknown; fetch before retrying.";
      }
      return value.repositoryStateMayHaveChanged === true
        ? "Remote operation was cancelled. Repository refs or files may have changed; the view was refreshed."
        : "Remote operation was cancelled.";
    }
    if (value.kind === "remoteFailed") {
      const reason = typeof value.reason === "string" ? value.reason : "unknown";
      const fallback =
        "The remote operation failed without exposing child-process output. Check Git configuration and retry.";
      const messages: Record<string, string> = {
        authentication:
          "Authentication was unavailable. Configure a non-interactive Git credential helper or SSH agent, then retry.",
        network: "The remote could not be reached. Check the network and remote configuration.",
        rejected: "The remote rejected the update. Fetch and review the branch state before retrying.",
        unknown: fallback,
      };
      return messages[reason] ?? fallback;
    }
    if (value.kind === "conflict") {
      return "This file changed outside Asterlyn. Your local buffer is still open and was not overwritten.";
    }
    const message = typeof value.message === "string" ? value.message : null;
    const operation = typeof value.operation === "string" ? value.operation : null;
    if (message && operation) return `${operation}: ${message}`;
    if (message) return message;
  }
  return "An unexpected operation error occurred.";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
