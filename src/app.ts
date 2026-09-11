import { bridge } from "./bridge";
import { BRAND } from "./brand";
import { DiffEditor } from "./diff-editor";
import { TextEditor } from "./text-editor";
import { fileTypeIcon } from "./file-icons";
import { icon } from "./icons";
import { preferredRemote, remotePolicy } from "./remote-policy";
import { windowControls } from "./window-controls";
import type { DiffLayout, DiffPresentation } from "./diff-presentation";
import {
  editorDocumentKey,
  editorDocumentContentKey,
  type EditorDocument,
  type ProjectFileDocument,
} from "./workbench/editor-document";
import {
  activatePreview,
  activateTextTab,
  activateWelcome,
  activeEditorDocument,
  activeTextTab,
  beginTextReload,
  beginTextSave,
  captureTextContent,
  closePreview,
  closeTextTab,
  completeTextLoad,
  completeTextSave,
  createEditorSession,
  dirtyTextTabs,
  failTextLoad,
  failTextSave,
  isTextTabDirty,
  markTextEdited,
  openTextDocument,
  setTextTabMarkdownMode,
  textTab,
  type EditorSession,
  type MarkdownEditorMode,
  type TextTabState,
} from "./workbench/editor-session";
import {
  WORKBENCH_LAYOUT_DEFAULTS,
  WORKBENCH_LIMITS,
  clampWorkbenchLayout,
  loadWorkbenchLayout,
  reduceWorkbenchLayout,
  saveWorkbenchLayout,
  type WorkbenchLayout,
} from "./workbench/layout-state";
import { attachSplitter } from "./workbench/splitter";
import {
  MARKDOWN_PREVIEW_MAX_BYTES,
  isMarkdownPath,
  renderMarkdownPreview,
} from "./workbench/markdown-preview";
import { revealTabInStrip, scrollTabStrip } from "./workbench/tab-strip";
import {
  showCustomWindowControls,
  windowChromeClass,
  type WindowChromeMode,
} from "./workbench/window-chrome";
import {
  EDITOR_FONTS,
  DEFAULT_EDITOR_FONT_ID,
  EditorFontLoader,
  editorFont,
  editorFontFamilyStack,
  editorFontOptionLabel,
  isEditorFontId,
  type EditorFontId,
  type EditorFontLoadSource,
} from "./workbench/editor-fonts";
import {
  EDITOR_INDENT_SIZES,
  EDITOR_LETTER_SPACINGS,
  EDITOR_FONT_SIZES,
  EDITOR_LINE_HEIGHTS,
  EDITOR_TAB_SIZES,
  UI_FONT_SIZES,
  loadAppPreferences,
  saveAppPreferences,
  updateAppPreferences,
  type AppPreferences,
} from "./workbench/preferences";
import {
  loadRecentRepositories,
  restoreRecentRepository,
  touchRecentRepository,
} from "./workbench/startup-repository";
import {
  beginHistoryQuery,
  completeRefHistory,
  emptyRefHistory,
  failRefHistory,
  installSnapshotHistory,
  type RefHistoryRequest,
  type RefHistoryState,
} from "./workbench/ref-history";
import {
  defaultHistoryQuery,
  filterHistoryText,
  historyAuthorChoices,
  historyDateSince,
  historyQueryKey,
  isSnapshotHistoryQuery,
  normalizeHistoryQuery,
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
import {
  effectiveHistoryRootIds,
  toggleHistoryRootSelection,
} from "./workbench/history-root-selection";
import {
  appendHistoryPage,
  matchesHistoryPageRequest,
  replaceHistoryPage,
} from "./workbench/history-paging";
import {
  loadHistoryRefPreferences,
  saveHistoryRefPreferences,
  toggleFavoriteRef,
  touchRecentRef,
} from "./workbench/history-preferences";
import {
  collapseLinearHistory,
  type HistoryDisplayEntry,
} from "./workbench/history-collapse";
import {
  ancestorProjectDirectories,
  buildProjectTree,
  defaultExpandedProjectDirectories,
  descendantProjectDirectories,
  findProjectTreeNode,
  projectTreeEntries,
  reconcileProjectTreeState,
  type ProjectTreeNode,
  type ProjectTreeSelection,
} from "./workbench/project-tree";
import {
  clampCommandSurfaceSelection,
  closeCommandSurface,
  createCommandSurfaceState,
  loadRecentFiles,
  moveCommandSurfaceSelection,
  openCommandSurface,
  rankCommands,
  rankProjectFiles,
  touchRecentFile,
  updateCommandSurfaceQuery,
  type CommandSurfaceState,
  type NavigationCommand,
  type NavigationMode,
} from "./workbench/navigation";
import { evaluateSearchNavigation } from "./workbench/search-navigation";
import {
  beginWorkspaceSearch,
  completeWorkspaceSearch,
  createWorkspaceSearchControls,
  createWorkspaceSearchState,
  failWorkspaceSearch,
  formatWorkspaceSearchCoverage,
  invalidateWorkspaceSearch,
  sameWorkspaceSearchOptions,
  workspaceSearchOptions,
  type WorkspaceSearchControls,
  type WorkspaceSearchState,
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
  type WorkspaceReplacementState,
} from "./workbench/workspace-replacement";
import {
  buildCommitFileTree,
  commitReferences,
  groupRemoteBranches,
  matchingLogicalBranches,
  projectCommitGraph,
  uniqueLogicalBranches,
  type CommitGraphRow,
  type CommitGraphSegment,
  type CommitFileTreeNode,
  type CommitFileView,
  type CommitReference,
} from "./workbench/git-presentation";
import type {
  BranchSummary,
  ChangeKind,
  ChangeSelection,
  CommitDetails,
  CommitDiffResult,
  CommitFileChange,
  CommitSummary,
  DiffResult,
  FileChange,
  GitRootDescriptor,
  HistoryPath,
  HistoryQuery,
  HistoryRef,
  ProjectFile,
  ProjectIgnoredEntry,
  ReplacementApplyResult,
  RepositorySnapshot,
  WorkspaceTextSearchMatch,
  ReplacementRecoverySummary,
} from "./models";

const COMMIT_FILE_VIEW_KEY = "asterlyn.commitFileView.v1";
const HISTORY_PAGE_SIZE = 150;
const HISTORY_ROW_LIMIT = 3_000;
const HISTORY_SCROLL_THRESHOLD = 72;
const RECENT_FILE_KEY = "asterlyn.recentFiles.v1";

type HistoryFilterMenu = "branch" | "user" | "date" | "paths" | "graph";
type SettingsSection = "general" | "appearance" | "editor" | "version-control" | "code";

interface AppState {
  snapshot: RepositorySnapshot | null;
  activePage: "workbench" | "settings";
  settingsSection: SettingsSection;
  preferences: AppPreferences;
  layout: WorkbenchLayout;
  editor: EditorSession;
  gitDetail: "branch" | "commit";
  projectFiles: string[];
  repositoryFiles: ProjectFile[];
  ignoredProjectEntries: ProjectIgnoredEntry[];
  projectFilesLoading: boolean;
  projectFilesError: string | null;
  projectFilesTruncated: boolean;
  projectTreeRoot: string | null;
  projectTreeSelection: ProjectTreeSelection | null;
  expandedProjectDirectories: Set<string>;
  commandSurface: CommandSurfaceState;
  workspaceSearch: WorkspaceSearchState;
  workspaceSearchControls: WorkspaceSearchControls;
  workspaceReplacement: WorkspaceReplacementState;
  replacementText: string;
  replacementDialog: "preview" | "recovery" | null;
  replacementRecoveryBusy: { id: string; action: "keep" | "rollback" } | null;
  selectedChange: ChangeSelection | null;
  selectedChangeKeys: Set<string>;
  changeQuery: string;
  selectedCommit: string | null;
  historyQuery: string;
  historyCaseSensitive: boolean;
  historyRegularExpression: boolean;
  historyRefs: Map<string, HistoryRef>;
  historyAuthorEmails: Set<string>;
  historyCurrentAuthor: boolean;
  historyDatePreset: HistoryDatePreset;
  historySinceEpoch: number | null;
  historyPaths: Map<string, HistoryPath>;
  historyRepositoryIds: Set<string>;
  historyRecentPaths: HistoryPath[];
  historyOrder: HistoryQuery["order"];
  historyFirstParent: boolean;
  historyExcludeMerges: boolean;
  historyCollapseLinear: boolean;
  historyFilterMenu: HistoryFilterMenu | null;
  historyBranchSubmenu: string | null;
  historyFavoriteRefs: Map<string, HistoryRef>;
  historyRecentRefs: HistoryRef[];
  historyDialog: "branches" | "paths-text" | "paths-tree" | null;
  historyDialogQuery: string;
  historyDialogError: string | null;
  historyRefDraft: Map<string, HistoryRef>;
  historyPathDraft: Map<string, HistoryPath>;
  historyPathText: string;
  historyTreeCollapsed: Set<string>;
  branchQuery: string;
  history: RefHistoryState;
  historyHasMore: boolean;
  historyNextOffset: number;
  historyLoadingMore: boolean;
  historyRefreshing: boolean;
  historyPagingError: string | null;
  historyPagingRetry: "append" | "refresh" | null;
  selectedCommitFile: string | null;
  commitFileView: CommitFileView;
  commitDetails: CommitDetails | null;
  commitDetailsLoading: boolean;
  commitDetailsError: string | null;
  commitPatch: CommitDiffResult | null;
  commitPatchLoading: boolean;
  commitPatchError: string | null;
  commitPatchVersion: number;
  workingPatch: DiffResult | null;
  workingPatchLoading: boolean;
  workingPatchError: string | null;
  workingPatchVersion: number;
  selectedBranch: string | null;
  collapsedBranchGroups: Set<BranchSummary["kind"]>;
  newBranchName: string;
  syncPopoverOpen: boolean;
  selectedRemote: string | null;
  remoteOperation: {
    id: string;
    root: string;
    kind: "fetch" | "pull" | "push";
    cancelling: boolean;
  } | null;
  commitMessage: string;
  loading: boolean;
  error: string | null;
}

export class AsterlynApp {
  private readonly diffEditor = new DiffEditor();
  private readonly textEditor = new TextEditor();
  private readonly editorFontLoader = new EditorFontLoader(window.localStorage);
  private readonly state: AppState = {
    snapshot: null,
    activePage: "workbench",
    settingsSection: "general",
    preferences: loadAppPreferences(window.localStorage),
    layout: loadWorkbenchLayout(window.localStorage),
    editor: createEditorSession(),
    gitDetail: "commit",
    projectFiles: [],
    repositoryFiles: [],
    ignoredProjectEntries: [],
    projectFilesLoading: false,
    projectFilesError: null,
    projectFilesTruncated: false,
    projectTreeRoot: null,
    projectTreeSelection: null,
    expandedProjectDirectories: new Set(),
    commandSurface: createCommandSurfaceState(),
    workspaceSearch: createWorkspaceSearchState(),
    workspaceSearchControls: createWorkspaceSearchControls(),
    workspaceReplacement: createWorkspaceReplacementState(),
    replacementText: "",
    replacementDialog: null,
    replacementRecoveryBusy: null,
    selectedChange: null,
    selectedChangeKeys: new Set(),
    changeQuery: "",
    selectedCommit: null,
    historyQuery: "",
    historyCaseSensitive: false,
    historyRegularExpression: false,
    historyRefs: new Map(),
    historyAuthorEmails: new Set(),
    historyCurrentAuthor: false,
    historyDatePreset: "all",
    historySinceEpoch: null,
    historyPaths: new Map(),
    historyRepositoryIds: new Set(),
    historyRecentPaths: [],
    historyOrder: "topological",
    historyFirstParent: false,
    historyExcludeMerges: false,
    historyCollapseLinear: false,
    historyFilterMenu: null,
    historyBranchSubmenu: null,
    historyFavoriteRefs: new Map(),
    historyRecentRefs: [],
    historyDialog: null,
    historyDialogQuery: "",
    historyDialogError: null,
    historyRefDraft: new Map(),
    historyPathDraft: new Map(),
    historyPathText: "",
    historyTreeCollapsed: new Set(),
    branchQuery: "",
    history: emptyRefHistory(),
    historyHasMore: false,
    historyNextOffset: 0,
    historyLoadingMore: false,
    historyRefreshing: false,
    historyPagingError: null,
    historyPagingRetry: null,
    selectedCommitFile: null,
    commitFileView: loadCommitFileView(window.localStorage),
    commitDetails: null,
    commitDetailsLoading: false,
    commitDetailsError: null,
    commitPatch: null,
    commitPatchLoading: false,
    commitPatchError: null,
    commitPatchVersion: 0,
    workingPatch: null,
    workingPatchLoading: false,
    workingPatchError: null,
    workingPatchVersion: 0,
    selectedBranch: null,
    collapsedBranchGroups: new Set(),
    newBranchName: "",
    syncPopoverOpen: false,
    selectedRemote: null,
    remoteOperation: null,
    commitMessage: "",
    loading: false,
    error: null,
  };
  private requestGeneration = 0;
  private editorFontRequestGeneration = 0;
  private editorFontStatus: {
    id: EditorFontId | null;
    kind: "idle" | "loading" | "ready" | "error";
    source?: EditorFontLoadSource;
    message?: string;
  } = { id: null, kind: "idle" };
  private diffGeneration = 0;
  private commitDetailsGeneration = 0;
  private commitDiffGeneration = 0;
  private changeSelectionAnchor: string | null = null;
  private scanSequence = 0;
  private remoteOperationSequence = 0;
  private projectFilesGeneration = 0;
  private historyPageSequence = 0;
  private historyTopRefreshArmed = false;
  private historyTopRefreshAt = 0;
  private mountedEditorKey: string | null = null;
  private mountedTextTabId: string | null = null;
  private lastRenderedEditorDocumentKey: string | null = null;
  private editorTabMenuOpen = false;
  private repositoryMenuOpen = false;
  private markdownSourcePercent = 50;
  private markdownSplitterDisposer: (() => void) | null = null;
  private markdownScrollDisposer: (() => void) | null = null;
  private markdownPreviewTimer: number | null = null;
  private markdownPreviewSequence = 0;
  private markdownPreviewPending: {
    tabId: string;
    content: string;
    request: number;
  } | null = null;
  private textSaveSequence = 0;
  private workspaceSearchSequence = 0;
  private workspaceReplacementSequence = 0;
  private commandSurfaceReturnFocus: HTMLElement | null = null;
  private repositoryChooserOpen = false;
  private repositoryTargetPath: string | null = null;
  private windowChromeMode: WindowChromeMode = "custom-right";
  private splitterDisposers: Array<() => void> = [];
  private commitDetailSplitterDisposer: (() => void) | null = null;
  private workspaceResizeObserver: ResizeObserver | null = null;
  private editorMeasureFrame: number | null = null;
  private projectTreeCache: {
    files: ProjectFile[];
    changes: FileChange[];
    ignoredEntries: ProjectIgnoredEntry[];
    nodes: ProjectTreeNode[];
  } | null = null;
  private activeUntrackedScan: {
    id: string;
    generation: number;
    root: string;
  } | null = null;

  constructor(private readonly root: HTMLElement) {}

  async start(): Promise<void> {
    this.windowChromeMode = await bridge.windowChromeMode();
    this.renderShell();
    this.applyAppPreferences();
    this.bindShellEvents();
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
    this.root.innerHTML = `
      <main class="app-shell ${windowChromeClass(this.windowChromeMode)}">
        <header class="topbar" data-tauri-drag-region>
          <div class="repository-switcher-anchor" id="repository-switcher-anchor">
            <button class="repository-switcher" id="repository-switcher" type="button" aria-label="Project menu" aria-haspopup="menu" aria-controls="repository-menu" aria-expanded="false" title="Open a project">
              <span class="repository-name" id="repository-name">No project</span>
              ${icon("chevron-down", 13)}
            </button>
            <div class="repository-menu hidden" id="repository-menu" role="menu" aria-label="Project menu"></div>
          </div>
          <div class="topbar-actions" data-tauri-drag-region>
            <span class="demo-badge ${bridge.isDemo ? "" : "hidden"}">Browser demo</span>
            <button class="command-center-button" id="command-center-button" type="button" aria-label="Search files and commands" title="Search files and commands (Ctrl/Cmd+P)">
              ${icon("search", 18)}
              <span>Search</span>
              <kbd>Ctrl P</kbd>
            </button>
            <div class="sync-anchor" id="sync-anchor">
              <button class="icon-button sync-button" id="sync-button" type="button" aria-label="Remote sync" title="Remote sync" aria-haspopup="dialog" aria-expanded="false">
                ${icon("sync", 20)}
                <span class="sync-badge hidden" id="sync-badge"></span>
              </button>
              <section class="sync-popover hidden" id="sync-popover" role="dialog" aria-label="Remote sync"></section>
            </div>
            <button class="icon-button" id="refresh-button" type="button" aria-label="Refresh repository" title="Refresh (Ctrl/Cmd+R)">
              ${icon("refresh", 20)}
            </button>
            <button class="icon-button" id="settings-button" type="button" aria-label="Open settings" title="Settings" aria-pressed="false">
              ${icon("settings", 20)}
            </button>
            <div class="window-controls ${showCustomWindowControls(this.windowChromeMode, windowControls.available) ? "" : "hidden"}" role="group" aria-label="Window controls">
              <button class="window-control-button" id="window-minimize" type="button" aria-label="Minimize window" title="Minimize">
                ${icon("minimize", 16)}
              </button>
              <button class="window-control-button" id="window-maximize" type="button" aria-label="Maximize window" title="Maximize">
                ${icon("maximize", 16)}
              </button>
              <button class="window-control-button close" id="window-close" type="button" aria-label="Close window" title="Close">
                ${icon("close", 16)}
              </button>
            </div>
          </div>
        </header>

        <div class="workspace" id="workspace">
          <nav class="activity-rail" aria-label="Tool windows">
            ${this.activityButton("files", "Files", "folder")}
            ${this.activityButton("branches", "Branches", "branch")}
            ${this.activityButton("changes", "Changes", "changes")}
            <span class="rail-spacer"></span>
            <span class="rail-version" aria-label="${BRAND.name} version ${BRAND.version}">${BRAND.version}</span>
          </nav>

          <section class="workbench" id="workbench">
            <div class="editor-row" id="editor-row">
              <aside class="navigator tool-window" id="left-tool" aria-label="Left tool window">
                <div class="panel-header">
                  <div class="navigator-title-group">
                    <h1 id="navigator-title">Files</h1>
                    <span class="panel-count" id="navigator-count">0</span>
                  </div>
                  <div class="navigator-header-actions">
                    <div class="navigator-context-actions" id="navigator-actions"></div>
                    <button class="compact-icon-button tool-window-hide" id="hide-left-tool" type="button" aria-label="Hide Files tool window" title="Hide Files tool window">
                      ${icon("close", 14)}
                    </button>
                  </div>
                </div>
                <div class="navigator-body" id="navigator-body">
                  ${this.loadingBlock("Waiting for a repository")}
                </div>
              </aside>

              <div class="workbench-splitter vertical" id="left-splitter" aria-label="Resize left tool window"></div>

              <section class="content-panel editor-panel" id="editor-panel" aria-label="Editor">
                <div class="editor-tabbar-shell">
                  <div class="editor-tabbar" id="editor-tabbar">
                    <span class="editor-tab active">Welcome</span>
                  </div>
                  <div class="editor-context-actions" id="editor-context-actions"></div>
                  <div class="editor-tab-menu-anchor" id="editor-tab-menu-anchor">
                    <button class="editor-tab-menu-toggle" id="editor-tab-menu-toggle" type="button" aria-label="Show open files" title="Show open files" aria-haspopup="menu" aria-expanded="false" disabled>
                      ${icon("chevron-down", 15)}
                    </button>
                    <div class="editor-tab-menu hidden" id="editor-tab-menu" role="menu" aria-label="Open files"></div>
                  </div>
                </div>
                <div class="content-header" id="content-header">
                  <div class="content-title-group">
                    <span class="content-kicker">Welcome</span>
                    <h2>${BRAND.name} Editor</h2>
                  </div>
                </div>
                <div class="content-body" id="content-body">
                  ${this.emptyState("Open a repository", "Use Files, Branches, and Changes without replacing the editor.", "folder")}
                </div>
              </section>
            </div>

            <div class="workbench-splitter horizontal" id="bottom-splitter" aria-label="Resize Git tool window"></div>

            <section class="bottom-tool tool-window" id="bottom-tool" aria-label="Branches and Git log">
              <div class="bottom-tool-header">
                <strong>Git</strong>
                <span>Branches and Log</span>
                <button class="bottom-tool-hide" id="hide-git-tool" type="button" aria-label="Hide Git tool window" title="Hide Git tool window">
                  ${icon("close", 14)}
                </button>
              </div>
              <div class="git-tool-grid" id="git-tool-grid">
                <section class="git-tool-pane branch-tree-pane" aria-label="Branches">
                  <div class="git-pane-body" id="branch-navigation-body"></div>
                </section>
                <div class="workbench-splitter vertical" id="branch-tree-splitter" aria-label="Resize branch tree"></div>
                <section class="git-tool-pane commit-log-pane" aria-label="Commit log">
                  <div class="git-pane-body" id="history-navigation-body"></div>
                </section>
                <div class="workbench-splitter vertical" id="branch-details-splitter" aria-label="Resize Git details"></div>
                <aside class="git-tool-pane git-details-pane" aria-label="Git details">
                  <div class="git-pane-body" id="git-detail-body">${this.inspectorPlaceholder()}</div>
                </aside>
              </div>
            </section>
          </section>

          <section class="settings-page hidden" id="settings-page" aria-labelledby="settings-page-title">
            <header class="settings-page-header">
              <button class="icon-button" id="settings-back" type="button" aria-label="Return to workbench" title="Back to workbench">${icon("back", 17)}</button>
              <h1 id="settings-page-title">Settings</h1>
            </header>
            <div class="settings-page-layout">
              <nav class="settings-navigation" id="settings-navigation" aria-label="Settings groups"></nav>
              <div class="settings-content" id="settings-content"></div>
            </div>
          </section>
        </div>

        <footer class="statusbar">
          <div class="status-left">
            <span class="status-indicator" id="status-indicator"></span>
            <span id="status-message">Ready</span>
          </div>
          <div class="status-right">
            <span class="document-encoding hidden" id="document-encoding" aria-label="Current file encoding"></span>
            <div class="branch-status" id="branch-status"></div>
          </div>
        </footer>

        <div class="toast hidden" id="toast" role="status" aria-live="polite">
          <span class="toast-icon">!</span>
          <span id="toast-message"></span>
          <button class="toast-close" id="toast-close" type="button" aria-label="Dismiss error">${icon("close", 15)}</button>
        </div>

        <div class="dialog-backdrop hidden" id="repository-dialog" role="presentation">
          <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <div class="dialog-heading">
              <div>
                <span class="panel-eyebrow">Browser demo</span>
                <h2 id="dialog-title">Simulate opening a repository</h2>
              </div>
              <button class="icon-button" id="dialog-close" type="button" aria-label="Close">${icon("close", 17)}</button>
            </div>
            <p>Enter a sample path for browser-only interaction testing. This demo does not read that folder from your computer.</p>
            <form id="repository-form">
              <label for="repository-input">Repository path</label>
              <input id="repository-input" name="path" type="text" spellcheck="false" autocomplete="off" placeholder="/path/to/project" />
              <div class="dialog-actions">
                <button class="secondary-button" id="dialog-cancel" type="button">Cancel</button>
                <button class="primary-button" type="submit">Open repository</button>
              </div>
            </form>
          </section>
        </div>

        <div class="dialog-backdrop hidden" id="repository-target-dialog" role="presentation">
          <section class="dialog repository-target-dialog" role="dialog" aria-modal="true" aria-labelledby="repository-target-title">
            <div class="dialog-heading">
              <div>
                <span class="panel-eyebrow">Open project</span>
                <h2 id="repository-target-title">Where should this project open?</h2>
              </div>
              <button class="icon-button" id="repository-target-close" type="button" aria-label="Cancel opening project">${icon("close", 18)}</button>
            </div>
            <p>The current window already contains a project. Open the selected folder here or keep this workspace and open another window.</p>
            <code class="repository-target-path" id="repository-target-path"></code>
            <div class="dialog-actions">
              <button class="secondary-button" id="repository-target-cancel" type="button">Cancel</button>
              <button class="secondary-button" id="repository-target-current" type="button">Current window</button>
              <button class="primary-button" id="repository-target-new" type="button">New window</button>
            </div>
          </section>
        </div>

        <div class="dialog-backdrop hidden history-dialog-backdrop" id="history-dialog" role="presentation"></div>
        <div class="dialog-backdrop hidden command-surface-backdrop" id="command-surface" role="presentation"></div>
        <div class="dialog-backdrop hidden replacement-dialog-backdrop" id="workspace-replacement-dialog" role="presentation"></div>
      </main>
    `;
  }

  private activityButton(
    tool: "files" | "branches" | "changes",
    label: string,
    iconName: "folder" | "changes" | "branch",
  ): string {
    const active =
      tool === "branches"
        ? this.state.layout.bottomTool === tool
        : this.state.layout.leftTool === tool;
    return `<button class="activity-button ${active ? "active" : ""}" data-tool="${tool}" type="button" aria-label="${label}" title="${label}" aria-pressed="${active}">${icon(iconName, 20)}<span>${label}</span></button>`;
  }

  private bindShellEvents(): void {
    this.query("#repository-switcher").addEventListener("click", (event) => {
      event.stopPropagation();
      this.repositoryMenuOpen = !this.repositoryMenuOpen;
      this.renderRepositoryMenu();
    });
    this.query("#sync-button").addEventListener("click", (event) => {
      event.stopPropagation();
      if (!this.state.snapshot) return;
      this.state.syncPopoverOpen = !this.state.syncPopoverOpen;
      this.renderRemotePopover(this.state.snapshot);
    });
    this.query("#refresh-button").addEventListener("click", () => void this.refresh());
    this.query("#settings-button").addEventListener("click", () => this.openSettings());
    this.query("#settings-back").addEventListener("click", () => this.closeSettings());
    this.query("#command-center-button").addEventListener("click", () => {
      this.openCommandSurface("files");
    });
    this.bindWindowControls();
    this.query("#toast-close").addEventListener("click", () => this.clearError());
    this.query("#dialog-close").addEventListener("click", () =>
      this.closeRepositoryDialog(),
    );
    this.query("#dialog-cancel").addEventListener("click", () =>
      this.closeRepositoryDialog(),
    );
    this.query("#repository-dialog").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) this.closeRepositoryDialog();
    });
    this.query("#repository-target-close").addEventListener("click", () =>
      this.closeRepositoryTargetDialog(),
    );
    this.query("#repository-target-cancel").addEventListener("click", () =>
      this.closeRepositoryTargetDialog(),
    );
    this.query("#repository-target-current").addEventListener("click", () => {
      const path = this.takeRepositoryTargetPath();
      if (path) void this.openRepository(path);
    });
    this.query("#repository-target-new").addEventListener("click", () => {
      const path = this.takeRepositoryTargetPath();
      if (path) void this.openRepositoryInNewWindow(path);
    });
    this.query("#repository-target-dialog").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) this.closeRepositoryTargetDialog();
    });
    this.query("#history-dialog").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) this.closeHistoryDialog();
    });
    this.query("#command-surface").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) this.dismissCommandSurface();
    });
    this.query("#workspace-replacement-dialog").addEventListener("click", (event) => {
      if (
        event.target === event.currentTarget &&
        this.state.workspaceReplacement.status !== "applying" &&
        !this.state.replacementRecoveryBusy
      ) {
        this.closeWorkspaceReplacementDialog();
      }
    });
    this.query<HTMLFormElement>("#repository-form").addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const path = this.query<HTMLInputElement>("#repository-input").value.trim();
        if (path) void this.requestRepositoryTarget(path);
      },
    );
    const editorTabbar = this.query<HTMLElement>("#editor-tabbar");
    editorTabbar.addEventListener(
      "wheel",
      (event) => {
        if (scrollTabStrip(editorTabbar, event.deltaX, event.deltaY)) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
    this.query("#editor-tab-menu-toggle").addEventListener("click", (event) => {
      event.stopPropagation();
      if (
        this.state.editor.textTabs.length === 0 &&
        this.state.editor.preview === null
      ) {
        return;
      }
      this.editorTabMenuOpen = !this.editorTabMenuOpen;
      this.renderEditorTabMenu();
      this.bindEditorTabMenuEvents();
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool as "files" | "branches" | "changes";
        this.toggleTool(tool);
      });
    });
    this.query("#hide-git-tool").addEventListener("click", () => {
      this.toggleTool("branches");
    });
    this.query("#hide-left-tool").addEventListener("click", () => {
      const tool = this.state.layout.leftTool;
      if (tool) this.toggleTool(tool);
    });
    this.bindWorkbenchSplitters();
    this.workspaceResizeObserver = new ResizeObserver(() => {
      this.applyWorkbenchLayout(false);
    });
    this.workspaceResizeObserver.observe(this.query("#workbench"));
    window.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        this.openCommandSurface("commands");
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "f") {
        if (!this.state.snapshot) return;
        event.preventDefault();
        this.openCommandSurface("workspace");
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === "p") {
        if (!this.state.snapshot) return;
        event.preventDefault();
        this.openCommandSurface("files");
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === "e") {
        if (!this.state.snapshot) return;
        event.preventDefault();
        this.openCommandSurface("recent");
        return;
      }
      if (event.key === "Escape") {
        if (this.repositoryMenuOpen) {
          event.preventDefault();
          this.repositoryMenuOpen = false;
          this.renderRepositoryMenu();
          this.query<HTMLButtonElement>("#repository-switcher").focus();
          return;
        }
        if (this.editorTabMenuOpen) {
          event.preventDefault();
          this.editorTabMenuOpen = false;
          this.renderEditorTabMenu();
          return;
        }
        if (!this.query("#repository-target-dialog").classList.contains("hidden")) {
          event.preventDefault();
          this.closeRepositoryTargetDialog();
          return;
        }
        if (this.state.activePage === "settings") {
          event.preventDefault();
          this.closeSettings();
          return;
        }
        if (
          this.state.replacementDialog &&
          this.state.workspaceReplacement.status !== "applying" &&
          !this.state.replacementRecoveryBusy
        ) {
          event.preventDefault();
          this.closeWorkspaceReplacementDialog();
          return;
        }
        if (this.state.commandSurface.mode) {
          event.preventDefault();
          this.dismissCommandSurface();
          return;
        }
        this.closeRepositoryDialog();
        this.closeHistoryDialog();
        if (this.state.historyFilterMenu) {
          this.state.historyFilterMenu = null;
          if (this.state.layout.bottomTool === "branches") this.renderBottomTool();
        }
        if (this.state.syncPopoverOpen && !this.state.remoteOperation) {
          this.state.syncPopoverOpen = false;
          if (this.state.snapshot) this.renderRemotePopover(this.state.snapshot);
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void this.refresh();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        const tab = activeTextTab(this.state.editor);
        if (tab) {
          event.preventDefault();
          void this.saveTextTab(tab.id);
        }
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f" &&
        !this.state.commandSurface.mode &&
        !event.defaultPrevented &&
        !(event.target instanceof Element && event.target.closest(".cm-editor"))
      ) {
        event.preventDefault();
        if (
          event.target instanceof Element &&
          event.target.closest("#bottom-tool") &&
          this.state.layout.bottomTool === "branches"
        ) {
          this.focusHistoryFilter();
        } else if (this.state.layout.leftTool === "changes") {
          this.focusChangeFilter();
        } else if (activeTextTab(this.state.editor)?.status === "ready") {
          this.textEditor.openFindReplace();
        }
      }
    });
    window.addEventListener("pointerdown", (event) => {
      if (
        this.repositoryMenuOpen &&
        event.target instanceof Element &&
        !event.target.closest("#repository-switcher-anchor")
      ) {
        this.repositoryMenuOpen = false;
        this.renderRepositoryMenu();
      }
      if (
        this.editorTabMenuOpen &&
        event.target instanceof Element &&
        !event.target.closest("#editor-tab-menu-anchor")
      ) {
        this.editorTabMenuOpen = false;
        this.renderEditorTabMenu();
      }
      if (
        this.state.historyFilterMenu &&
        event.target instanceof Element &&
        !event.target.closest(".history-toolbar")
      ) {
        this.state.historyFilterMenu = null;
        if (this.state.layout.bottomTool === "branches") this.renderBottomTool();
      }
      if (
        this.state.syncPopoverOpen &&
        !this.state.remoteOperation &&
        event.target instanceof Element &&
        !event.target.closest("#sync-anchor")
      ) {
        this.state.syncPopoverOpen = false;
        if (this.state.snapshot) this.renderRemotePopover(this.state.snapshot);
      }
    });
    window.addEventListener("beforeunload", (event) => {
      this.captureMountedTextEditor();
      if (dirtyTextTabs(this.state.editor).length === 0) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  private openSettings(): void {
    if (this.state.activePage === "settings") return;
    this.captureMountedTextEditor();
    if (this.state.commandSurface.mode) this.dismissCommandSurface();
    this.closeHistoryDialog();
    this.state.syncPopoverOpen = false;
    if (this.state.snapshot) this.renderRemotePopover(this.state.snapshot);
    this.state.activePage = "settings";
    this.query("#workspace").classList.add("settings-mode");
    this.query("#workbench").classList.add("hidden");
    this.query("#settings-page").classList.remove("hidden");
    this.query("#settings-button").setAttribute("aria-pressed", "true");
    this.renderSettingsPage();
    queueMicrotask(() => this.query<HTMLButtonElement>("#settings-back").focus());
  }

  private closeSettings(): void {
    if (this.state.activePage !== "settings") return;
    this.state.activePage = "workbench";
    this.query("#workspace").classList.remove("settings-mode");
    this.query("#settings-page").classList.add("hidden");
    this.query("#workbench").classList.remove("hidden");
    this.query("#settings-button").setAttribute("aria-pressed", "false");
    this.applyWorkbenchLayout(false);
    window.requestAnimationFrame(() => {
      this.textEditor.requestMeasure();
      this.diffEditor.requestMeasure();
      this.query<HTMLButtonElement>("#settings-button").focus();
    });
  }

  private renderSettingsPage(): void {
    const sections: Array<[SettingsSection, string]> = [
      ["general", "General"],
      ["appearance", "Appearance"],
      ["editor", "Editor"],
      ["version-control", "Version Control"],
      ["code", "Code"],
    ];
    this.query("#settings-navigation").innerHTML = sections
      .map(([id, label]) => {
        const selected = this.state.settingsSection === id;
        return `<button class="settings-navigation-item ${selected ? "selected" : ""}" type="button" data-settings-section="${id}" aria-current="${selected ? "page" : "false"}">${label}</button>`;
      })
      .join("");
    this.query("#settings-content").innerHTML = this.renderSettingsSection();
    this.bindSettingsEvents();
  }

  private renderSettingsSection(): string {
    const preferences = this.state.preferences;
    switch (this.state.settingsSection) {
      case "general":
        return this.settingsGroup(
          "General",
          "Application-wide behavior with explicit support status.",
          `
            ${this.settingsRow("Application language", "English is the only complete interface language in this build.", '<span class="setting-value-pill">English · Current</span>')}
            ${this.settingsRow("简体中文", "Planned after every visible string moves into the localization catalog.", '<span class="setting-planned">Planned</span>')}
          `,
        );
      case "appearance":
        return this.settingsGroup(
          "Appearance",
          "Interface color and application-menu typography.",
          `
            ${this.settingsRow("Theme", "Dark is implemented. Light and system-following themes remain explicit future work.", '<span class="setting-value-pill">Dark · Current</span><span class="setting-planned">Light/System planned</span>')}
            ${this.settingsRow("Application menu font", "Changes navigation, toolbar, tabs, settings, and status text without scaling the editor.", this.settingsSelect("setting-ui-font", "Application menu font size", "uiFontSize", UI_FONT_SIZES, preferences.uiFontSize, (value) => `${value} px`))}
          `,
        );
      case "editor":
        return this.settingsGroup(
          "Editor",
          "Shared defaults for text editors and source-aware Diff panes.",
          `
            ${this.settingsRow("Editor font", "JetBrains Mono is included. Other fonts download only when selected, pass an integrity check, and remain cached in this profile.", this.editorFontControl())}
            ${this.settingsRow("Editor font size", "Applies immediately to text files and Diff code.", this.settingsSelect("setting-editor-font", "Editor font size", "editorFontSize", EDITOR_FONT_SIZES, preferences.editorFontSize, (value) => `${value} px`))}
            ${this.settingsRow("Line spacing", "Controls vertical code density without changing file content.", this.settingsSelect("setting-editor-line-height", "Editor line spacing", "editorLineHeight", EDITOR_LINE_HEIGHTS, preferences.editorLineHeight, (value) => value.toFixed(2)))}
            ${this.settingsRow("Letter spacing", "Adjusts horizontal spacing between code glyphs. Android Studio's editor default is represented by 0 px.", this.settingsSelect("setting-editor-letter-spacing", "Editor letter spacing", "editorLetterSpacing", EDITOR_LETTER_SPACINGS, preferences.editorLetterSpacing, (value) => value === 0 ? "Default · 0 px" : `${value > 0 ? "+" : ""}${value} px`))}
            ${this.settingsRow("Indent size", "Sets the spaces inserted for one editor indentation level.", this.settingsSelect("setting-editor-indent", "Editor indent size", "editorIndentSize", EDITOR_INDENT_SIZES, preferences.editorIndentSize, (value) => `${value} spaces`))}
            ${this.settingsRow("Tab width", "Controls the visual width of an existing tab character without rewriting content.", this.settingsSelect("setting-editor-tab", "Editor tab width", "editorTabSize", EDITOR_TAB_SIZES, preferences.editorTabSize, (value) => `${value} spaces`))}
          `,
        );
      case "version-control":
        return this.settingsGroup(
          "Version Control",
          "Defaults shared by working-tree and commit Diff views.",
          `
            ${this.settingsRow("Diff layout", "Choose the default presentation used by every Diff preview.", `<div class="setting-segmented" role="group" aria-label="Default Diff layout"><button type="button" data-setting-diff-layout="split" aria-pressed="${preferences.diffLayout === "split"}">Side by side</button><button type="button" data-setting-diff-layout="unified" aria-pressed="${preferences.diffLayout === "unified"}">Unified</button></div>`)}
            ${this.settingsRow("Whitespace", "Show spaces and tabs in Diff panes.", `<label class="setting-toggle"><input id="setting-show-whitespace" type="checkbox" ${preferences.showWhitespace ? "checked" : ""} /><span>Show whitespace characters</span></label>`)}
          `,
        );
      case "code":
        return this.settingsGroup(
          "Code",
          "Syntax and language-specific services are introduced only when their boundaries are real.",
          `
            ${this.settingsRow("Syntax highlighting", "CodeMirror language packages load on demand for editors and Diff panes.", '<span class="setting-value-pill success">Available</span>')}
            ${this.settingsRow("Per-language formatting", "Formatter choice, style profiles, and format-on-save need the future language-service boundary.", '<span class="setting-planned">Planned</span>')}
          `,
        );
    }
  }

  private settingsGroup(title: string, description: string, rows: string): string {
    return `<section class="settings-group"><header><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></header><div class="settings-list">${rows}</div></section>`;
  }

  private settingsRow(label: string, description: string, control: string): string {
    return `<div class="settings-row"><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(description)}</span></div><div class="settings-control">${control}</div></div>`;
  }

  private editorFontControl(): string {
    const selected =
      this.editorFontStatus.kind === "loading" && this.editorFontStatus.id
        ? this.editorFontStatus.id
        : this.state.preferences.editorFontFamily;
    const status = this.editorFontStatus;
    let message = "Included with Asterlyn";
    let statusClass = "";
    if (status.kind === "loading" && status.id) {
      message = `Downloading and verifying ${editorFont(status.id).label}…`;
      statusClass = "loading";
    } else if (status.kind === "error" && status.message) {
      message = status.message;
      statusClass = "error";
    } else if (status.kind === "ready" && status.id !== DEFAULT_EDITOR_FONT_ID) {
      message =
        status.source === "download"
          ? "Downloaded, verified, and cached"
          : status.source === "download-uncached"
            ? "Loaded for this window; local cache is unavailable"
          : status.source === "cache"
            ? "Loaded from verified local cache"
            : "Ready in this window";
      statusClass = "success";
    }
    const retry =
      status.kind === "error" && status.id
        ? `<button class="setting-retry-button" id="setting-editor-font-retry" type="button">Retry ${escapeHtml(editorFont(status.id).label)}</button>`
        : "";
    return `<div class="editor-font-setting"><select id="setting-editor-font-family" aria-label="Editor font family" aria-describedby="setting-editor-font-status">${EDITOR_FONTS.map((definition) => `<option value="${definition.id}" ${definition.id === selected ? "selected" : ""}>${escapeHtml(editorFontOptionLabel(definition))}</option>`).join("")}</select><span class="editor-font-status ${statusClass}" id="setting-editor-font-status" role="status">${escapeHtml(message)}</span>${retry}</div>`;
  }

  private settingsSelect(
    id: string,
    ariaLabel: string,
    field: keyof Pick<
      AppPreferences,
      | "uiFontSize"
      | "editorFontSize"
      | "editorLineHeight"
      | "editorLetterSpacing"
      | "editorIndentSize"
      | "editorTabSize"
    >,
    values: readonly number[],
    selected: number,
    label: (value: number) => string,
  ): string {
    return `<select id="${id}" data-setting-number="${field}" aria-label="${escapeAttribute(ariaLabel)}">${values.map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label(value))}</option>`).join("")}</select>`;
  }

  private bindSettingsEvents(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-settings-section]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const section = button.dataset.settingsSection as SettingsSection;
          this.state.settingsSection = section;
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
    const previous = this.state.preferences;
    const next = updateAppPreferences(previous, patch);
    this.state.preferences = next;
    try {
      saveAppPreferences(window.localStorage, next);
    } catch (error) {
      this.showError(error);
    }
    this.applyAppPreferences();
    if (
      previous.diffLayout !== next.diffLayout ||
      previous.showWhitespace !== next.showWhitespace
    ) {
      this.diffEditor.setPresentation(this.diffPresentation());
      this.syncDiffControls();
    }
    if (this.state.activePage === "settings") {
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
    const requestedFont = this.state.preferences.editorFontFamily;
    const effectiveFont = this.editorFontLoader.isLoaded(requestedFont)
      ? requestedFont
      : DEFAULT_EDITOR_FONT_ID;
    document.documentElement.style.setProperty(
      "--editor-font-family",
      editorFontFamilyStack(effectiveFont),
    );
    this.query(".app-shell").style.setProperty(
      "--ui-font-size",
      `${this.state.preferences.uiFontSize}px`,
    );
    this.textEditor.setPreferences(this.state.preferences);
    this.diffEditor.setPreferences(this.state.preferences);
  }

  private async activateConfiguredEditorFont(): Promise<void> {
    const id = this.state.preferences.editorFontFamily;
    const request = ++this.editorFontRequestGeneration;
    this.editorFontStatus = { id, kind: "loading" };
    try {
      const source = await this.editorFontLoader.load(id);
      if (request !== this.editorFontRequestGeneration) return;
      this.editorFontStatus = { id, kind: "ready", source };
      this.applyAppPreferences();
      if (this.state.activePage === "settings") this.renderSettingsPage();
    } catch (error) {
      if (request !== this.editorFontRequestGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      this.editorFontStatus = { id, kind: "error", message };
      this.applyAppPreferences();
      if (this.state.activePage === "settings") this.renderSettingsPage();
      this.showError(error);
    }
  }

  private async selectEditorFont(id: EditorFontId): Promise<void> {
    const request = ++this.editorFontRequestGeneration;
    this.editorFontStatus = { id, kind: "loading" };
    if (this.state.activePage === "settings") this.renderSettingsPage();
    try {
      const source = await this.editorFontLoader.load(id);
      if (request !== this.editorFontRequestGeneration) return;
      this.editorFontStatus = { id, kind: "ready", source };
      this.updatePreferences({ editorFontFamily: id }, "setting-editor-font-family");
    } catch (error) {
      if (request !== this.editorFontRequestGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      this.editorFontStatus = { id, kind: "error", message };
      if (this.state.activePage === "settings") {
        this.renderSettingsPage();
        queueMicrotask(() =>
          this.query<HTMLSelectElement>("#setting-editor-font-family").focus(),
        );
      }
      this.showError(error);
    }
  }

  private bindWindowControls(): void {
    if (!windowControls.available) return;

    this.query("#window-minimize").addEventListener("click", () => {
      void this.runWindowAction(() => windowControls.minimize());
    });
    this.query("#window-maximize").addEventListener("click", () => {
      void this.runWindowAction(async () => {
        await windowControls.toggleMaximize();
        await this.syncMaximizeControl();
      });
    });
    this.query("#window-close").addEventListener("click", () => {
      void this.requestWindowClose();
    });

    this.refreshMaximizeControl();
    void windowControls
      .onResized(() => this.refreshMaximizeControl())
      .catch((error) => this.showError(error));
    void windowControls
      .onCloseRequested((event) => {
        this.captureMountedTextEditor();
        if (dirtyTextTabs(this.state.editor).length === 0) return;
        event.preventDefault();
        void this.requestWindowClose();
      })
      .catch((error) => this.showError(error));
  }

  private async requestWindowClose(): Promise<void> {
    if (!(await this.saveDirtyTabsBefore("closing Asterlyn"))) return;
    await this.runWindowAction(() => windowControls.close());
  }

  private async runWindowAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.showError(error);
    }
  }

  private async syncMaximizeControl(): Promise<void> {
    const maximized = await windowControls.isMaximized();
    const button = this.query<HTMLButtonElement>("#window-maximize");
    const label = maximized ? "Restore window" : "Maximize window";
    button.setAttribute("aria-label", label);
    button.title = maximized ? "Restore" : "Maximize";
    button.innerHTML = icon(maximized ? "restore" : "maximize", 16);
  }

  private refreshMaximizeControl(): void {
    void this.syncMaximizeControl().catch((error) => this.showError(error));
  }

  private async openRepository(path: string, reportError = true): Promise<boolean> {
    const previousRoot = this.state.snapshot?.root ?? null;
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
    const generation = ++this.requestGeneration;
    this.cancelActiveUntrackedScan();
    void this.cancelActiveRemoteOperation();
    let pendingRoot: string | null = null;
    this.setLoading(true, "Opening repository…");
    try {
      const snapshot = await bridge.openRepository(path);
      if (generation !== this.requestGeneration) return false;
      const repositoryChanged = previousRoot !== null && previousRoot !== snapshot.root;
      touchRecentRepository(window.localStorage, snapshot.root);
      if (repositoryChanged) {
        this.captureMountedTextEditor();
        this.state.editor = createEditorSession();
      } else {
        this.state.editor = closePreview(this.state.editor);
      }
      this.state.snapshot = snapshot;
      this.state.changeQuery = "";
      this.state.selectedChangeKeys.clear();
      this.changeSelectionAnchor = null;
      this.state.historyQuery = "";
      this.state.historyRecentPaths = [];
      this.closeHistoryDialog();
      this.resetHistoryFilters();
      this.state.gitDetail = "commit";
      this.clearWorkingDiff();
      this.state.projectFiles = [];
      this.state.repositoryFiles = [];
      this.state.ignoredProjectEntries = [];
      this.state.projectFilesLoading = true;
      this.state.projectFilesError = null;
      this.state.projectFilesTruncated = false;
      this.state.projectTreeRoot = null;
      this.state.projectTreeSelection = null;
      this.state.expandedProjectDirectories.clear();
      this.state.selectedBranch = null;
      this.installSnapshotHistory(snapshot, true);
      this.loadHistoryPreferences(snapshot);
      this.state.commitDetailsLoading =
        this.state.layout.bottomTool === "branches" &&
        this.state.selectedCommit !== null;
      this.state.remoteOperation = null;
      this.state.selectedRemote = preferredRemote(snapshot, this.state.selectedRemote);
      this.chooseValidChangeSelection();
      this.state.error = null;
      this.closeRepositoryDialog();
      this.renderWorkspace();
      if (this.state.layout.bottomTool === "branches") {
        void this.loadSelectedCommitDetails();
      }
      void this.loadProjectFiles(snapshot.root, generation);
      void this.loadReplacementRecoveries(snapshot.root, generation);
      pendingRoot = snapshot.root;
    } catch (error) {
      if (generation !== this.requestGeneration) return false;
      if (reportError) this.showError(error);
      if (!this.state.snapshot && bridge.isDemo) this.openRepositoryDialog(path);
      return false;
    } finally {
      if (generation === this.requestGeneration) this.setLoading(false, "Ready");
    }
    if (pendingRoot && generation === this.requestGeneration) {
      void this.completeUntrackedScan(pendingRoot, generation);
    }
    return pendingRoot !== null;
  }

  private async refresh(): Promise<void> {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.loading) return;
    this.cancelActiveWorkspaceSearch();
    this.cancelActiveWorkspaceReplacement();
    this.state.workspaceSearch = invalidateWorkspaceSearch(this.state.workspaceSearch);
    this.state.workspaceReplacement = createWorkspaceReplacementState();
    this.state.replacementDialog = null;
    this.state.replacementRecoveryBusy = null;
    this.state.commandSurface = closeCommandSurface(this.state.commandSurface);
    this.commandSurfaceReturnFocus = null;
    this.renderCommandSurface();
    const generation = ++this.requestGeneration;
    this.cancelActiveUntrackedScan();
    void this.cancelActiveRemoteOperation();
    let pendingRoot: string | null = null;
    let historyRequest: RefHistoryRequest | null = null;
    this.clearError();
    this.setLoading(true, "Refreshing repository…");
    try {
      const next = await bridge.openRepository(snapshot.root);
      if (generation !== this.requestGeneration) return;
      this.state.snapshot = next;
      this.state.selectedRemote = preferredRemote(next, this.state.selectedRemote);
      this.reconcileHistoryScope(next);
      this.chooseValidChangeSelection();
      this.reconcileWorkingDocument(next);

      const query = this.activeHistoryQuery();
      if (isSnapshotHistoryQuery(query)) {
        this.installSnapshotHistory(next, false, true);
      } else {
        const pending = beginHistoryQuery(this.state.history, next.root, query);
        this.state.history = pending.state;
        historyRequest = pending.request;
        this.state.selectedCommit = null;
        this.clearCommitInspection();
        this.resetHistoryPaging();
      }

      this.renderWorkspace();
      if (historyRequest) void this.loadHistory(historyRequest);
      else this.loadVisibleCommitDetails();
      if (this.activeDocument().kind === "working-diff") {
        void this.loadSelectedDiff();
      }
      void this.loadProjectFiles(next.root, generation);
      pendingRoot = next.root;
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.showError(error);
    } finally {
      if (generation === this.requestGeneration) this.setLoading(false, "Ready");
    }
    if (pendingRoot && generation === this.requestGeneration) {
      void this.completeUntrackedScan(pendingRoot, generation);
    }
  }

  private reconcileHistoryScope(snapshot: RepositorySnapshot): void {
    const refKeys = new Set(snapshot.branches.map((branch) => branchKey(branch)));
    this.state.historyRefs = new Map(
      Array.from(this.state.historyRefs).filter(([key]) => refKeys.has(key)),
    );
    if (this.state.selectedBranch && !refKeys.has(this.state.selectedBranch)) {
      this.state.selectedBranch = null;
      this.state.gitDetail = "commit";
    }
    const repositoryIds = new Set(snapshot.repositoryRoots.map((root) => root.id));
    this.state.historyRepositoryIds = new Set(
      Array.from(this.state.historyRepositoryIds).filter((id) => repositoryIds.has(id)),
    );
    this.state.historyPaths = new Map(
      Array.from(this.state.historyPaths).filter(([, path]) =>
        repositoryIds.has(path.repositoryId),
      ),
    );
    this.closeHistoryDialog();
  }

  private openCommandSurface(mode: NavigationMode): void {
    const snapshot = this.state.snapshot;
    if (mode !== "commands" && !snapshot) return;
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
    if (mode === "recent" && snapshot && !this.state.projectFilesLoading) {
      void this.loadProjectFiles(snapshot.root);
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

    const resultCount = this.commandSurfaceResultCount();
    this.state.commandSurface = clampCommandSurfaceSelection(
      this.state.commandSurface,
      resultCount,
    );
    const selected = this.state.commandSurface.selectedIndex;
    const title = commandSurfaceTitle(mode);
    const hint = commandSurfaceHint(mode);
    host.innerHTML = `
      <section class="command-surface ${mode === "workspace" ? "workspace-mode" : ""}" role="dialog" aria-modal="true" aria-labelledby="command-surface-title">
        <div class="command-surface-tabs" role="tablist" aria-label="Navigation mode">
          ${this.commandSurfaceTab("files", "Files")}
          ${this.commandSurfaceTab("recent", "Recent")}
          ${this.commandSurfaceTab("workspace", "Text")}
          ${this.commandSurfaceTab("commands", "Commands")}
          <button class="icon-button command-surface-close" type="button" data-command-surface-close aria-label="Close">${icon("close", 15)}</button>
        </div>
        <div class="command-surface-input">
          ${icon("search", 17)}
          <input id="command-surface-input" type="text" value="${escapeAttribute(this.state.commandSurface.query)}" placeholder="${escapeAttribute(title)}" autocomplete="off" spellcheck="false" aria-label="${escapeAttribute(title)}" aria-controls="command-surface-results" aria-activedescendant="${resultCount > 0 ? `command-result-${selected}` : ""}" />
          ${mode === "workspace" ? `<button class="workspace-search-mode" id="workspace-search-mode" type="button" aria-label="Use regular expressions" aria-pressed="${this.state.workspaceSearchControls.mode === "regex"}" title="Regular expression">.*</button>` : ""}
          ${mode === "workspace" && this.state.workspaceSearch.status === "loading" ? '<span class="spinner"></span>' : `<kbd>${mode === "workspace" ? "Enter to search" : "Enter"}</kbd>`}
        </div>
        ${mode === "workspace" ? this.renderWorkspaceSearchControls() : ""}
        <div class="command-surface-results" id="command-surface-results" role="listbox" aria-label="${escapeAttribute(title)}">
          ${this.renderCommandSurfaceResults(mode, selected)}
        </div>
        <footer class="command-surface-footer">
          <span id="command-surface-title">${escapeHtml(hint)}</span>
          <span><kbd>↑↓</kbd> Navigate <kbd>Enter</kbd> Open <kbd>Esc</kbd> Close</span>
        </footer>
      </section>`;
    this.bindCommandSurfaceEvents();
    if (focusInput) this.focusCommandSurfaceInput();
    queueMicrotask(() => {
      this.root
        .querySelector<HTMLElement>(`#command-result-${selected}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  private commandSurfaceTab(mode: NavigationMode, label: string): string {
    const active = this.state.commandSurface.mode === mode;
    return `<button type="button" role="tab" data-command-mode="${mode}" aria-selected="${active}" ${mode !== "commands" && !this.state.snapshot ? "disabled" : ""}>${escapeHtml(label)}</button>`;
  }

  private renderWorkspaceSearchControls(): string {
    const controls = this.state.workspaceSearchControls;
    const hasResults = this.workspaceSearchHasCurrentResults() && Boolean(this.state.workspaceSearch.report?.matches.length);
    const recoveryCount = this.state.workspaceReplacement.recoveries.length;
    return `<div class="workspace-search-controls" role="group" aria-label="Workspace search options">
      <label><span>Include</span><input id="workspace-search-include" type="text" value="${escapeAttribute(controls.includeText)}" placeholder="src/**, **/*.ts" autocomplete="off" spellcheck="false" aria-label="Files to include, comma-separated full-path globs" /></label>
      <label><span>Exclude</span><input id="workspace-search-exclude" type="text" value="${escapeAttribute(controls.excludeText)}" placeholder="dist/**, **/*.min.js" autocomplete="off" spellcheck="false" aria-label="Files to exclude, comma-separated full-path globs" /></label>
      <label class="workspace-search-context"><span>Context</span><select id="workspace-search-context" aria-label="Context lines">${[0, 1, 2, 3].map((value) => `<option value="${value}" ${value === controls.contextLines ? "selected" : ""}>${value}</option>`).join("")}</select></label>
      <label class="workspace-replacement-input"><span>Replace</span><input id="workspace-replacement-text" type="text" value="${escapeAttribute(this.state.replacementText)}" placeholder="Replacement text" autocomplete="off" spellcheck="false" aria-label="Replacement text" /></label>
      <button class="secondary-button workspace-replacement-preview-button" id="workspace-replacement-preview" type="button" ${hasResults ? "" : "disabled"}>Preview Replace</button>
      ${recoveryCount > 0 ? `<button class="workspace-recovery-button" id="workspace-recovery-open" type="button" aria-label="Review ${recoveryCount} replacement recoveries">${recoveryCount} recovery ${recoveryCount === 1 ? "record" : "records"}</button>` : ""}
    </div>`;
  }

  private renderCommandSurfaceResults(mode: NavigationMode, selected: number): string {
    if (mode === "workspace") return this.renderWorkspaceSearchResults(selected);
    if (mode === "commands") {
      const commands = this.visibleNavigationCommands();
      return commands.length
        ? commands.map((command, index) => this.renderCommandResult(command, index, selected)).join("")
        : this.commandSurfaceEmpty("No matching commands", "Try a broader command name.");
    }
    const files = this.visibleNavigationFiles(mode);
    if (files.length === 0) {
      return this.commandSurfaceEmpty(
        mode === "recent" ? "No recent files" : "No matching files",
        mode === "recent"
          ? "Files appear here after they open successfully."
          : this.state.projectFilesLoading
            ? "The project catalog is still loading."
            : "Try part of a filename or path.",
      );
    }
    return files
      .map((file, index) => this.renderFileNavigationResult(file, index, selected))
      .join("");
  }

  private renderWorkspaceSearchResults(selected: number): string {
    const search = this.state.workspaceSearch;
    if (search.status === "loading") {
      return this.commandSurfaceEmpty("Searching current project…", "The scan is bounded and cancellable.", true);
    }
    if (search.status === "error" && this.workspaceSearchRequestIsCurrent()) {
      return this.commandSurfaceEmpty("Search could not complete", search.error ?? "Try again.");
    }
    if (search.status !== "ready" || !this.workspaceSearchRequestIsCurrent() || !search.report) {
      return this.commandSurfaceEmpty(
        "Search file contents",
        "Enter a case-sensitive literal or regular expression, then press Enter. Replacement always requires a separate preview.",
      );
    }
    if (search.report.matches.length === 0) {
      const partial = search.report.coverageReasons.length > 0;
      return this.commandSurfaceEmpty(
        partial ? "No matches in the searched subset" : "No matches",
        formatWorkspaceSearchCoverage(search.report),
      );
    }
    const rows = search.report.matches
      .map((match, index) => this.renderWorkspaceSearchResult(match, index, selected))
      .join("");
    return `${rows}<div class="workspace-search-summary">${escapeHtml(formatWorkspaceSearchCoverage(search.report))}</div>`;
  }

  private renderFileNavigationResult(
    file: ProjectFile,
    index: number,
    selected: number,
  ): string {
    const directory = dirname(file.workspacePath);
    return `<button class="command-result ${index === selected ? "selected" : ""}" id="command-result-${index}" type="button" role="option" aria-selected="${index === selected}" data-command-result="${index}">
      <span class="command-result-icon">${icon("file", 15)}</span>
      <span class="command-result-copy"><strong>${escapeHtml(basename(file.workspacePath))}</strong><small>${escapeHtml(directory || "/")}</small></span>
      ${file.repositoryId === "." ? "" : `<span class="scope-pill">${escapeHtml(file.repositoryId)}</span>`}
    </button>`;
  }

  private renderCommandResult(
    command: NavigationCommand,
    index: number,
    selected: number,
  ): string {
    return `<button class="command-result ${index === selected ? "selected" : ""}" id="command-result-${index}" type="button" role="option" aria-selected="${index === selected}" data-command-result="${index}" ${command.enabled ? "" : "disabled"}>
      <span class="command-result-icon">${icon("search", 15)}</span>
      <span class="command-result-copy"><strong>${escapeHtml(command.label)}</strong><small>${escapeHtml(command.detail)}</small></span>
      ${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ""}
    </button>`;
  }

  private renderWorkspaceSearchResult(
    match: WorkspaceTextSearchMatch,
    index: number,
    selected: number,
  ): string {
    const before = match.preview.slice(0, match.previewFromUtf16);
    const found = match.preview.slice(match.previewFromUtf16, match.previewToUtf16);
    const after = match.preview.slice(match.previewToUtf16);
    const highlighted = found.length > 0
      ? `<mark>${escapeHtml(found)}</mark>`
      : '<mark class="zero-width" aria-label="Zero-width match" title="Zero-width match">│</mark>';
    return `<button class="command-result workspace-search-result ${index === selected ? "selected" : ""}" id="command-result-${index}" type="button" role="option" aria-selected="${index === selected}" data-command-result="${index}">
      <span class="search-result-location">${escapeHtml(`${match.workspacePath}:${match.line}:${match.columnUtf16}`)}</span>
      <code>${match.leadingClipped ? "…" : ""}${escapeHtml(before)}${highlighted}${escapeHtml(after)}${match.trailingClipped ? "…" : ""}</code>
    </button>`;
  }

  private commandSurfaceEmpty(title: string, detail: string, busy = false): string {
    return `<div class="command-surface-empty">${busy ? '<span class="spinner"></span>' : ""}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
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
    const snapshot = this.state.snapshot;
    if (!snapshot) return [];
    const recent = loadRecentFiles(
      window.localStorage,
      RECENT_FILE_KEY,
      snapshot.root,
      this.state.repositoryFiles,
    );
    return mode === "recent"
      ? rankProjectFiles(recent, this.state.commandSurface.query)
      : rankProjectFiles(
          this.state.repositoryFiles,
          this.state.commandSurface.query,
          recent,
        );
  }

  private visibleNavigationCommands(): NavigationCommand[] {
    return rankCommands(this.navigationCommands(), this.state.commandSurface.query);
  }

  private commandSurfaceResultCount(): number {
    const mode = this.state.commandSurface.mode;
    if (mode === "files" || mode === "recent") return this.visibleNavigationFiles(mode).length;
    if (mode === "commands") return this.visibleNavigationCommands().length;
    if (mode === "workspace" && this.workspaceSearchHasCurrentResults()) {
      return this.state.workspaceSearch.report?.matches.length ?? 0;
    }
    return 0;
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
      const snapshot = this.state.snapshot;
      if (!file || !snapshot) return;
      this.dismissCommandSurface();
      await this.openProjectFile(snapshot.root, file);
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
    const snapshot = this.state.snapshot;
    const tab = activeTextTab(this.state.editor);
    return [
      { id: "open-repository", label: "Open Repository", detail: "Choose a local Git folder", shortcut: "Ctrl+O", enabled: true },
      { id: "go-file", label: "Go to File", detail: "Open a project file by name", shortcut: "Ctrl+P", enabled: Boolean(snapshot) },
      { id: "recent-files", label: "Recent Files", detail: "Reopen a successful file", shortcut: "Ctrl+E", enabled: Boolean(snapshot) },
      { id: "find-workspace", label: "Find in Files", detail: "Bounded search with reviewed replacement", shortcut: "Ctrl+Shift+F", enabled: Boolean(snapshot) },
      { id: "find-current", label: "Find and Replace in Current File", detail: "Undoable changes stay in the active buffer", shortcut: "Ctrl+F", enabled: Boolean(tab?.status === "ready") },
      { id: "save-current", label: "Save Current File", detail: "Use the conflict-safe E1 save path", shortcut: "Ctrl+S", enabled: Boolean(tab && isTextTabDirty(tab) && !tab.saveRequest) },
      { id: "refresh", label: "Refresh Repository", detail: "Reload current Git state", shortcut: "Ctrl+R", enabled: Boolean(snapshot && !this.state.loading) },
      { id: "toggle-files", label: "Toggle Files", detail: "Show or hide the Files tool window", enabled: Boolean(snapshot) },
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
        queueMicrotask(() => this.textEditor.openFindReplace());
        break;
      case "save-current": {
        const tab = activeTextTab(this.state.editor);
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
    const snapshot = this.state.snapshot;
    const query = this.state.commandSurface.query;
    if (!snapshot || query.trim().length === 0) return;
    this.cancelActiveWorkspaceSearch();
    const requestId = `workspace-search-${Date.now()}-${++this.workspaceSearchSequence}`;
    const options = workspaceSearchOptions(this.state.workspaceSearchControls);
    const started = beginWorkspaceSearch(
      this.state.workspaceSearch,
      this.requestGeneration,
      snapshot.root,
      requestId,
      query,
      options,
    );
    this.state.workspaceSearch = started.state;
    this.renderCommandSurface(true);
    try {
      const report = await bridge.searchWorkspaceText(snapshot.root, requestId, query, options);
      if (
        this.requestGeneration !== started.request.repositoryGeneration ||
        this.state.snapshot?.root !== started.request.repositoryRoot
      ) {
        return;
      }
      this.state.workspaceSearch = completeWorkspaceSearch(
        this.state.workspaceSearch,
        started.request,
        report,
      );
      this.renderCommandSurface(true);
    } catch (error) {
      this.state.workspaceSearch = failWorkspaceSearch(
        this.state.workspaceSearch,
        started.request,
        errorMessage(error),
      );
      if (this.state.commandSurface.mode === "workspace") this.renderCommandSurface(true);
    }
  }

  private cancelActiveWorkspaceSearch(): void {
    const request = this.state.workspaceSearch.request;
    if (this.state.workspaceSearch.status !== "loading" || !request) return;
    void bridge
      .cancelWorkspaceTextSearch(request.repositoryRoot, request.requestId)
      .catch(() => undefined);
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
    void bridge
      .cancelWorkspaceReplacement(
        replacement.request.repositoryRoot,
        replacement.request.operationId,
      )
      .catch(() => undefined);
  }

  private async previewWorkspaceReplacement(): Promise<void> {
    const snapshot = this.state.snapshot;
    const searchRequest = this.state.workspaceSearch.request;
    const report = this.state.workspaceSearch.report;
    if (
      !snapshot ||
      !searchRequest ||
      !report ||
      !this.workspaceSearchHasCurrentResults() ||
      report.matches.length === 0
    ) {
      return;
    }
    this.cancelActiveWorkspaceReplacement();
    const planId = `workspace-replace-${Date.now()}-${++this.workspaceReplacementSequence}`;
    const started = beginReplacementPreview(
      this.state.workspaceReplacement,
      this.requestGeneration,
      snapshot.root,
      planId,
      searchRequest.query,
      this.state.replacementText,
      searchRequest.options,
    );
    this.state.workspaceReplacement = started.state;
    this.state.replacementDialog = "preview";
    this.renderWorkspaceReplacementDialog();
    try {
      const preview = await bridge.previewWorkspaceReplacement(
        snapshot.root,
        planId,
        searchRequest.query,
        this.state.replacementText,
        searchRequest.options,
      );
      if (
        this.requestGeneration !== started.request.repositoryGeneration ||
        this.state.snapshot?.root !== started.request.repositoryRoot
      ) {
        return;
      }
      this.state.workspaceReplacement = completeReplacementPreview(
        this.state.workspaceReplacement,
        started.request,
        preview,
      );
      this.renderWorkspaceReplacementDialog();
    } catch (error) {
      this.state.workspaceReplacement = failReplacement(
        this.state.workspaceReplacement,
        started.request,
        errorMessage(error),
      );
      this.renderWorkspaceReplacementDialog();
    }
  }

  private renderWorkspaceReplacementDialog(): void {
    const host = this.query("#workspace-replacement-dialog");
    const mode = this.state.replacementDialog;
    host.classList.toggle("hidden", mode === null);
    if (!mode) {
      host.innerHTML = "";
      return;
    }
    if (mode === "recovery") {
      host.innerHTML = this.renderReplacementRecoveries();
      this.bindWorkspaceReplacementDialogEvents();
      return;
    }

    const replacement = this.state.workspaceReplacement;
    if (replacement.status === "previewing") {
      host.innerHTML = `<section class="dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-dialog-title">
        <div class="dialog-heading"><div><span class="panel-eyebrow">Safe workspace edit</span><h2 id="replacement-dialog-title">Preparing replacement preview</h2></div></div>
        ${this.loadingBlock("Re-reading the Git-authorized files…")}
        <div class="dialog-actions"><button class="secondary-button" id="replacement-cancel-operation" type="button">Cancel</button></div>
      </section>`;
      this.bindWorkspaceReplacementDialogEvents();
      return;
    }
    if (replacement.status === "error" || !replacement.preview) {
      host.innerHTML = `<section class="dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-dialog-title">
        <div class="dialog-heading"><div><span class="panel-eyebrow">Safe workspace edit</span><h2 id="replacement-dialog-title">Replacement preview unavailable</h2></div><button class="icon-button" data-replacement-close type="button" aria-label="Close">${icon("close", 17)}</button></div>
        <div class="replacement-error" role="alert">${escapeHtml(replacement.error ?? "Create a new search and preview.")}</div>
        <div class="dialog-actions"><button class="secondary-button" data-replacement-close type="button">Close</button></div>
      </section>`;
      this.bindWorkspaceReplacementDialogEvents();
      return;
    }

    const preview = replacement.preview;
    const selected = replacement.selectedPaths;
    const selectedFiles = preview.files.filter((file) => selected.has(file.workspacePath));
    const selectedMatches = selectedFiles.reduce((total, file) => total + file.matchCount, 0);
    const applying = replacement.status === "applying";
    const allSelected = selected.size === preview.files.length;
    const rows = preview.files.map((file) => {
      const checked = selected.has(file.workspacePath);
      const openTab = this.state.editor.textTabs.find(
        (tab) => tab.document.workspacePath === file.workspacePath,
      );
      const blocked = Boolean(openTab && (isTextTabDirty(openTab) || openTab.saveRequest));
      const delta = file.byteDelta === 0 ? "same size" : `${file.byteDelta > 0 ? "+" : ""}${file.byteDelta} B`;
      return `<article class="replacement-file ${checked ? "selected" : ""}">
        <label class="replacement-file-heading">
          <input type="checkbox" data-replacement-file="${escapeAttribute(file.workspacePath)}" ${checked ? "checked" : ""} ${applying ? "disabled" : ""} />
          <span><strong>${escapeHtml(file.workspacePath)}</strong><small>${file.matchCount} ${file.matchCount === 1 ? "match" : "matches"} · ${escapeHtml(delta)}${blocked ? " · save or unselect the open edited file" : ""}</small></span>
        </label>
        <div class="replacement-comparison" aria-label="Before and after preview for ${escapeAttribute(file.workspacePath)}">
          <code class="before"><span>Before</span>${escapeHtml(file.beforePreview)}</code>
          <code class="after"><span>After</span>${escapeHtml(file.afterPreview)}</code>
        </div>
      </article>`;
    }).join("");
    const warning = preview.skippedCount > 0
      ? `<div class="replacement-warning">${preview.skippedCount} unsupported or unreadable files remain outside this reviewed replacement.</div>`
      : "";
    host.innerHTML = `<section class="dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-dialog-title">
      <div class="dialog-heading"><div><span class="panel-eyebrow">Safe workspace edit</span><h2 id="replacement-dialog-title">Review Replace in Files</h2></div>${applying ? "" : `<button class="icon-button" data-replacement-close type="button" aria-label="Close">${icon("close", 17)}</button>`}</div>
      <p>${preview.totalMatches} reviewed replacements across ${preview.files.length} files. Only checked files will change.</p>
      ${replacement.error ? `<div class="replacement-error" role="alert">${escapeHtml(replacement.error)}</div>` : ""}
      ${warning}
      <label class="replacement-select-all"><input id="replacement-select-all" type="checkbox" ${allSelected ? "checked" : ""} ${applying ? "disabled" : ""} /> Select all files</label>
      <div class="replacement-file-list">${rows}</div>
      <div class="dialog-actions">
        ${applying ? `<button class="secondary-button" id="replacement-cancel-operation" type="button">Cancel and restore</button><button class="primary-button" type="button" disabled><span class="spinner"></span> Applying safely…</button>` : `<button class="secondary-button" data-replacement-close type="button">Cancel</button><button class="primary-button" id="replacement-apply" type="button" ${selected.size > 0 ? "" : "disabled"}>Replace ${selectedMatches} in ${selected.size} ${selected.size === 1 ? "file" : "files"}</button>`}
      </div>
    </section>`;
    this.bindWorkspaceReplacementDialogEvents();
  }

  private renderReplacementRecoveries(): string {
    const state = this.state.workspaceReplacement;
    const cards = state.recoveries.length === 0
      ? `<div class="command-surface-empty"><strong>No pending replacement recovery</strong><span>Reviewed backups have been resolved.</span></div>`
      : state.recoveries.map((recovery) => {
          const busy = this.state.replacementRecoveryBusy?.id === recovery.recoveryId;
          const conflicts = recovery.files.filter((file) => file.state === "conflict" || file.state === "unavailable").length;
          const replaced = recovery.files.filter((file) => file.state === "replaced").length;
          const files = recovery.files.map((file) => `<li><span>${escapeHtml(file.workspacePath)}</span><span class="recovery-state ${file.state}">${escapeHtml(replacementFileStateLabel(file.state))}</span></li>`).join("");
          return `<article class="recovery-card">
            <div class="recovery-card-heading"><div><strong>${escapeHtml(recovery.recoveryId)}</strong><small>${replaced}/${recovery.files.length} files contain the reviewed replacement${conflicts ? ` · ${conflicts} need manual review` : ""}</small></div><span class="scope-pill">${escapeHtml(replacementRecoveryLabel(recovery))}</span></div>
            <ul>${files}</ul>
            <div class="recovery-actions">
              <button class="secondary-button" data-recovery-rollback="${escapeAttribute(recovery.recoveryId)}" type="button" ${busy ? "disabled" : ""}>${busy && this.state.replacementRecoveryBusy?.action === "rollback" ? "Restoring…" : "Roll back"}</button>
              <button class="primary-button" data-recovery-keep="${escapeAttribute(recovery.recoveryId)}" type="button" ${busy || recovery.status !== "applied" ? "disabled" : ""}>${busy && this.state.replacementRecoveryBusy?.action === "keep" ? "Keeping…" : "Keep changes"}</button>
            </div>
          </article>`;
        }).join("");
    return `<section class="dialog replacement-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-recovery-title">
      <div class="dialog-heading"><div><span class="panel-eyebrow">Crash-safe history</span><h2 id="replacement-recovery-title">Replacement recovery</h2></div>${this.state.replacementRecoveryBusy ? "" : `<button class="icon-button" data-replacement-close type="button" aria-label="Close">${icon("close", 17)}</button>`}</div>
      <p>Backups remain until you verify and keep the reviewed changes, or restore the exact originals.</p>
      <div class="recovery-list">${cards}</div>
      <div class="dialog-actions"><button class="secondary-button" data-replacement-close type="button" ${this.state.replacementRecoveryBusy ? "disabled" : ""}>Close</button></div>
    </section>`;
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
    const snapshot = this.state.snapshot;
    const request = this.state.workspaceReplacement.request;
    const preview = this.state.workspaceReplacement.preview;
    if (!snapshot || !request || !preview || this.state.workspaceReplacement.status !== "ready") return;
    this.captureMountedTextEditor();
    const selectedPaths = [...this.state.workspaceReplacement.selectedPaths];
    const blocked = this.state.editor.textTabs.filter(
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
      const result = await bridge.applyWorkspaceReplacement(snapshot.root, preview.planId, selectedPaths);
      if (
        this.requestGeneration !== request.repositoryGeneration ||
        this.state.snapshot?.root !== request.repositoryRoot
      ) {
        return;
      }
      this.state.workspaceReplacement = completeReplacementApply(
        this.state.workspaceReplacement,
        request,
        result,
      );
      await this.reloadReplacementFiles(selectedPaths);
      await this.refreshWorkspaceAfterReplacement(snapshot.root, request.repositoryGeneration);
      this.refreshWorkspaceSearchAfterReplacement();
      await this.loadReplacementRecoveries(snapshot.root, this.requestGeneration);
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
      await this.loadReplacementRecoveries(snapshot.root, this.requestGeneration);
      if (this.state.workspaceReplacement.recoveries.length > 0) {
        this.state.replacementDialog = "recovery";
      }
      this.renderWorkspaceReplacementDialog();
      this.showError(error);
    }
  }

  private async loadReplacementRecoveries(
    repositoryRoot: string,
    generation = this.requestGeneration,
  ): Promise<void> {
    this.state.workspaceReplacement = {
      ...this.state.workspaceReplacement,
      recoveriesLoading: true,
    };
    try {
      const recoveries = await bridge.listWorkspaceReplacementRecoveries(repositoryRoot);
      if (generation !== this.requestGeneration || this.state.snapshot?.root !== repositoryRoot) return;
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
      if (generation !== this.requestGeneration) return;
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
    const snapshot = this.state.snapshot;
    const recovery = this.state.workspaceReplacement.recoveries.find(
      (candidate) => candidate.recoveryId === recoveryId,
    );
    if (!snapshot || !recovery || this.state.replacementRecoveryBusy) return;
    this.captureMountedTextEditor();
    const paths = recovery.files.map((file) => file.workspacePath);
    const blocked = this.state.editor.textTabs.filter(
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
        await bridge.finalizeWorkspaceReplacement(snapshot.root, recoveryId);
      } else {
        rollbackResult = await bridge.rollbackWorkspaceReplacement(snapshot.root, recoveryId);
        await this.reloadReplacementFiles(paths);
      }
      this.state.replacementRecoveryBusy = null;
      if (action === "rollback") {
        await this.refreshWorkspaceAfterReplacement(snapshot.root, this.requestGeneration);
        this.refreshWorkspaceSearchAfterReplacement();
      }
      if (this.state.snapshot?.root !== snapshot.root) return;
      await this.loadReplacementRecoveries(snapshot.root, this.requestGeneration);
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
      await this.loadReplacementRecoveries(snapshot.root, this.requestGeneration);
      this.renderWorkspaceReplacementDialog();
      this.showError(error);
    }
  }

  private async refreshWorkspaceAfterReplacement(
    repositoryRoot: string,
    generation: number,
  ): Promise<void> {
    const current = this.state.snapshot;
    if (!current || current.root !== repositoryRoot || generation !== this.requestGeneration) return;
    this.cancelActiveUntrackedScan();
    const refreshed = await bridge.openRepository(repositoryRoot);
    if (
      generation !== this.requestGeneration ||
      this.state.snapshot?.root !== repositoryRoot ||
      refreshed.root !== repositoryRoot
    ) {
      return;
    }
    this.state.snapshot = { ...refreshed, commits: current.commits };
    this.chooseValidChangeSelection();
    this.renderWorkspace();
    await this.completeUntrackedScan(repositoryRoot, generation);
  }

  private async reloadReplacementFiles(workspacePaths: string[]): Promise<void> {
    const selected = new Set(workspacePaths);
    const tabs = this.state.editor.textTabs.filter((tab) => selected.has(tab.document.workspacePath));
    for (const tab of tabs) {
      const reload = beginTextReload(this.state.editor, tab.id);
      if (reload.loadEpoch === null) continue;
      this.state.editor = reload.session;
      try {
        const snapshot = await bridge.readTextFile(
          tab.document.repositoryRoot,
          tab.document.repositoryId,
          tab.document.path,
        );
        this.state.editor = completeTextLoad(
          this.state.editor,
          tab.id,
          reload.loadEpoch,
          snapshot,
        );
      } catch (error) {
        this.state.editor = failTextLoad(
          this.state.editor,
          tab.id,
          reload.loadEpoch,
          errorMessage(error),
        );
      }
    }
    this.renderEditor();
  }

  private async openWorkspaceSearchMatch(match: WorkspaceTextSearchMatch): Promise<void> {
    const snapshot = this.state.snapshot;
    if (!snapshot || snapshot.root !== this.state.workspaceSearch.request?.repositoryRoot) {
      this.setStatus("Search result belongs to another workspace", "warning");
      return;
    }
    await this.openProjectFile(snapshot.root, match, match);
  }

  private renderRemotePopover(snapshot: RepositorySnapshot): void {
    const button = this.query<HTMLButtonElement>("#sync-button");
    const badge = this.query("#sync-badge");
    const popover = this.query("#sync-popover");
    const divergence = [
      snapshot.branch.ahead ? `↑${snapshot.branch.ahead}` : "",
      snapshot.branch.behind ? `↓${snapshot.branch.behind}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    badge.textContent = divergence;
    badge.classList.toggle("hidden", !divergence);
    button.setAttribute("aria-expanded", this.state.syncPopoverOpen.toString());
    button.disabled = false;
    popover.classList.toggle("hidden", !this.state.syncPopoverOpen);
    if (!this.state.syncPopoverOpen) {
      popover.innerHTML = "";
      return;
    }

    const policy = remotePolicy(snapshot, this.state.selectedRemote);
    const operation =
      this.state.remoteOperation?.root === snapshot.root
        ? this.state.remoteOperation
        : null;
    const pushTarget =
      policy.pushRemote && policy.destination
        ? `${policy.pushRemote.name}:${policy.destination}`
        : "Not configured";
    const remoteOptions = snapshot.remotes
      .map(
        (remote) =>
          `<option value="${escapeAttribute(remote.name)}" ${remote.name === policy.selectedRemote?.name ? "selected" : ""}>${escapeHtml(remote.name)}${remote.fetchSupported ? "" : " · unsupported mapping"}</option>`,
      )
      .join("");
    const action = (
      kind: "fetch" | "pull" | "push",
      state: ReturnType<typeof remotePolicy>["fetch"],
      iconName: "download" | "upload" | "sync",
    ) => `
      <div class="sync-action-row">
        <span class="sync-action-icon">${icon(iconName, 16)}</span>
        <div><strong>${escapeHtml(state.label)}</strong><p>${escapeHtml(state.detail)}</p></div>
        <button class="secondary-button compact" type="button" data-remote-action="${kind}" ${state.enabled && !this.state.loading ? "" : "disabled"}>${escapeHtml(state.label)}</button>
      </div>`;

    popover.innerHTML = `
      <div class="sync-popover-header">
        <div><span class="panel-eyebrow">Remote</span><h2>Sync repository</h2></div>
        <span class="sync-state ${snapshot.branch.ahead > 0 && snapshot.branch.behind > 0 ? "diverged" : ""}">${divergence || "Up to date"}</span>
      </div>
      <label class="remote-select" for="remote-select"><span>Remote</span><select id="remote-select" ${operation ? "disabled" : ""}>${remoteOptions}</select></label>
      <div class="sync-route" aria-label="Remote ref target">
        <code title="${escapeAttribute(policy.source ?? "No local branch")}">${escapeHtml(policy.source ?? "No local branch")}</code>
        <span>→</span>
        <code title="${escapeAttribute(pushTarget)}">${escapeHtml(pushTarget)}</code>
      </div>
      <p class="sync-advisory">Ahead/behind values use local tracking refs. Fetch refreshes them before the next decision.</p>
      ${
        operation
          ? `<div class="remote-operation-banner"><span class="spinner"></span><div><strong>${operation.cancelling ? "Cancelling…" : `${capitalize(operation.kind)} in progress`}</strong><p>${operation.kind === "push" ? "If cancelled, the remote outcome remains unknown until fetch." : "Cancellation never rolls repository state back."}</p></div><button class="secondary-button compact" id="cancel-remote-operation" type="button" ${operation.cancelling ? "disabled" : ""}>Cancel</button></div>`
          : `${action("fetch", policy.fetch, "download")}${action("pull", policy.pull, "sync")}${action("push", policy.push, "upload")}`
      }
      <div class="credential-note"><span>${icon("check", 14)}</span><p>Uses configured non-interactive Git credentials or SSH agent. Asterlyn never stores remote secrets.</p></div>`;

    this.root
      .querySelector<HTMLSelectElement>("#remote-select")
      ?.addEventListener("change", (event) => {
        this.state.selectedRemote = (event.currentTarget as HTMLSelectElement).value;
        this.renderRemotePopover(snapshot);
      });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-remote-action]")
      .forEach((actionButton) => {
        actionButton.addEventListener("click", () => {
          const kind = actionButton.dataset.remoteAction as "fetch" | "pull" | "push";
          void this.runRemoteOperation(kind);
        });
      });
    this.root
      .querySelector<HTMLButtonElement>("#cancel-remote-operation")
      ?.addEventListener("click", () => void this.cancelActiveRemoteOperation());
  }

  private async runRemoteOperation(kind: "fetch" | "pull" | "push"): Promise<void> {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.loading || this.state.remoteOperation) return;
    const policy = remotePolicy(snapshot, this.state.selectedRemote);
    const actionState = policy[kind];
    if (!actionState.enabled) return;
    const remote = kind === "push" ? policy.pushRemote : policy.selectedRemote;
    if (kind !== "pull" && !remote) return;
    if (kind === "pull" && !(await this.saveDirtyTabsBefore("pulling changes"))) {
      return;
    }

    const generation = ++this.requestGeneration;
    this.cancelActiveUntrackedScan();
    const operationId = `${generation}-${++this.remoteOperationSequence}-${kind}`;
    this.state.remoteOperation = {
      id: operationId,
      root: snapshot.root,
      kind,
      cancelling: false,
    };
    this.clearError();
    this.setLoading(true, `${capitalize(kind)} in progress…`);
    this.renderRemotePopover(snapshot);
    let pendingRoot: string | null = null;
    let succeeded = false;
    let failed = false;

    try {
      const next =
        kind === "fetch"
          ? await bridge.fetchRemote(snapshot.root, remote!.name, operationId)
          : kind === "pull"
            ? await bridge.pullCurrent(snapshot.root, operationId)
            : await bridge.pushCurrent(snapshot.root, remote!.name, operationId);
      if (generation !== this.requestGeneration) return;
      this.acceptRemoteSnapshot(next);
      if (kind === "pull") {
        this.captureMountedTextEditor();
        if (dirtyTextTabs(this.state.editor).length === 0) {
          this.state.editor = createEditorSession();
        }
        this.renderLeftTool();
        this.renderEditor();
      }
      pendingRoot = next.root;
      succeeded = true;
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      failed = true;
      this.showError(error);
      try {
        const reconciled = await bridge.openRepository(snapshot.root);
        if (generation !== this.requestGeneration) return;
        this.acceptRemoteSnapshot(reconciled);
        pendingRoot = reconciled.root;
      } catch {
        this.setStatus("Remote operation ended; refresh required", "warning");
      }
    } finally {
      if (generation === this.requestGeneration) {
        this.state.remoteOperation = null;
        this.setLoading(false, "Ready");
        if (this.state.snapshot) this.renderRemotePopover(this.state.snapshot);
        if (succeeded) this.setStatus(`${capitalize(kind)} completed`, "success");
        else if (failed) this.setStatus("Remote operation needs review", "warning");
      }
    }
    if (pendingRoot && generation === this.requestGeneration) {
      void this.completeUntrackedScan(pendingRoot, generation);
    }
  }

  private acceptRemoteSnapshot(snapshot: RepositorySnapshot): void {
    this.state.snapshot = snapshot;
    this.state.selectedRemote = preferredRemote(snapshot, this.state.selectedRemote);
    this.state.selectedBranch = null;
    this.installSnapshotHistory(snapshot);
    this.state.selectedChangeKeys.clear();
    this.state.selectedChange = null;
    this.changeSelectionAnchor = null;
    this.chooseValidChangeSelection();
    this.reconcileWorkingDocument(snapshot);
    this.renderWorkspace();
    this.loadVisibleCommitDetails();
    if (this.activeDocument().kind === "working-diff") {
      void this.loadSelectedDiff();
    }
    void this.loadProjectFiles(snapshot.root);
  }

  private async cancelActiveRemoteOperation(): Promise<void> {
    const operation = this.state.remoteOperation;
    if (!operation || operation.cancelling) return;
    operation.cancelling = true;
    if (this.state.snapshot?.root === operation.root) {
      this.setStatus(`Cancelling ${operation.kind}…`, "busy");
      this.renderRemotePopover(this.state.snapshot);
    }
    try {
      await bridge.cancelRemoteOperation(operation.root, operation.id);
    } catch (error) {
      operation.cancelling = false;
      this.showError(error);
      if (this.state.snapshot?.root === operation.root) {
        this.renderRemotePopover(this.state.snapshot);
      }
    }
  }

  private toggleTool(tool: "files" | "branches" | "changes"): void {
    this.state.layout =
      tool === "branches"
        ? reduceWorkbenchLayout(this.state.layout, {
            type: "toggle-bottom-tool",
            tool,
          })
        : reduceWorkbenchLayout(this.state.layout, {
            type: "toggle-left-tool",
            tool,
          });
    this.applyWorkbenchLayout(true);
    this.renderActivityRail();
    if (tool === "branches" && this.state.layout.bottomTool === "branches") {
      this.renderBottomTool();
      this.loadVisibleCommitDetails();
    } else if (tool !== "branches" && this.state.layout.leftTool === tool) {
      this.renderLeftTool();
    }
  }

  private renderActivityRail(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
      const tool = button.dataset.tool;
      const active =
        tool === "branches"
          ? this.state.layout.bottomTool === "branches"
          : this.state.layout.leftTool === tool;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  private bindWorkbenchSplitters(): void {
    for (const dispose of this.splitterDisposers) dispose();
    this.splitterDisposers = [
      attachSplitter(this.query("#left-splitter"), {
        orientation: "vertical",
        getValue: () => this.state.layout.leftWidth,
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
        getValue: () => this.state.layout.bottomHeight,
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
        getValue: () => this.state.layout.branchTreeWidth,
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
        getValue: () => this.state.layout.branchDetailsWidth,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.branchDetailsMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.branchDetailsMin,
            this.query("#git-tool-grid").clientWidth -
              this.state.layout.branchTreeWidth -
              WORKBENCH_LIMITS.branchCommitMin -
              WORKBENCH_LIMITS.separatorSize * 2,
          ),
        }),
        onChange: (value) => this.resizeWorkbench("branchDetailsWidth", value),
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
      | "diffBeforePercent",
    value: number,
  ): void {
    this.state.layout = reduceWorkbenchLayout(this.state.layout, {
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
      diffBeforePercent: null,
    }[dimension];
    if (property) {
      this.query("#workbench").style.setProperty(
        property,
        `${this.state.layout[dimension]}px`,
      );
    }
    if (dimension === "leftWidth" || dimension === "bottomHeight") {
      this.scheduleEditorMeasure();
    }
  }

  private persistWorkbenchLayout(): void {
    saveWorkbenchLayout(window.localStorage, this.state.layout);
  }

  private applyWorkbenchLayout(persist: boolean): void {
    const workbench = this.query("#workbench");
    this.state.layout = clampWorkbenchLayout(this.state.layout, {
      width: workbench.clientWidth,
      height: workbench.clientHeight,
    });
    workbench.style.setProperty("--left-tool-width", `${this.state.layout.leftWidth}px`);
    workbench.style.setProperty(
      "--bottom-tool-height",
      `${this.state.layout.bottomHeight}px`,
    );
    workbench.style.setProperty(
      "--branch-tree-width",
      `${this.state.layout.branchTreeWidth}px`,
    );
    workbench.style.setProperty(
      "--branch-details-width",
      `${this.state.layout.branchDetailsWidth}px`,
    );
    workbench.style.setProperty(
      "--commit-summary-height",
      `${this.state.layout.commitSummaryHeight}px`,
    );
    const leftOpen = this.state.layout.leftTool !== null;
    const bottomOpen = this.state.layout.bottomTool !== null;
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
    if (this.editorMeasureFrame !== null) return;
    this.editorMeasureFrame = window.requestAnimationFrame(() => {
      this.editorMeasureFrame = null;
      this.diffEditor.requestMeasure();
      this.textEditor.requestMeasure();
    });
  }

  private renderWorkspace(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    this.renderTopbar(snapshot);
    this.applyWorkbenchLayout(false);
    this.renderActivityRail();
    this.renderLeftTool();
    this.renderBottomTool();
    this.renderEditor();
    this.renderStatus(snapshot);
  }

  private renderTopbar(snapshot: RepositorySnapshot): void {
    this.renderRepositoryMenu(snapshot);
    this.state.selectedRemote = preferredRemote(snapshot, this.state.selectedRemote);
    this.renderRemotePopover(snapshot);
  }

  private renderRepositoryMenu(snapshot = this.state.snapshot): void {
    const button = this.query<HTMLButtonElement>("#repository-switcher");
    const menu = this.query("#repository-menu");
    const currentRoot = snapshot?.root ?? null;
    const currentName = currentRoot ? basename(currentRoot) : "No project";
    this.query("#repository-name").textContent = currentName;
    button.title = currentRoot ?? "Open a project";
    button.setAttribute(
      "aria-label",
      currentRoot ? `Project menu for ${currentName}` : "Open project menu",
    );
    button.setAttribute("aria-expanded", String(this.repositoryMenuOpen));
    menu.classList.toggle("hidden", !this.repositoryMenuOpen);
    if (!this.repositoryMenuOpen) {
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
        this.repositoryMenuOpen = false;
        this.renderRepositoryMenu();
        void this.chooseRepository();
      });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-recent-repository]")
      .forEach((item) => {
        item.addEventListener("click", () => {
          const path = item.dataset.recentRepository;
          if (!path) return;
          this.repositoryMenuOpen = false;
          this.renderRepositoryMenu();
          void this.requestRepositoryTarget(path);
        });
      });
  }

  private renderLeftTool(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot || !this.state.layout.leftTool) return;
    const title = this.query("#navigator-title");
    const count = this.query("#navigator-count");
    const actions = this.query("#navigator-actions");
    const hide = this.query<HTMLButtonElement>("#hide-left-tool");
    const body = this.query("#navigator-body");

    if (this.state.layout.leftTool === "changes") {
      body.dataset.navigatorView = "changes";
      title.textContent = "Changes";
      hide.setAttribute("aria-label", "Hide Changes tool window");
      hide.title = "Hide Changes tool window";
      const filtered = this.filteredChanges(snapshot);
      count.textContent = filtered.length.toString();
      count.title = this.state.changeQuery
        ? `${filtered.length} of ${snapshot.changes.length} changed files`
        : `${snapshot.changes.length} changed files`;
      actions.innerHTML = "";
      body.innerHTML = `<div class="changes-tool-layout"><div class="changes-tool-navigation">${this.renderChangeNavigation(snapshot)}</div>${this.renderCommitComposer(snapshot)}</div>`;
      this.bindChangeEvents();
      this.bindCommitComposer(snapshot);
      return;
    }

    title.textContent = basename(snapshot.root);
    hide.setAttribute("aria-label", "Hide Files tool window");
    hide.title = "Hide Files tool window";
    const visibleEntries = this.state.repositoryFiles.length + this.state.ignoredProjectEntries.length;
    count.textContent = visibleEntries.toString();
    count.title = `${this.state.repositoryFiles.length} editable files and ${this.state.ignoredProjectEntries.length} ignored entries`;
    const preserveScroll = body.dataset.navigatorView === "files";
    const scrollTop = body.scrollTop;
    const scrollLeft = body.scrollLeft;
    const tree = this.projectTree(snapshot);
    body.dataset.navigatorView = "files";
    actions.innerHTML = this.renderProjectToolbar(snapshot, tree);
    body.innerHTML = this.renderProjectNavigation(tree);
    this.bindProjectEvents();
    if (preserveScroll) {
      body.scrollTop = scrollTop;
      body.scrollLeft = scrollLeft;
    }
  }

  private renderBottomTool(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.layout.bottomTool !== "branches") return;
    const commits = this.filteredHistoryCommits();
    this.commitDetailSplitterDisposer?.();
    this.commitDetailSplitterDisposer = null;
    this.query("#branch-navigation-body").innerHTML =
      this.renderBranchNavigation(snapshot);
    this.query("#history-navigation-body").innerHTML =
      this.renderHistoryNavigation();
    this.query("#git-detail-body").innerHTML = this.renderGitDetail(snapshot);
    this.renderBranchCount(snapshot);
    this.renderHistoryCount(commits.length);
    this.bindBranchEvents();
    this.bindHistoryEvents();
    this.bindGitDetailEvents(snapshot);
  }

  private async loadProjectFiles(
    repositoryRoot: string,
    repositoryGeneration = this.requestGeneration,
  ): Promise<void> {
    const generation = ++this.projectFilesGeneration;
    this.state.projectFilesLoading = true;
    this.state.projectFilesError = null;
    if (this.state.layout.leftTool === "files") this.renderLeftTool();
    try {
      const result = await bridge.listProjectFiles(repositoryRoot);
      if (
        generation !== this.projectFilesGeneration ||
        repositoryGeneration !== this.requestGeneration ||
        this.state.snapshot?.root !== repositoryRoot ||
        result.root !== repositoryRoot
      ) {
        return;
      }
      this.state.projectFiles = result.paths;
      this.state.repositoryFiles = result.files;
      this.state.ignoredProjectEntries = result.ignoredEntries;
      this.state.projectFilesTruncated = result.truncated;
      this.state.projectFilesLoading = false;
      const tree = this.projectTree(this.state.snapshot);
      if (this.state.projectTreeRoot !== result.root) {
        this.state.projectTreeRoot = result.root;
        this.state.projectTreeSelection = null;
        this.state.expandedProjectDirectories = defaultExpandedProjectDirectories(
          tree,
        );
      } else {
        const reconciled = reconcileProjectTreeState(
          tree,
          this.state.expandedProjectDirectories,
          this.state.projectTreeSelection,
        );
        this.state.expandedProjectDirectories = reconciled.expandedDirectories;
        this.state.projectTreeSelection = reconciled.selection;
      }
      if (this.state.layout.leftTool === "files") this.renderLeftTool();
      if (
        this.state.commandSurface.mode === "files" ||
        this.state.commandSurface.mode === "recent"
      ) {
        this.renderCommandSurface(true);
      }
      if (
        this.state.layout.bottomTool === "branches" &&
        this.state.historyFilterMenu === "paths"
      ) {
        this.renderBottomTool();
      }
    } catch (error) {
      if (
        generation !== this.projectFilesGeneration ||
        repositoryGeneration !== this.requestGeneration ||
        this.state.snapshot?.root !== repositoryRoot
      ) {
        return;
      }
      this.state.projectFilesLoading = false;
      this.state.projectFilesError = errorMessage(error);
      if (this.state.layout.leftTool === "files") this.renderLeftTool();
      if (
        this.state.commandSurface.mode === "files" ||
        this.state.commandSurface.mode === "recent"
      ) {
        this.renderCommandSurface(true);
      }
      if (
        this.state.layout.bottomTool === "branches" &&
        this.state.historyFilterMenu === "paths"
      ) {
        this.renderBottomTool();
      }
      this.showError(error);
    }
  }

  private projectTree(snapshot: RepositorySnapshot | null = this.state.snapshot): ProjectTreeNode[] {
    if (!snapshot) return [];
    const cached = this.projectTreeCache;
    if (
      cached &&
      cached.files === this.state.repositoryFiles &&
      cached.changes === snapshot.changes &&
      cached.ignoredEntries === this.state.ignoredProjectEntries
    ) {
      return cached.nodes;
    }
    const nodes = buildProjectTree(
      projectTreeEntries(
        this.state.repositoryFiles,
        snapshot.changes,
        this.state.ignoredProjectEntries,
      ),
    );
    this.projectTreeCache = {
      files: this.state.repositoryFiles,
      changes: snapshot.changes,
      ignoredEntries: this.state.ignoredProjectEntries,
      nodes,
    };
    return nodes;
  }

  private renderProjectToolbar(
    snapshot: RepositorySnapshot,
    tree = this.projectTree(snapshot),
  ): string {
    const activePath = this.activeProjectWorkspacePath(snapshot);
    const canLocate = Boolean(
      activePath && findProjectTreeNode(tree, activePath),
    );
    const canChangeSubtree = this.state.projectTreeSelection?.kind === "directory";
    return `
      <button class="compact-icon-button" id="locate-project-file" type="button" aria-label="Locate current file in project" title="Locate current file" ${canLocate ? "" : "disabled"}>${icon("locate", 14)}</button>
      <button class="compact-icon-button" id="expand-project-folder" type="button" aria-label="Expand selected folder" title="Expand selected folder" ${canChangeSubtree ? "" : "disabled"}>${icon("expand", 14)}</button>
      <button class="compact-icon-button" id="collapse-project-folder" type="button" aria-label="Collapse selected folder" title="Collapse selected folder" ${canChangeSubtree ? "" : "disabled"}>${icon("collapse", 14)}</button>`;
  }

  private renderProjectNavigation(tree: ProjectTreeNode[]): string {
    if (tree.length === 0 && this.state.projectFilesLoading) {
      return this.loadingBlock("Loading project files…");
    }
    if (tree.length === 0 && this.state.projectFilesError) {
      return this.retryState(
        "Could not list project files",
        this.state.projectFilesError,
        "retry-project-files",
        "folder",
      );
    }
    const notices = [
      this.state.projectFilesLoading
        ? '<div class="project-tree-notice"><span class="spinner"></span><span>Refreshing files…</span></div>'
        : "",
      this.state.projectFilesTruncated
        ? '<div class="project-tree-notice warning"><span>!</span><span>Showing a bounded project catalog; some paths were omitted.</span></div>'
        : "",
      this.state.projectFilesError
        ? `<div class="project-tree-notice warning"><span>!</span><span>${escapeHtml(this.state.projectFilesError)}</span></div>`
        : "",
    ].join("");
    return `<div class="project-tree" role="tree" aria-label="Project files">${tree.map((node) => this.renderProjectNode(node, 0)).join("")}</div>${notices}`;
  }

  private renderProjectNode(node: ProjectTreeNode, depth: number): string {
    const selected =
      this.state.projectTreeSelection?.path === node.path &&
      this.state.projectTreeSelection.kind === node.kind;
    const statusClass = `file-status-${node.status}`;
    if (node.kind === "directory") {
      const expanded = this.state.expandedProjectDirectories.has(node.path);
      const children = expanded
        ? node.children.map((child) => this.renderProjectNode(child, depth + 1)).join("")
        : "";
      return `<details class="project-directory ${statusClass}" data-project-directory-container="${escapeAttribute(node.path)}" data-project-rendered-expanded="${expanded}" ${expanded ? "open" : ""}><summary class="project-node-row ${selected ? "selected" : ""}" role="treeitem" style="--tree-depth:${depth}" data-project-node="${escapeAttribute(node.path)}" data-project-directory="${escapeAttribute(node.path)}" data-project-status="${node.status}" aria-selected="${selected}" aria-expanded="${expanded}" title="${escapeAttribute(`${node.path} · ${changeLabel(node.status)}`)}"><span class="tree-chevron">${icon("chevron", 12)}</span>${icon("folder", 15)}<span class="project-node-label">${escapeHtml(node.name)}</span></summary><div role="group">${children}</div></details>`;
    }
    return `<button class="project-file-row project-node-row ${statusClass} ${selected ? "selected" : ""}" type="button" role="treeitem" style="--tree-depth:${depth}" data-project-node="${escapeAttribute(node.path)}" data-project-file="${escapeAttribute(node.path)}" data-project-status="${node.status}" aria-selected="${selected}" title="${escapeAttribute(`${node.path} · ${changeLabel(node.status)}`)}"><span class="project-file-glyph">${fileTypeIcon(node.name)}</span><span class="project-node-label">${escapeHtml(node.name)}</span></button>`;
  }

  private bindProjectEvents(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    this.root
      .querySelector<HTMLButtonElement>("#retry-project-files")
      ?.addEventListener("click", () => {
        void this.loadProjectFiles(snapshot.root);
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
      .querySelectorAll<HTMLDetailsElement>("[data-project-directory-container]")
      .forEach((details) => {
        details.addEventListener("toggle", () => {
          const path = details.dataset.projectDirectoryContainer;
          if (!path) return;
          const renderedExpanded = details.dataset.projectRenderedExpanded === "true";
          if (details.open) this.state.expandedProjectDirectories.add(path);
          else this.state.expandedProjectDirectories.delete(path);
          details
            .querySelector<HTMLElement>(":scope > summary")
            ?.setAttribute("aria-expanded", String(details.open));
          if (details.open !== renderedExpanded) {
            this.renderLeftTool();
            queueMicrotask(() => {
              Array.from(
                this.root.querySelectorAll<HTMLElement>("[data-project-directory]"),
              )
                .find((row) => row.dataset.projectDirectory === path)
                ?.focus();
            });
          }
        });
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-project-directory]")
      .forEach((row) => {
        row.addEventListener("click", () => {
          const path = row.dataset.projectDirectory;
          if (!path) return;
          this.state.projectTreeSelection = { path, kind: "directory" };
          this.markProjectTreeSelection(path);
        });
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-project-file]").forEach((row) => {
      row.addEventListener("click", () => {
        const path = row.dataset.projectFile;
        const current = this.state.snapshot;
        if (!path || !current) return;
        this.state.projectTreeSelection = { path, kind: "file" };
        this.markProjectTreeSelection(path);
        if (row.dataset.projectStatus === "ignored") {
          this.setStatus("Ignored entries are shown for context and are not opened", "normal");
          return;
        }
        const file = this.state.repositoryFiles.find(
          (candidate) => candidate.workspacePath === path,
        ) ?? { repositoryId: ".", path, workspacePath: path };
        void this.openProjectFile(current.root, file);
      });
    });
  }

  private markProjectTreeSelection(path: string): void {
    this.root.querySelectorAll<HTMLElement>("[data-project-node]").forEach((row) => {
      const selected = row.dataset.projectNode === path;
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-selected", String(selected));
    });
    const directorySelected = this.state.projectTreeSelection?.kind === "directory";
    this.root.querySelectorAll<HTMLButtonElement>(
      "#expand-project-folder, #collapse-project-folder",
    ).forEach((button) => {
      button.disabled = !directorySelected;
    });
  }

  private locateCurrentProjectFile(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    const activePath = this.activeProjectWorkspacePath(snapshot);
    if (!activePath) return;
    if (!findProjectTreeNode(this.projectTree(snapshot), activePath)) {
      this.setStatus("The current file is outside the bounded project tree", "warning");
      return;
    }
    for (const path of ancestorProjectDirectories(activePath)) {
      this.state.expandedProjectDirectories.add(path);
    }
    this.state.projectTreeSelection = {
      path: activePath,
      kind: "file",
    };
    this.renderLeftTool();
    queueMicrotask(() => {
      const target = Array.from(
        this.root.querySelectorAll<HTMLElement>("[data-project-node]"),
      ).find((row) => row.dataset.projectNode === activePath);
      target?.scrollIntoView({ block: "center" });
      target?.focus();
    });
  }

  private activeProjectWorkspacePath(snapshot: RepositorySnapshot): string | null {
    const active = this.activeDocument();
    if (active.kind === "welcome" || active.repositoryRoot !== snapshot.root) return null;
    if (active.kind === "project-file") return active.workspacePath;
    if (active.kind === "working-diff") return active.selection.path;
    return (
      this.state.repositoryFiles.find(
        (file) => file.repositoryId === active.repositoryId && file.path === active.path,
      )?.workspacePath ?? null
    );
  }

  private setSelectedProjectFolderExpanded(expanded: boolean): void {
    const selection = this.state.projectTreeSelection;
    const snapshot = this.state.snapshot;
    if (!selection || selection.kind !== "directory" || !snapshot) return;
    const node = findProjectTreeNode(this.projectTree(snapshot), selection.path);
    if (!node || node.kind !== "directory") return;
    for (const path of descendantProjectDirectories(node)) {
      if (expanded) this.state.expandedProjectDirectories.add(path);
      else this.state.expandedProjectDirectories.delete(path);
    }
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
    this.captureMountedTextEditor();
    const document: ProjectFileDocument = {
      kind: "project-file",
      repositoryRoot,
      repositoryId: file.repositoryId,
      path: file.path,
      workspacePath: file.workspacePath,
    };
    const existing = textTab(this.state.editor, editorDocumentKey(document));
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
    let opened = openTextDocument(this.state.editor, document);
    if (opened.limitReached) {
      this.setStatus("Close a text tab before opening another file", "warning");
      return;
    }
    if (searchMatch && existing?.status === "ready" && opened.tabId) {
      const reload = beginTextReload(opened.session, opened.tabId);
      if (reload.loadEpoch === null) {
        this.setStatus("Search location could not be refreshed safely", "warning");
        return;
      }
      opened = {
        ...opened,
        session: reload.session,
        loadEpoch: reload.loadEpoch,
        needsLoad: true,
      };
    }
    this.state.editor = opened.session;
    this.renderEditor();
    if (!opened.needsLoad || !opened.tabId || opened.loadEpoch === null) {
      const current = opened.tabId ? textTab(this.state.editor, opened.tabId) : null;
      if (current?.status === "ready") {
        this.rememberRecentFile(repositoryRoot, file);
        if (searchMatch) this.applySearchNavigation(current, searchMatch);
      }
      return;
    }

    try {
      const snapshot = await bridge.readTextFile(
        repositoryRoot,
        file.repositoryId,
        file.path,
      );
      this.state.editor = completeTextLoad(
        this.state.editor,
        opened.tabId,
        opened.loadEpoch,
        snapshot,
      );
      this.renderEditor();
      const current = textTab(this.state.editor, opened.tabId);
      if (current?.status === "ready" && current.revision === snapshot.revision) {
        this.rememberRecentFile(repositoryRoot, file);
        if (searchMatch) this.applySearchNavigation(current, searchMatch);
      }
    } catch (error) {
      this.state.editor = failTextLoad(
        this.state.editor,
        opened.tabId,
        opened.loadEpoch,
        errorMessage(error),
      );
      this.renderEditor();
      this.showError(error);
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
      this.state.snapshot?.root ?? null,
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
      if (!this.textEditor.selectRange(match.fromUtf16, match.toUtf16)) {
        this.setStatus("Search location is no longer valid; run the search again", "warning");
      }
    });
  }

  private renderChangeNavigation(snapshot: RepositorySnapshot): string {
    if (snapshot.changes.length === 0) {
      if (snapshot.untrackedState === "pending") {
        return this.emptyState(
          "Checking for untracked files",
          "Tracked changes are ready. The remaining working tree is still being scanned.",
          "changes",
          true,
        );
      }
      if (snapshot.untrackedState === "failed") {
        return this.emptyState(
          "Untracked scan failed",
          "Tracked state is available. Refresh to try the remaining scan again.",
          "changes",
          true,
        );
      }
      return this.emptyState(
        "Working tree clean",
        "There are no local changes to review.",
        "check",
        true,
      );
    }
    return `
      <div class="changes-navigation">
        ${this.renderChangeToolbar()}
        <div class="change-results" id="change-results">
          ${this.renderChangeResults(snapshot, this.filteredChanges(snapshot))}
        </div>
      </div>`;
  }

  private renderChangeToolbar(): string {
    const staged = Array.from(this.state.selectedChangeKeys).filter((key) =>
      key.startsWith("index:"),
    ).length;
    const unstaged = this.state.selectedChangeKeys.size - staged;
    return `
      <div class="change-toolbar">
        <label class="change-filter" for="change-filter">
          ${icon("search", 14)}
          <input id="change-filter" type="search" value="${escapeAttribute(this.state.changeQuery)}" placeholder="Filter changed files…" autocomplete="off" spellcheck="false" aria-label="Filter changed files" aria-keyshortcuts="Control+F Meta+F" />
          <span>Ctrl F</span>
        </label>
        <div class="selection-toolbar" aria-label="Selected change actions">
          <span>${this.state.selectedChangeKeys.size} selected</span>
          <div>
            <button type="button" data-selection-action="unstage" ${staged === 0 ? "disabled" : ""}>Unstage${staged ? ` ${staged}` : ""}</button>
            <button type="button" data-selection-action="stage" ${unstaged === 0 ? "disabled" : ""}>Stage${unstaged ? ` ${unstaged}` : ""}</button>
            <button type="button" data-selection-action="clear" ${this.state.selectedChangeKeys.size === 0 ? "disabled" : ""} aria-label="Clear change selection">Clear</button>
          </div>
        </div>
      </div>`;
  }

  private renderChangeResults(
    snapshot: RepositorySnapshot,
    changes: FileChange[],
  ): string {
    if (changes.length === 0) {
      return `<div class="change-no-results"><strong>No matching files</strong><span>Try another path or status.</span></div>`;
    }
    const staged = changes.filter(hasStagedChange);
    const unstaged = changes.filter(hasWorktreeChange);
    return [
      this.renderChangeGroup("Staged", staged, true),
      this.renderChangeGroup("Unstaged", unstaged, false),
      this.untrackedScanNotice(snapshot),
    ].join("");
  }

  private filteredChanges(snapshot: RepositorySnapshot): FileChange[] {
    const query = this.state.changeQuery.trim().toLocaleLowerCase();
    if (!query) return snapshot.changes;
    return snapshot.changes.filter((change) =>
      [
        change.path,
        change.originalPath ?? "",
        change.indexStatus,
        change.worktreeStatus,
        hasStagedChange(change) ? "staged" : "",
        hasWorktreeChange(change) ? "unstaged working tree" : "",
        change.conflicted ? "conflict conflicted" : "",
      ].some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }

  private untrackedScanNotice(snapshot: RepositorySnapshot): string {
    if (snapshot.untrackedState === "complete") return "";
    const failed = snapshot.untrackedState === "failed";
    return `<div class="untracked-scan ${failed ? "failed" : ""}">${failed ? '<span class="scan-alert">!</span>' : '<span class="spinner"></span>'}<span>${failed ? "Untracked files could not be scanned. Refresh to retry." : "Scanning untracked files… counts are provisional."}</span></div>`;
  }

  private renderChangeGroup(
    title: string,
    changes: FileChange[],
    staged: boolean,
  ): string {
    const action = staged ? "Unstage all" : "Stage all";
    return `
      <section class="change-group">
        <div class="group-header">
          <span>${title}<b>${changes.length}</b></span>
          <button class="group-action" data-group-action="${staged ? "unstage" : "stage"}" type="button" ${changes.length === 0 ? "disabled" : ""}>${action}</button>
        </div>
        <div class="change-list">
          ${changes.length === 0 ? '<div class="group-empty">No files</div>' : changes.map((change) => this.changeRow(change, staged)).join("")}
        </div>
      </section>
    `;
  }

  private changeRow(change: FileChange, staged: boolean): string {
    const kind = staged ? change.indexStatus : change.worktreeStatus;
    const key = changeSelectionKey(change.path, staged);
    const selected = this.state.selectedChangeKeys.has(key);
    const primary =
      this.state.selectedChange?.path === change.path &&
      this.state.selectedChange.staged === staged;
    const actionLabel = staged ? "Unstage" : "Stage";
    return `
      <div class="change-row file-status-${kind} ${selected ? "selected" : ""} ${primary ? "primary" : ""}" role="option" tabindex="0" data-change-key="${escapeAttribute(key)}" data-change-path="${escapeAttribute(change.path)}" data-staged="${staged}" aria-selected="${selected}" aria-label="${selected ? "Selected, " : ""}view ${staged ? "staged" : "working tree"} diff for ${escapeAttribute(change.path)}">
        <span class="change-status status-${kind}" title="${changeLabel(kind)}">${changeCode(kind)}</span>
        <span class="change-path">
          <span class="file-name">${escapeHtml(basename(change.path))}</span>
          <span class="file-directory">${escapeHtml(dirname(change.path))}</span>
        </span>
        ${change.conflicted ? '<span class="conflict-pill">Conflict</span>' : ""}
        <button class="row-action" data-path-action="${staged ? "unstage" : "stage"}" type="button" title="${actionLabel} ${escapeAttribute(change.path)}" aria-label="${actionLabel} ${escapeAttribute(change.path)}">${icon(staged ? "minus" : "plus", 15)}</button>
      </div>
    `;
  }

  private renderHistoryNavigation(): string {
    const filtered = this.filteredHistory();
    const scope = this.historyScope();
    const snapshot = this.state.snapshot!;
    const results =
      this.state.history.status === "loading"
        ? this.loadingBlock("Loading filtered history…")
        : this.state.history.status === "error"
          ? this.retryState(
              "Could not load history",
              this.state.history.error ?? "The selected history query could not be read.",
              "retry-ref-history",
              "history",
            )
          : this.state.history.commits.length === 0
            ? `<div class="history-no-results"><strong>No commits match these filters</strong><span>Clear one or more history filters to widen the query.</span></div>`
            : this.renderHistoryRows(filtered.commits, filtered.error);
    return `
      <div class="history-navigation">
        <div class="history-toolbar">
          <div class="history-search-control">
            <label class="history-filter" for="history-filter">
              ${icon("search", 14)}
              <input id="history-filter" type="search" value="${escapeAttribute(this.state.historyQuery)}" placeholder="Text or hash" autocomplete="off" spellcheck="false" aria-label="Filter commit history" aria-keyshortcuts="Control+F Meta+F" />
            </label>
            <button class="history-mode-button ${this.state.historyRegularExpression ? "active" : ""}" type="button" data-history-text-mode="regex" aria-pressed="${this.state.historyRegularExpression}" title="Use regular expression">.*</button>
            <button class="history-mode-button ${this.state.historyCaseSensitive ? "active" : ""}" type="button" data-history-text-mode="case" aria-pressed="${this.state.historyCaseSensitive}" title="Match case">Cc</button>
          </div>
          <div class="history-filter-strip" aria-label="History query filters">
            ${this.historyFilterButton("branch", scope.label, this.state.historyRefs.size > 0, scope.title)}
            ${this.historyFilterButton("user", this.historyUserLabel(), this.state.historyCurrentAuthor || this.state.historyAuthorEmails.size > 0, "Filter by commit author")}
            ${this.historyFilterButton("date", this.historyDateLabel(), this.state.historyDatePreset !== "all", "Filter by commit date")}
            ${this.historyFilterButton("paths", this.historyPathLabel(), this.state.historyPaths.size > 0 || this.state.historyRepositoryIds.size > 0, "Filter by repository paths or Git roots")}
            ${this.historyFilterButton("graph", "", this.state.historyOrder !== "topological" || this.state.historyFirstParent || this.state.historyExcludeMerges, "Graph order and traversal options", "sort")}
          </div>
          <span class="compact-count" id="history-count">0</span>
          <span class="history-refresh-status" id="history-refresh-status" role="status"></span>
          ${this.renderHistoryFilterPopover(snapshot)}
        </div>
        <div class="history-results" id="history-results" aria-live="polite">
          ${results}
        </div>
      </div>`;
  }

  private historyFilterButton(
    menu: HistoryFilterMenu,
    label: string,
    active: boolean,
    title: string,
    iconName?: "sort",
  ): string {
    const open = this.state.historyFilterMenu === menu;
    const menuIcon =
      iconName ??
      (menu === "branch"
        ? "branch"
        : menu === "user"
          ? "user"
          : menu === "date"
            ? "calendar"
            : "folder");
    return `<button class="history-filter-button ${active ? "active" : ""} ${open ? "open" : ""}" type="button" data-history-menu="${menu}" aria-expanded="${open}" aria-label="${escapeAttribute(title)}" title="${escapeAttribute(title)}">${icon(menuIcon, 13)}${iconName ? "" : `<span>${escapeHtml(label)}</span><span class="history-filter-chevron">${icon("chevron-down", 10)}</span>`}</button>`;
  }

  private renderHistoryFilterPopover(snapshot: RepositorySnapshot): string {
    const menu = this.state.historyFilterMenu;
    if (!menu) return "";
    const body =
      menu === "branch"
        ? this.renderHistoryBranchMenu(snapshot)
        : menu === "user"
          ? this.renderHistoryUserMenu(snapshot)
          : menu === "date"
            ? this.renderHistoryDateMenu()
            : menu === "paths"
              ? this.renderHistoryPathMenu()
              : this.renderHistoryGraphMenu();
    return `<div class="history-filter-popover history-filter-popover-${menu}" role="menu">${body}</div>`;
  }

  private renderHistoryBranchMenu(snapshot: RepositorySnapshot): string {
    const selectedRootIds = effectiveHistoryRootIds(
      snapshot.repositoryRoots.map((root) => root.id),
      this.state.historyRepositoryIds,
    );
    const activeBranches = snapshot.branches.filter((branch) =>
      selectedRootIds.has(branch.repositoryId),
    );
    const available = new Map(snapshot.branches.map((branch) => [branchKey(branch), branch]));
    const favorites = uniqueLogicalBranches(
      Array.from(this.state.historyFavoriteRefs.keys()).flatMap((key) => {
        const branch = available.get(key);
        return branch && selectedRootIds.has(branch.repositoryId) ? [branch] : [];
      }),
    );
    const recent = uniqueLogicalBranches(
      this.state.historyRecentRefs.flatMap((reference) => {
        const branch = available.get(historyRefKey(reference));
        return branch && selectedRootIds.has(branch.repositoryId) ? [branch] : [];
      }),
    );
    const local = uniqueLogicalBranches(
      activeBranches.filter((branch) => branch.kind === "local"),
    );
    const tags = uniqueLogicalBranches(
      activeBranches.filter((branch) => branch.kind === "tag"),
    );
    const remotes = groupRemoteBranches(
      uniqueLogicalBranches(activeBranches.filter((branch) => branch.kind === "remote")),
    );
    const submenu = this.renderHistoryBranchSubmenu(snapshot, recent, local, tags, remotes);
    return `
      <button class="history-menu-option" type="button" data-history-open-dialog="branches"><span>Select…</span></button>
      ${recent.length > 0 ? this.historySubmenuLauncher("recent", "Recent") : ""}
      ${favorites.length > 0 ? `<div class="history-menu-heading">Favorites</div>${favorites.map((branch) => this.renderHistoryQuickRef(branch, snapshot)).join("")}` : ""}
      ${local.length > 0 ? this.historySubmenuLauncher("local", "Local") : ""}
      ${remotes.map((remote) => this.historySubmenuLauncher(`remote:${remote.name}`, `${remote.name}/…`)).join("")}
      ${tags.length > 0 ? this.historySubmenuLauncher("tags", "Tags") : ""}
      ${submenu}`;
  }

  private historySubmenuLauncher(id: string, label: string): string {
    const open = this.state.historyBranchSubmenu === id;
    return `<button class="history-menu-option history-submenu-launcher" type="button" data-history-branch-submenu="${escapeAttribute(id)}" aria-expanded="${open}"><span>${escapeHtml(label)}</span>${icon("chevron", 12)}</button>`;
  }

  private renderHistoryBranchSubmenu(
    snapshot: RepositorySnapshot,
    recent: BranchSummary[],
    local: BranchSummary[],
    tags: BranchSummary[],
    remotes: ReturnType<typeof groupRemoteBranches>,
  ): string {
    const id = this.state.historyBranchSubmenu;
    if (!id) return "";
    const branches =
      id === "recent"
        ? recent
        : id === "local"
          ? local
          : id === "tags"
            ? tags
            : remotes.find((remote) => `remote:${remote.name}` === id)?.branches.map(({ branch }) => branch) ?? [];
    if (branches.length === 0) return "";
    return `<div class="history-branch-submenu" role="menu" aria-label="${escapeAttribute(id)}">${branches.map((branch) => this.renderHistoryQuickRef(branch, snapshot)).join("")}</div>`;
  }

  private renderHistoryQuickRef(branch: BranchSummary, snapshot: RepositorySnapshot): string {
    const matches = this.matchingHistoryBranches(branch, snapshot);
    const selected = matches.length > 0 && matches.every((candidate) =>
      this.state.historyRefs.has(branchKey(candidate)),
    );
    const glyph = branch.current ? "head" : branch.kind === "tag" ? "tag" : "branch";
    const root = snapshot.repositoryRoots.find((item) => item.id === branch.repositoryId);
    const suffix = matches.length > 1
      ? `<small>${matches.length} roots</small>`
      : snapshot.repositoryRoots.length > 1
        ? `<small>${escapeHtml(root?.displayName ?? branch.repositoryId)}</small>`
        : "";
    return `<button class="history-menu-option two-line" type="button" data-history-quick-ref="${escapeAttribute(branchKey(branch))}" aria-pressed="${selected}" title="${escapeAttribute(branch.fullName)}"><span><strong>${icon(glyph, 13)}${escapeHtml(branch.name)}</strong>${suffix}</span>${selected ? icon("check", 13) : ""}</button>`;
  }

  private matchingHistoryBranches(
    branch: BranchSummary,
    snapshot: RepositorySnapshot,
  ): BranchSummary[] {
    const selectedRootIds = effectiveHistoryRootIds(
      snapshot.repositoryRoots.map((root) => root.id),
      this.state.historyRepositoryIds,
    );
    return matchingLogicalBranches(snapshot.branches, branch, selectedRootIds);
  }

  private allMatchingHistoryBranches(
    branch: BranchSummary,
    snapshot: RepositorySnapshot,
  ): BranchSummary[] {
    return matchingLogicalBranches(
      snapshot.branches,
      branch,
      new Set(snapshot.repositoryRoots.map((root) => root.id)),
    );
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

  private renderHistoryUserMenu(snapshot: RepositorySnapshot): string {
    const choices = historyAuthorChoices(snapshot.commits);
    const allSelected = !this.state.historyCurrentAuthor && this.state.historyAuthorEmails.size === 0;
    return `<button class="history-menu-option" type="button" data-history-clear-users aria-pressed="${allSelected}"><span>All users</span>${allSelected ? icon("check", 13) : ""}</button><div class="history-menu-heading">Identity</div><button class="history-menu-option" type="button" data-history-me aria-pressed="${this.state.historyCurrentAuthor}"><span>me</span>${this.state.historyCurrentAuthor ? icon("check", 13) : ""}</button><div class="history-menu-heading">Loaded authors</div>${choices
      .map((choice) => {
        const selected = this.state.historyAuthorEmails.has(choice.email);
        return `<button class="history-menu-option two-line" type="button" data-history-author="${escapeAttribute(choice.email)}" aria-pressed="${selected}"><span><strong>${escapeHtml(choice.name)}</strong><small>${escapeHtml(choice.email)}</small></span><em>${choice.count}</em>${selected ? icon("check", 13) : ""}</button>`;
      })
      .join("")}`;
  }

  private renderHistoryDateMenu(): string {
    const options: Array<[HistoryDatePreset, string]> = [
      ["all", "All dates"],
      ["day", "Last 24 hours"],
      ["week", "Last 7 days"],
    ];
    return options
      .map(([preset, label]) => {
        const selected = this.state.historyDatePreset === preset;
        return `<button class="history-menu-option" type="button" data-history-date="${preset}" aria-pressed="${selected}"><span>${label}</span>${selected ? icon("check", 13) : ""}</button>`;
      })
      .join("");
  }

  private renderHistoryPathMenu(): string {
    const snapshot = this.state.snapshot!;
    const roots = snapshot.repositoryRoots;
    const selectedRoots = effectiveHistoryRootIds(
      roots.map((root) => root.id),
      this.state.historyRepositoryIds,
    );
    const recent = this.state.historyRecentPaths.flatMap((path) => {
      const candidate = historyPathCandidates(this.state.repositoryFiles).find(
        (item) => historyPathKey(item) === historyPathKey(path),
      );
      return candidate ? [candidate] : [];
    });
    return `
      <button class="history-menu-option" type="button" data-history-open-dialog="paths-text"><span>Select…</span></button>
      <button class="history-menu-option" type="button" data-history-open-dialog="paths-tree"><span>Select in Tree…</span></button>
      ${roots.length > 1 ? `<div class="history-menu-heading">Roots</div>${roots.map((root) => this.renderHistoryRootOption(root, selectedRoots)).join("")}` : ""}
      ${recent.length > 0 ? `<div class="history-menu-heading">Recent</div>${recent.map((path) => this.renderHistoryQuickPath(path)).join("")}` : ""}
      ${this.state.projectFilesLoading ? '<div class="history-menu-note">Loading tracked paths…</div>' : ""}
      ${this.state.projectFilesError ? '<div class="history-menu-note warning">Tracked paths could not be loaded.</div>' : ""}
      ${this.state.projectFilesTruncated ? '<div class="history-menu-note">Tree selection uses the bounded project file set.</div>' : ""}`;
  }

  private renderHistoryRootOption(
    root: GitRootDescriptor,
    selectedRoots: ReadonlySet<string>,
  ): string {
    const selected = selectedRoots.has(root.id);
    const lastSelected = selected && selectedRoots.size === 1;
    return `<label class="history-menu-option history-root-option two-line" title="${lastSelected ? "At least one module must remain selected" : `Include ${escapeAttribute(root.displayName)} history`}"><input type="checkbox" data-history-root="${escapeAttribute(root.id)}" ${selected ? "checked" : ""} ${lastSelected ? "disabled" : ""} /><span><strong>${icon("folder", 13)}${escapeHtml(root.displayName)}</strong><small>${escapeHtml(root.relativePath)}</small></span></label>`;
  }

  private renderHistoryQuickPath(path: HistoryPath): string {
    const label = historyPathWorkspaceLabel(path, this.state.repositoryFiles);
    const selected = this.state.historyPaths.has(historyPathKey(path));
    return `<button class="history-menu-option" type="button" data-history-quick-path="${escapeAttribute(historyPathKey(path))}" aria-pressed="${selected}" title="${escapeAttribute(label)}"><span>${icon("file", 13)}${escapeHtml(label)}</span>${selected ? icon("check", 13) : ""}</button>`;
  }

  private renderHistoryGraphMenu(): string {
    return `<div class="history-menu-heading">Sort</div><button class="history-menu-option" type="button" data-history-order="date" aria-pressed="${this.state.historyOrder === "date"}"><span>By commit date</span>${this.state.historyOrder === "date" ? icon("check", 13) : ""}</button><button class="history-menu-option" type="button" data-history-order="topological" aria-pressed="${this.state.historyOrder === "topological"}"><span>Topologically</span>${this.state.historyOrder === "topological" ? icon("check", 13) : ""}</button><div class="history-menu-heading">Options</div><button class="history-menu-option" type="button" data-history-graph-option="first-parent" aria-pressed="${this.state.historyFirstParent}"><span>First Parent</span>${this.state.historyFirstParent ? icon("check", 13) : ""}</button><button class="history-menu-option" type="button" data-history-graph-option="no-merges" aria-pressed="${this.state.historyExcludeMerges}"><span>No Merges</span>${this.state.historyExcludeMerges ? icon("check", 13) : ""}</button><div class="history-menu-heading">Branch actions</div><button class="history-menu-option" type="button" data-history-collapse-linear aria-pressed="${this.state.historyCollapseLinear}"><span>${this.state.historyCollapseLinear ? "Expand Linear Branches" : "Collapse Linear Branches"}</span>${this.state.historyCollapseLinear ? icon("check", 13) : ""}</button>`;
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
        .map((path) => historyPathWorkspaceLabel(path, this.state.repositoryFiles))
        .join("\n");
    }
    this.renderBottomTool();
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
    host.innerHTML =
      kind === "branches"
        ? this.renderHistoryBranchDialog()
        : kind === "paths-text"
          ? this.renderHistoryPathTextDialog()
          : this.renderHistoryPathTreeDialog();
    this.bindHistoryDialogEvents();
  }

  private renderHistoryBranchDialog(): string {
    const snapshot = this.state.snapshot!;
    const query = this.state.historyDialogQuery.trim().toLocaleLowerCase();
    const branches = snapshot.branches.filter((branch) => {
      const root = snapshot.repositoryRoots.find((item) => item.id === branch.repositoryId);
      return !query || [branch.name, branch.fullName, branch.subject, root?.displayName ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
    const groups = snapshot.repositoryRoots.map((root) => ({
      root,
      branches: branches.filter((branch) => branch.repositoryId === root.id),
    })).filter(({ branches: items }) => items.length > 0);
    const rows = groups.length === 0
      ? '<div class="history-dialog-empty">No matching branches or tags.</div>'
      : groups.map(({ root, branches: items }) => `<section class="history-dialog-group"><h3>${escapeHtml(root.displayName)}<small>${escapeHtml(root.relativePath)}</small></h3>${items.map((branch) => this.renderHistoryDialogRef(branch)).join("")}</section>`).join("");
    return `<section class="dialog history-selection-dialog" role="dialog" aria-modal="true" aria-labelledby="history-dialog-title">
      ${this.historyDialogHeading("Select Branches or Tags")}
      <label class="history-dialog-search" for="history-dialog-search">${icon("search", 14)}<input id="history-dialog-search" type="search" value="${escapeAttribute(this.state.historyDialogQuery)}" placeholder="Branch or tag" autocomplete="off" spellcheck="false" /></label>
      <div class="history-dialog-list" role="group" aria-label="Available branches and tags">${rows}</div>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-history-dialog-clear>Clear</button><span class="dialog-spacer"></span><button class="secondary-button" type="button" data-history-dialog-cancel>Cancel</button><button class="primary-button" type="button" data-history-dialog-apply>Apply ${this.state.historyRefDraft.size || "all"}</button></div>
    </section>`;
  }

  private renderHistoryDialogRef(branch: BranchSummary): string {
    const key = branchKey(branch);
    const selected = this.state.historyRefDraft.has(key);
    const favorite = this.state.historyFavoriteRefs.has(key);
    const glyph = branch.current ? "head" : branch.kind === "tag" ? "tag" : "branch";
    return `<div class="history-dialog-ref"><label><input type="checkbox" data-history-dialog-ref="${escapeAttribute(key)}" ${selected ? "checked" : ""} /><span>${icon(glyph, 13)}<strong>${escapeHtml(branch.name)}</strong><small>${escapeHtml(branch.subject)}</small></span></label><button class="history-favorite-button ${favorite ? "active" : ""}" type="button" data-history-dialog-favorite="${escapeAttribute(key)}" aria-pressed="${favorite}" aria-label="${favorite ? "Remove from" : "Add to"} favorites">${icon("star", 13)}</button></div>`;
  }

  private renderHistoryPathTextDialog(): string {
    return `<section class="dialog history-selection-dialog history-path-text-dialog" role="dialog" aria-modal="true" aria-labelledby="history-dialog-title">
      ${this.historyDialogHeading("Select Paths to Filter by")}
      <textarea id="history-path-text" spellcheck="false" autocomplete="off" aria-describedby="history-path-text-help">${escapeHtml(this.state.historyPathText)}</textarea>
      ${this.state.historyDialogError ? `<div class="history-dialog-error" role="alert">${escapeHtml(this.state.historyDialogError)}</div>` : ""}
      <p id="history-path-text-help">Enter one or more exact tracked files or directories on separate lines. Ctrl/Cmd+Enter applies the selection.</p>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-history-dialog-cancel>Cancel</button><button class="primary-button" type="button" data-history-dialog-apply>Apply</button></div>
    </section>`;
  }

  private renderHistoryPathTreeDialog(): string {
    const snapshot = this.state.snapshot!;
    const roots = snapshot.repositoryRoots.map((root) => {
      const files = this.state.repositoryFiles.filter((file) => file.repositoryId === root.id);
      const tree = buildProjectTree(files.map((file) => file.path));
      return `<section class="history-path-tree-root"><h3>${icon("folder", 14)}${escapeHtml(root.displayName)}<small>${escapeHtml(root.relativePath)}</small></h3>${tree.length > 0 ? tree.map((node) => this.renderHistoryPathTreeNode(node, root.id, 0)).join("") : '<div class="history-dialog-empty">No tracked paths.</div>'}</section>`;
    }).join("");
    return `<section class="dialog history-selection-dialog history-path-tree-dialog" role="dialog" aria-modal="true" aria-labelledby="history-dialog-title">
      ${this.historyDialogHeading("Select Paths to Filter by")}
      <div class="history-path-tree" role="tree" aria-label="Tracked repository paths">${roots}</div>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-history-dialog-clear>Clear</button><span class="dialog-spacer"></span><button class="secondary-button" type="button" data-history-dialog-cancel>Cancel</button><button class="primary-button" type="button" data-history-dialog-apply>Apply ${this.state.historyPathDraft.size}</button></div>
    </section>`;
  }

  private renderHistoryPathTreeNode(
    node: ProjectTreeNode,
    repositoryId: string,
    depth: number,
  ): string {
    const key = historyPathKey({ repositoryId, path: node.path });
    const selected = this.state.historyPathDraft.has(key);
    if (node.kind === "file") {
      return `<label class="history-path-tree-row file" role="treeitem" style="--tree-depth:${depth}"><span class="tree-chevron"></span><input type="checkbox" data-history-dialog-path="${escapeAttribute(key)}" ${selected ? "checked" : ""} />${icon("file", 13)}<span>${escapeHtml(node.name)}</span></label>`;
    }
    const collapsed = this.state.historyTreeCollapsed.has(key);
    return `<div class="history-path-tree-node" role="treeitem" aria-expanded="${!collapsed}">
      <div class="history-path-tree-row directory" style="--tree-depth:${depth}"><button type="button" data-history-tree-toggle="${escapeAttribute(key)}" aria-label="${collapsed ? "Expand" : "Collapse"} ${escapeAttribute(node.path)}">${icon("chevron", 11)}</button><input type="checkbox" data-history-dialog-path="${escapeAttribute(key)}" ${selected ? "checked" : ""} />${icon("folder", 13)}<span>${escapeHtml(node.name)}</span></div>
      <div role="group" ${collapsed ? "hidden" : ""}>${node.children.map((child) => this.renderHistoryPathTreeNode(child, repositoryId, depth + 1)).join("")}</div>
    </div>`;
  }

  private historyDialogHeading(title: string): string {
    return `<div class="dialog-heading"><h2 id="history-dialog-title">${escapeHtml(title)}</h2><button class="icon-button" type="button" data-history-dialog-cancel aria-label="Close">${icon("close", 16)}</button></div>`;
  }

  private renderHistoryRows(commits: CommitSummary[], textError: string | null = null): string {
    if (commits.length === 0) {
      return `${textError ? `<div class="history-text-error" role="status">Invalid expression: ${escapeHtml(textError)}</div>` : ""}<div class="history-no-results"><strong>No matching commits</strong><span>Try a message, author, decoration, or full hash.</span></div>${this.renderHistoryPagingStatus()}`;
    }
    const entries: HistoryDisplayEntry[] = this.state.historyCollapseLinear
      ? collapseLinearHistory(commits, this.state.selectedCommit)
      : commits.map((commit) => ({ kind: "commit", commit, graphCommit: commit }));
    const graph = projectCommitGraph(entries.map((entry) => entry.graphCommit), {
      bridgeOmittedParents: this.shouldBridgeOmittedGraphParents(commits),
    });
    const graphWidth = Math.max(22, 14 + (graph.laneCount - 1) * 12);
    return `${textError ? `<div class="history-text-error" role="status">Invalid expression: ${escapeHtml(textError)}. Showing the unfiltered result.</div>` : ""}<div class="history-list" role="listbox" aria-label="Commit history" style="--history-graph-width:${graphWidth}px">${entries
      .map((entry, index) => {
        if (entry.kind === "collapsed") {
          return `<button class="history-row history-collapsed-row" type="button" data-expand-linear-history data-first-collapsed="${escapeAttribute(entry.firstKey)}" title="Expand ${entry.count} linear commits">${this.renderCommitGraph(graph.rows[index]!, graphWidth, true)}<span class="history-subject">${entry.count} linear commits collapsed</span><span class="history-references"></span><span class="history-author">Expand</span><span class="history-date"></span></button>`;
        }
        const commit = entry.commit;
        const key = commitKey(commit);
        const selected = key === this.state.selectedCommit;
        const references = this.commitReferenceBadges(
          commit.decorations,
          2,
          commit.repositoryId,
        );
        const root = this.state.snapshot?.repositoryRoots.find(
          (item) => item.id === commit.repositoryId,
        );
        const rootBadge = (this.state.snapshot?.repositoryRoots.length ?? 0) > 1
          ? `<span class="history-root-badge" title="Git root: ${escapeAttribute(root?.relativePath ?? commit.repositoryId)}">${escapeHtml(root?.displayName ?? commit.repositoryId)}</span>`
          : "";
        return `
          <button class="history-row ${selected ? "selected" : ""}" type="button" role="option" data-commit="${commit.oid}" data-commit-key="${escapeAttribute(key)}" aria-selected="${selected}" title="${escapeAttribute(commit.subject)}">
            ${this.renderCommitGraph(graph.rows[index]!, graphWidth)}
            <span class="history-subject">${escapeHtml(commit.subject)}</span>
            <span class="history-references">${references}${rootBadge}</span>
            <span class="history-author" title="${escapeAttribute(`${commit.authorName} <${commit.authorEmail}>`)}">${escapeHtml(commit.authorName)}</span>
            <time class="history-date" datetime="${new Date(commit.authoredAt * 1000).toISOString()}">${escapeHtml(formatAbsolute(commit.authoredAt))}</time>
          </button>`;
      })
      .join("")}</div>${this.renderHistoryPagingStatus()}`;
  }

  private shouldBridgeOmittedGraphParents(commits: CommitSummary[]): boolean {
    const source = this.state.history.source;
    const query = source?.kind === "query" ? source.query : null;
    const omitsIntermediateCommits =
      commits.length < this.state.history.commits.length ||
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

  private renderHistoryPagingStatus(): string {
    if (this.state.historyLoadingMore) {
      return '<div class="history-page-status" role="status">Loading older commits…</div>';
    }
    if (this.state.historyPagingError) {
      return `<div class="history-page-status error" role="status"><span>${escapeHtml(this.state.historyPagingError)}</span><button type="button" data-retry-history-page>Retry</button></div>`;
    }
    if (this.state.history.commits.length >= HISTORY_ROW_LIMIT) {
      return `<div class="history-page-status">Showing the newest ${HISTORY_ROW_LIMIT.toLocaleString()} commits (session limit)</div>`;
    }
    if (this.state.historyHasMore) {
      return '<div class="history-page-status muted">Scroll to load older commits</div>';
    }
    const count = this.state.history.commits.length;
    return `<div class="history-page-status muted" title="No older commits are available for the current filters.">All history loaded · ${count.toLocaleString()} ${count === 1 ? "commit" : "commits"}</div>`;
  }

  private renderCommitGraph(
    row: CommitGraphRow,
    width: number,
    collapsed = false,
  ): string {
    const parentSummary =
      row.parentCount === 0
        ? "root commit"
        : row.parentCount === 1
          ? "one parent"
          : `merge commit with ${row.parentCount} parents`;
    const lines = row.segments
      .map(
        (segment) =>
          `<path class="commit-graph-line ${collapsed ? "collapsed" : ""} graph-color-${segment.color}" d="${this.commitGraphPath(segment)}" />`,
      )
      .join("");
    const nodeX = 7 + row.nodeLane * 12;
    const node = collapsed
      ? `<circle class="commit-graph-gap graph-color-${row.nodeColor}" cx="${nodeX}" cy="8" r="1.2"/><circle class="commit-graph-gap graph-color-${row.nodeColor}" cx="${nodeX}" cy="14" r="1.2"/><circle class="commit-graph-gap graph-color-${row.nodeColor}" cx="${nodeX}" cy="20" r="1.2"/>`
      : `<circle class="commit-graph-node graph-color-${row.nodeColor} ${row.parentCount > 1 ? "merge" : ""}" cx="${nodeX}" cy="14" r="${row.parentCount > 1 ? 4 : 3.5}" />`;
    const label = collapsed
      ? `Collapsed linear continuation in graph lane ${row.nodeLane + 1} of ${row.laneCount}`
      : `Graph lane ${row.nodeLane + 1} of ${row.laneCount}, ${parentSummary}`;
    return `<span class="history-graph" role="img" aria-label="${label}"><svg viewBox="0 0 ${width} 28" width="${width}" height="28" aria-hidden="true" focusable="false">${lines}${node}</svg></span>`;
  }

  private commitGraphPath(segment: CommitGraphSegment): string {
    const fromX = 7 + segment.fromLane * 12;
    const toX = 7 + segment.toLane * 12;
    const fromY = segment.kind === "parent" ? 14 : 0;
    const toY = segment.kind === "incoming" ? 14 : 28;
    if (fromX === toX) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
    const middleY = (fromY + toY) / 2;
    return `M ${fromX} ${fromY} C ${fromX} ${middleY}, ${toX} ${middleY}, ${toX} ${toY}`;
  }

  private historyScope(): {
    icon: "head" | "branch" | "tag";
    label: string;
    title: string;
  } {
    let refs = Array.from(this.state.historyRefs.values());
    if (refs.length === 0) {
      return {
        icon: "branch",
        label: "All refs",
        title: "History from local branches, remote-tracking branches, and tags",
      };
    }
    const snapshot = this.state.snapshot;
    if (snapshot) {
      const selectedRootIds = effectiveHistoryRootIds(
        snapshot.repositoryRoots.map((root) => root.id),
        this.state.historyRepositoryIds,
      );
      const activeRefs = refs.filter((reference) =>
        selectedRootIds.has(reference.repositoryId),
      );
      if (activeRefs.length > 0) refs = activeRefs;
    }
    const fullNames = new Set(refs.map((reference) => reference.fullName));
    if (fullNames.size === 1) {
      const reference = refs[0]!;
      const branch = this.state.snapshot?.branches.find(
        (candidate) => branchKey(candidate) === historyRefKey(reference),
      );
      return {
        icon: branch?.kind === "tag" ? "tag" : "branch",
        label: branch?.name ?? reference.fullName,
        title: refs.length === 1
          ? `${reference.fullName} — ${reference.repositoryId}`
          : `${reference.fullName} — ${refs.length} Git roots`,
      };
    }
    if (refs.length > 1) {
      return {
        icon: "branch",
        label: `Branch ${refs.length}`,
        title: refs
          .map((reference) => `${reference.fullName} — ${reference.repositoryId}`)
          .join(", "),
      };
    }
    const reference = refs[0]!;
    const branch = this.state.snapshot?.branches.find(
      (candidate) => branchKey(candidate) === historyRefKey(reference),
    );
    return {
      icon: branch?.kind === "tag" ? "tag" : "branch",
      label: branch?.name ?? reference.fullName,
      title: `${reference.fullName} — ${reference.repositoryId}`,
    };
  }

  private historyPathLabel(): string {
    const pathCount = this.state.historyPaths.size;
    const rootCount = this.state.historyRepositoryIds.size;
    if (pathCount > 1) return `Paths ${pathCount}`;
    if (pathCount === 1) {
      const path = Array.from(this.state.historyPaths.values())[0]!;
      return basename(historyPathWorkspaceLabel(path, this.state.repositoryFiles));
    }
    return rootCount > 0 ? `Roots ${rootCount}` : "Paths";
  }

  private historyUserLabel(): string {
    const count = this.state.historyAuthorEmails.size + (this.state.historyCurrentAuthor ? 1 : 0);
    return count === 0 ? "User" : count === 1 && this.state.historyCurrentAuthor ? "me" : `User ${count}`;
  }

  private historyDateLabel(): string {
    return this.state.historyDatePreset === "day"
      ? "24 hours"
      : this.state.historyDatePreset === "week"
        ? "7 days"
        : "Date";
  }

  private commitReferenceBadges(
    decorations: string[],
    limit: number,
    repositoryId = ".",
  ): string {
    const references = commitReferences(
      decorations,
      (this.state.snapshot?.branches ?? []).filter(
        (branch) => branch.repositoryId === repositoryId,
      ),
    );
    if (references.length === 0) return "";
    const visible = references.slice(0, limit);
    const remaining = references.length - visible.length;
    return `${visible.map((reference) => this.commitReferenceBadge(reference)).join("")}${remaining > 0 ? `<span class="commit-reference-more" title="${escapeAttribute(references.map((reference) => reference.label).join(", "))}">+${remaining}</span>` : ""}`;
  }

  private commitReferenceBadge(reference: CommitReference): string {
    const iconName = reference.kind === "head" ? "head" : reference.kind === "tag" || reference.kind === "other" ? "tag" : "branch";
    return `<span class="commit-reference ${reference.kind}" title="${escapeAttribute(capitalize(reference.kind))}: ${escapeAttribute(reference.label)}">${icon(iconName, 12)}<span>${escapeHtml(reference.label)}</span></span>`;
  }

  private filteredHistory(): ReturnType<typeof filterHistoryText> {
    return filterHistoryText(this.state.history.commits, this.state.historyQuery, {
      caseSensitive: this.state.historyCaseSensitive,
      regularExpression: this.state.historyRegularExpression,
    });
  }

  private filteredHistoryCommits(): CommitSummary[] {
    return this.filteredHistory().commits;
  }

  private renderBranchNavigation(snapshot: RepositorySnapshot): string {
    if (snapshot.branches.length === 0) {
      return this.emptyState("No refs", "Branches and tags will appear here.", "branch", true);
    }
    return `
      <div class="branch-navigation">
        <label class="branch-filter" for="branch-filter">
          ${icon("search", 14)}
          <input id="branch-filter" type="search" value="${escapeAttribute(this.state.branchQuery)}" placeholder="Branch or tag" autocomplete="off" spellcheck="false" aria-label="Filter branches and tags" />
          <span class="compact-count" id="branch-count">0</span>
        </label>
        <div class="branch-results" id="branch-results">${this.renderBranchGroups(snapshot)}</div>
      </div>`;
  }

  private renderBranchGroups(snapshot: RepositorySnapshot): string {
    const visible = this.filteredBranches(snapshot);
    if (visible.length === 0) {
      return `<div class="branch-no-results"><strong>No matching refs</strong><span>Try another branch, remote, or tag name.</span></div>`;
    }
    const groups: Array<[string, BranchSummary["kind"]]> = [
      ["Local", "local"],
      ["Remote", "remote"],
      ["Tags", "tag"],
    ];
    return groups
      .map(([label, kind]) => {
        const branches = visible.filter((branch) => branch.kind === kind);
        if (branches.length === 0) return "";
        const collapsed = this.state.collapsedBranchGroups.has(kind);
        const groupId = `branch-group-${kind}`;
        return `<section class="branch-group">
          <button class="group-header branch-group-toggle" type="button" data-branch-group-toggle="${kind}" aria-expanded="${!collapsed}" aria-controls="${groupId}">
            <span><span class="branch-group-chevron">${icon("chevron", 12)}</span>${label}<b>${branches.length}</b></span>
          </button>
          <div id="${groupId}" role="group" ${collapsed ? "hidden" : ""}>${kind === "remote" ? this.renderRemoteBranches(branches, snapshot) : branches.map((branch) => this.branchRow(branch, snapshot)).join("")}</div>
        </section>`;
      })
      .join("");
  }

  private activeBranches(snapshot: RepositorySnapshot): BranchSummary[] {
    const selectedRootIds = effectiveHistoryRootIds(
      snapshot.repositoryRoots.map((root) => root.id),
      this.state.historyRepositoryIds,
    );
    return snapshot.branches.filter((branch) => selectedRootIds.has(branch.repositoryId));
  }

  private logicalBranches(snapshot: RepositorySnapshot): BranchSummary[] {
    return uniqueLogicalBranches(this.activeBranches(snapshot));
  }

  private filteredBranches(snapshot: RepositorySnapshot): BranchSummary[] {
    const query = this.state.branchQuery.trim().toLocaleLowerCase();
    if (!query) return this.logicalBranches(snapshot);
    return uniqueLogicalBranches(
      this.activeBranches(snapshot).filter((branch) =>
        [branch.name, branch.fullName, branch.subject].some((value) =>
          value.toLocaleLowerCase().includes(query),
        ),
      ),
    );
  }

  private renderRemoteBranches(
    branches: BranchSummary[],
    snapshot: RepositorySnapshot,
  ): string {
    return groupRemoteBranches(branches)
      .map(
        (group) => `
          <section class="remote-ref-group">
            <div class="remote-root-row">${icon("chevron", 11)}${icon("folder", 14)}<span>${escapeHtml(group.name)}</span><small>${group.branches.length}</small></div>
            <div role="group">${group.branches.map(({ branch, displayName }) => this.branchRow(branch, snapshot, displayName, true)).join("")}</div>
          </section>`,
      )
      .join("");
  }

  private branchRow(
    branch: BranchSummary,
    snapshot: RepositorySnapshot,
    displayName = branch.name,
    nested = false,
  ): string {
    const key = branchKey(branch);
    const activeMatches = this.matchingHistoryBranches(branch, snapshot);
    const allMatches = this.allMatchingHistoryBranches(branch, snapshot);
    const selected = activeMatches.length > 0 && activeMatches.every((candidate) =>
      this.state.historyRefs.has(branchKey(candidate)),
    );
    const exclusive =
      allMatches.length === this.state.historyRefs.size &&
      allMatches.every((candidate) => this.state.historyRefs.has(branchKey(candidate)));
    const iconName = branch.current ? "head" : branch.kind === "tag" ? "tag" : "branch";
    const title = exclusive
      ? `${branch.name} — ${branch.subject} — Activate again to show all refs`
      : `${branch.name} — ${branch.subject}`;
    const root = snapshot.repositoryRoots.find((item) => item.id === branch.repositoryId);
    const meta = [
      branch.current ? "HEAD" : "",
      activeMatches.length > 1
        ? `${activeMatches.length} roots`
        : snapshot.repositoryRoots.length > 1
          ? (root?.displayName ?? branch.repositoryId)
          : "",
    ].filter(Boolean);
    return `
      <button class="branch-row kind-${branch.kind} ${nested ? "nested" : ""} ${selected ? "selected" : ""}" type="button" data-branch="${escapeAttribute(branch.fullName)}" data-branch-key="${escapeAttribute(key)}" aria-pressed="${selected}" title="${escapeAttribute(title)}">
        <span class="branch-glyph ${branch.current ? "current" : ""}">${icon(iconName, 14)}</span>
        <span class="branch-name">${escapeHtml(displayName)}</span>
        ${meta.length > 0 ? `<span class="branch-row-meta">${meta.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</span>` : ""}
      </button>`;
  }

  private bindChangeEvents(): void {
    const input = this.root.querySelector<HTMLInputElement>("#change-filter");
    input?.addEventListener("input", () => {
      this.state.changeQuery = input.value;
      this.renderFilteredChanges();
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        event.stopPropagation();
        input.value = "";
        this.state.changeQuery = "";
        this.renderFilteredChanges();
        return;
      }
      if (event.key === "Enter" || event.key === "ArrowDown") {
        const first = this.root.querySelector<HTMLElement>("[data-change-key]");
        if (!first) return;
        event.preventDefault();
        this.selectChangeRow(first, false, false, true);
      }
    });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-selection-action]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const action = button.dataset.selectionAction;
          if (action === "clear") {
            this.state.selectedChangeKeys.clear();
            this.state.selectedChange = null;
            this.changeSelectionAnchor = null;
            this.renderWorkspace();
            return;
          }
          const staged = action === "unstage";
          const prefix = staged ? "index:" : "worktree:";
          const paths = Array.from(this.state.selectedChangeKeys)
            .filter((key) => key.startsWith(prefix))
            .map(changePathFromKey);
          void this.mutatePaths(!staged, paths);
        });
      });
    this.bindChangeRowsAndGroups();
  }

  private bindChangeRowsAndGroups(): void {
    this.root.querySelectorAll<HTMLElement>("[data-change-path]").forEach((row) => {
      row.addEventListener("click", (event) => {
        const action = (event.target as HTMLElement).closest<HTMLElement>("[data-path-action]");
        const path = row.dataset.changePath;
        if (!path) return;
        if (action) {
          event.stopPropagation();
          void this.mutatePaths(action.dataset.pathAction === "stage", [path]);
          return;
        }
        this.selectChangeRow(
          row,
          event.ctrlKey || event.metaKey,
          event.shiftKey,
          false,
        );
      });
      row.addEventListener("keydown", (event) => {
        if (event.target !== row) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.selectChangeRow(row, event.key === " " || event.ctrlKey || event.metaKey, event.shiftKey, true);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const rows = Array.from(this.root.querySelectorAll<HTMLElement>("[data-change-key]"));
        const current = rows.indexOf(row);
        if (current < 0) return;
        event.preventDefault();
        const target =
          event.key === "Home"
            ? rows[0]
            : event.key === "End"
              ? rows.at(-1)
              : rows[current + (event.key === "ArrowDown" ? 1 : -1)];
        if (target) this.selectChangeRow(target, false, event.shiftKey, true);
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-group-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const staged = button.dataset.groupAction === "stage";
        const snapshot = this.state.snapshot;
        if (!snapshot) return;
        const paths = this.filteredChanges(snapshot)
          .filter(staged ? hasWorktreeChange : hasStagedChange)
          .map((change) => change.path);
        void this.mutatePaths(staged, paths);
      });
    });
  }

  private selectChangeRow(
    row: HTMLElement,
    toggle: boolean,
    range: boolean,
    restoreFocus: boolean,
  ): void {
    const key = row.dataset.changeKey;
    const path = row.dataset.changePath;
    if (!key || !path) return;
    if (range && this.changeSelectionAnchor) {
      const rows = Array.from(this.root.querySelectorAll<HTMLElement>("[data-change-key]"));
      const keys = rows.flatMap((candidate) =>
        candidate.dataset.changeKey ? [candidate.dataset.changeKey] : [],
      );
      const anchor = keys.indexOf(this.changeSelectionAnchor);
      const target = keys.indexOf(key);
      if (anchor >= 0 && target >= 0) {
        const [start, end] = anchor <= target ? [anchor, target] : [target, anchor];
        this.state.selectedChangeKeys = new Set(keys.slice(start, end + 1));
      } else {
        this.state.selectedChangeKeys = new Set([key]);
      }
    } else if (toggle) {
      if (this.state.selectedChangeKeys.has(key)) this.state.selectedChangeKeys.delete(key);
      else this.state.selectedChangeKeys.add(key);
      this.changeSelectionAnchor = key;
    } else {
      this.state.selectedChangeKeys = new Set([key]);
      this.changeSelectionAnchor = key;
    }

    const primaryKey = this.state.selectedChangeKeys.has(key)
      ? key
      : Array.from(this.state.selectedChangeKeys).at(-1) ?? null;
    this.state.selectedChange = primaryKey
      ? changeSelectionFromKey(primaryKey)
      : null;
    if (this.state.selectedChange && this.state.snapshot) {
      this.activateDiffPreview({
        kind: "working-diff",
        repositoryRoot: this.state.snapshot.root,
        selection: { ...this.state.selectedChange },
      });
      this.clearWorkingDiff();
      this.state.workingPatchLoading = true;
    }
    this.renderLeftTool();
    this.renderEditor();
    if (this.state.selectedChange) void this.loadSelectedDiff();
    if (restoreFocus && primaryKey) this.focusChangeRow(primaryKey);
  }

  private renderFilteredChanges(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.layout.leftTool !== "changes") return;
    const changes = this.filteredChanges(snapshot);
    this.query("#change-results").innerHTML = this.renderChangeResults(snapshot, changes);
    const count = this.query("#navigator-count");
    count.textContent = changes.length.toString();
    count.title = `${changes.length} of ${snapshot.changes.length} changed files`;
    this.bindChangeRowsAndGroups();
  }

  private focusChangeFilter(): void {
    const input = this.root.querySelector<HTMLInputElement>("#change-filter");
    input?.focus();
    input?.select();
  }

  private focusChangeRow(key: string): void {
    const rows = this.root.querySelectorAll<HTMLElement>("[data-change-key]");
    Array.from(rows)
      .find((row) => row.dataset.changeKey === key)
      ?.focus();
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
    this.root
      .querySelector<HTMLButtonElement>("#retry-ref-history")
      ?.addEventListener("click", () => {
        this.applyHistoryQuery();
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-text-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.historyTextMode === "case") {
          this.state.historyCaseSensitive = !this.state.historyCaseSensitive;
        } else {
          this.state.historyRegularExpression = !this.state.historyRegularExpression;
        }
        this.renderBottomTool();
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
        this.renderBottomTool();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-branch-submenu]").forEach((button) => {
      const open = () => {
        const submenu = button.dataset.historyBranchSubmenu;
        if (!submenu || this.state.historyBranchSubmenu === submenu) return;
        this.state.historyBranchSubmenu = submenu;
        this.renderBottomTool();
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
        const snapshot = this.state.snapshot;
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
        const snapshot = this.state.snapshot;
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
      this.renderBottomTool();
    });
    const results = this.root.querySelector<HTMLElement>("#history-results");
    results?.addEventListener("scroll", () => this.handleHistoryScroll(results), {
      passive: true,
    });
    this.bindHistoryRows();
  }

  private bindHistoryRows(): void {
    this.root
      .querySelector<HTMLButtonElement>("[data-retry-history-page]")
      ?.addEventListener("click", () => {
        if (this.state.historyPagingRetry === "refresh") void this.refreshLoadedHistory();
        else void this.loadOlderHistory();
      });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-expand-linear-history]")
      .forEach((row) => {
        row.addEventListener("click", () => {
          const firstKey = row.dataset.firstCollapsed;
          this.state.historyCollapseLinear = false;
          this.renderBottomTool();
          if (firstKey) this.focusHistoryCommit(firstKey);
        });
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-commit]").forEach((row) => {
      row.addEventListener("click", () => {
        const key = row.dataset.commitKey;
        if (key) this.selectCommit(key);
      });
      row.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const rows = Array.from(
          this.root.querySelectorAll<HTMLButtonElement>("[data-commit]"),
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
        const key = target?.dataset.commitKey;
        if (key) this.selectCommit(key, true);
      });
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
          ? historyPathCandidates(this.state.repositoryFiles).find(
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
        historyPathCandidates(this.state.repositoryFiles),
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
    if (!this.state.snapshot || this.state.layout.bottomTool !== "branches") return;
    const commits = this.filteredHistoryCommits();
    if (this.state.history.status !== "ready") {
      this.renderHistoryCount(commits.length);
      return;
    }
    this.query("#history-results").innerHTML = this.renderHistoryRows(commits, this.filteredHistory().error);
    this.renderHistoryCount(commits.length);
    this.bindHistoryRows();
  }

  private renderHistoryCount(filteredCount: number): void {
    const count = this.query("#history-count");
    count.textContent =
      this.state.history.status === "loading"
        ? "…"
        : this.state.history.status === "error"
          ? "!"
          : filteredCount.toString();
    count.title = `${filteredCount} of ${this.state.history.commits.length} commits in ${this.historyScope().label}`;
    const refresh = this.root.querySelector<HTMLElement>("#history-refresh-status");
    if (refresh) refresh.textContent = this.state.historyRefreshing ? "Refreshing…" : "";
  }

  private resetHistoryPaging(): void {
    this.historyPageSequence += 1;
    this.historyTopRefreshArmed = false;
    this.state.historyHasMore = false;
    this.state.historyNextOffset = 0;
    this.state.historyLoadingMore = false;
    this.state.historyRefreshing = false;
    this.state.historyPagingError = null;
    this.state.historyPagingRetry = null;
  }

  private handleHistoryScroll(results: HTMLElement): void {
    if (this.state.history.status !== "ready") return;
    if (results.scrollTop > HISTORY_SCROLL_THRESHOLD) {
      this.historyTopRefreshArmed = true;
    }
    const distanceFromBottom =
      results.scrollHeight - results.clientHeight - results.scrollTop;
    if (distanceFromBottom <= HISTORY_SCROLL_THRESHOLD) {
      void this.loadOlderHistory();
    }
    if (
      results.scrollTop <= 2 &&
      this.historyTopRefreshArmed &&
      Date.now() - this.historyTopRefreshAt > 800
    ) {
      this.historyTopRefreshArmed = false;
      this.historyTopRefreshAt = Date.now();
      void this.refreshLoadedHistory();
    }
  }

  private historyPageRequestMatches(
    sequence: number,
    generation: number,
    root: string,
    queryKey: string,
  ): boolean {
    return matchesHistoryPageRequest(
      { sequence, generation, root, queryKey },
      {
        sequence: this.historyPageSequence,
        generation: this.state.history.generation,
        root: this.state.snapshot?.root ?? "",
        queryKey: historyQueryKey(this.activeHistoryQuery()),
      },
    );
  }

  private async loadOlderHistory(): Promise<void> {
    const snapshot = this.state.snapshot;
    if (
      !snapshot ||
      this.state.history.status !== "ready" ||
      !this.state.historyHasMore ||
      this.state.historyLoadingMore ||
      this.state.historyRefreshing ||
      this.state.history.commits.length >= HISTORY_ROW_LIMIT ||
      this.state.historyNextOffset >= HISTORY_ROW_LIMIT
    ) {
      return;
    }
    const results = this.root.querySelector<HTMLElement>("#history-results");
    const scrollTop = results?.scrollTop ?? 0;
    const query = this.activeHistoryQuery();
    const queryKey = historyQueryKey(query);
    const generation = this.state.history.generation;
    const offset = this.state.historyNextOffset;
    const sequence = ++this.historyPageSequence;
    const limit = Math.min(
      HISTORY_PAGE_SIZE,
      HISTORY_ROW_LIMIT - this.state.history.commits.length,
    );
    this.state.historyLoadingMore = true;
    this.state.historyPagingError = null;
    this.state.historyPagingRetry = null;
    this.renderHistoryResults();
    if (results) results.scrollTop = scrollTop;

    try {
      const page = await bridge.readHistoryPage(snapshot.root, query, offset, limit);
      if (!this.historyPageRequestMatches(sequence, generation, snapshot.root, queryKey)) {
        return;
      }
      if (page.offset !== offset) {
        throw new Error("History page did not match the requested offset.");
      }
      const window = appendHistoryPage(
        this.state.history.commits,
        page,
        HISTORY_ROW_LIMIT,
      );
      this.state.history = {
        ...this.state.history,
        commits: window.commits,
      };
      this.state.historyNextOffset = window.nextOffset;
      this.state.historyHasMore = window.hasMore;
      this.state.historyLoadingMore = false;
      this.renderHistoryResults();
      const nextResults = this.root.querySelector<HTMLElement>("#history-results");
      if (nextResults) nextResults.scrollTop = scrollTop;
    } catch (error) {
      if (!this.historyPageRequestMatches(sequence, generation, snapshot.root, queryKey)) {
        return;
      }
      this.state.historyLoadingMore = false;
      this.state.historyPagingError = `Older commits could not be loaded: ${errorMessage(error)}`;
      this.state.historyPagingRetry = "append";
      this.renderHistoryResults();
    }
  }

  private async refreshLoadedHistory(): Promise<void> {
    const snapshot = this.state.snapshot;
    if (
      !snapshot ||
      this.state.history.status !== "ready" ||
      this.state.historyLoadingMore ||
      this.state.historyRefreshing
    ) {
      return;
    }
    const query = this.activeHistoryQuery();
    const queryKey = historyQueryKey(query);
    const generation = this.state.history.generation;
    const sequence = ++this.historyPageSequence;
    const limit = Math.min(
      Math.max(HISTORY_PAGE_SIZE, this.state.historyNextOffset),
      HISTORY_ROW_LIMIT,
    );
    const previousSelection = this.state.selectedCommit;
    this.state.historyRefreshing = true;
    this.state.historyPagingError = null;
    this.state.historyPagingRetry = null;
    this.renderHistoryCount(this.filteredHistoryCommits().length);

    try {
      const page = await bridge.readHistoryPage(snapshot.root, query, 0, limit);
      if (!this.historyPageRequestMatches(sequence, generation, snapshot.root, queryKey)) {
        return;
      }
      if (page.offset !== 0) {
        throw new Error("Refreshed history did not begin at the requested offset.");
      }
      const window = replaceHistoryPage(page, HISTORY_ROW_LIMIT);
      const commits = window.commits;
      this.state.history = {
        ...this.state.history,
        commits,
      };
      this.state.historyNextOffset = window.nextOffset;
      this.state.historyHasMore = window.hasMore;
      this.state.historyRefreshing = false;
      this.state.selectedCommit =
        previousSelection && commits.some((commit) => commitKey(commit) === previousSelection)
          ? previousSelection
          : commits[0]
            ? commitKey(commits[0])
            : null;
      const selectionChanged = previousSelection !== this.state.selectedCommit;
      if (selectionChanged) this.clearCommitInspection();
      this.renderHistoryResults();
      if (selectionChanged) this.loadVisibleCommitDetails();
    } catch (error) {
      if (!this.historyPageRequestMatches(sequence, generation, snapshot.root, queryKey)) {
        return;
      }
      this.state.historyRefreshing = false;
      this.state.historyPagingError = `History could not be refreshed: ${errorMessage(error)}`;
      this.state.historyPagingRetry = "refresh";
      this.renderHistoryResults();
      this.setStatus("History refresh could not be completed", "warning");
    }
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
    const commit = this.state.history.commits.find((item) => commitKey(item) === key);
    if (!commit) return;
    if (
      key === this.state.selectedCommit &&
      this.state.commitDetails?.oid === commit.oid &&
      this.state.commitDetails.repositoryId === commit.repositoryId
    ) {
      this.state.gitDetail = "commit";
      this.renderBottomTool();
      if (restoreFocus) this.focusHistoryCommit(key);
      return;
    }
    this.state.selectedCommit = key;
    this.state.gitDetail = "commit";
    this.clearCommitInspection();
    this.state.commitDetailsLoading = true;
    this.renderBottomTool();
    if (restoreFocus) this.focusHistoryCommit(key);
    void this.loadSelectedCommitDetails();
  }

  private focusHistoryCommit(key: string): void {
    Array.from(this.root.querySelectorAll<HTMLButtonElement>("[data-commit-key]"))
      .find((row) => row.dataset.commitKey === key)
      ?.focus();
  }

  private bindBranchEvents(): void {
    const input = this.root.querySelector<HTMLInputElement>("#branch-filter");
    input?.addEventListener("input", () => {
      const snapshot = this.state.snapshot;
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
        const snapshot = this.state.snapshot;
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
            this.renderBranchNavigation(this.state.snapshot!);
          this.renderBranchCount(this.state.snapshot!);
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
    const snapshot = this.state.snapshot;
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

  private async loadHistory(request: RefHistoryRequest): Promise<void> {
    try {
      const page = await bridge.readHistoryPage(
        request.root,
        request.query,
        0,
        HISTORY_PAGE_SIZE,
      );
      if (page.offset !== 0) {
        throw new Error("History did not begin at the requested offset.");
      }
      const next = completeRefHistory(this.state.history, request, page.commits);
      if (
        next === this.state.history ||
        this.state.snapshot?.root !== request.root ||
        historyQueryKey(this.activeHistoryQuery()) !== request.key
      ) {
        return;
      }
      this.state.history = next;
      this.state.historyHasMore = page.hasMore;
      this.state.historyNextOffset = page.offset + page.commits.length;
      this.state.historyLoadingMore = false;
      this.state.historyRefreshing = false;
      this.state.historyPagingError = null;
      this.state.historyPagingRetry = null;
      this.state.selectedCommit = page.commits[0] ? commitKey(page.commits[0]) : null;
      this.clearCommitInspection();
      this.state.commitDetailsLoading =
        this.state.gitDetail === "commit" && this.state.selectedCommit !== null;
      this.renderBottomTool();
      this.loadVisibleCommitDetails();
    } catch (error) {
      const next = failRefHistory(this.state.history, request, errorMessage(error));
      if (
        next === this.state.history ||
        this.state.snapshot?.root !== request.root ||
        historyQueryKey(this.activeHistoryQuery()) !== request.key
      ) {
        return;
      }
      this.state.history = next;
      this.resetHistoryPaging();
      this.state.selectedCommit = null;
      this.clearCommitInspection();
      this.renderBottomTool();
      this.setStatus("Filtered history could not be loaded", "warning");
    }
  }

  private renderEditor(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    this.textEditor.retain(this.state.editor.textTabs.map((tab) => tab.id));
    const document = this.activeDocument();
    const editorPanel = this.query("#editor-panel");
    const header = this.query("#content-header");
    const tabbar = this.query("#editor-tabbar");
    const activeKey = editorDocumentKey(document);
    const revealActiveTab = activeKey !== this.lastRenderedEditorDocumentKey;
    this.lastRenderedEditorDocumentKey = activeKey;
    tabbar.innerHTML = this.renderEditorTabs(document);
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
        this.emptyState(
          "Editor workspace ready",
          "Open a project file to edit it, or choose a changed or committed file to inspect its Diff.",
          "folder",
        ),
      );
      return;
    }

    if (document.kind === "project-file") {
      const tab = activeTextTab(this.state.editor);
      if (!tab) {
        this.state.editor = activateWelcome(this.state.editor);
        this.renderEditor();
        return;
      }
      if (tab.status === "loading") {
        this.showEditorHtml(
          editorDocumentContentKey(document, `loading:${tab.loadEpoch}`),
          this.loadingBlock("Loading text file…"),
        );
      } else if (tab.status === "error") {
        this.showEditorHtml(
          editorDocumentContentKey(document, `error:${tab.loadEpoch}:${tab.error ?? "unknown"}`),
          this.retryState(
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
      header.innerHTML = `
        ${this.contentHeading(basename(selected.path), selected.path)}
        <div class="header-actions">${this.diffControls()}<span class="scope-pill">${selected.staged ? "Staged" : "Working tree"}</span></div>
      `;
      this.bindDiffControls();
      if (this.state.workingPatchLoading) {
        this.showEditorHtml(
          editorDocumentContentKey(document, "loading"),
          this.loadingBlock("Loading patch…"),
        );
      } else if (this.state.workingPatchError) {
        this.showEditorHtml(
          editorDocumentContentKey(
            document,
            `error:${this.state.workingPatchError}`,
          ),
          this.retryState(
            "Could not load patch",
            this.state.workingPatchError,
            "retry-working-diff",
            "changes",
          ),
        );
        this.query("#retry-working-diff").addEventListener("click", () => {
          void this.loadSelectedDiff();
        });
      } else if (this.state.workingPatch) {
        this.mountEditorDiff(
          editorDocumentContentKey(
            document,
            `patch:${this.state.workingPatchVersion}`,
          ),
          this.state.workingPatch.patch ||
            "No textual diff is available for this selection.",
          selected.path,
        );
      }
      return;
    }

    const commit = snapshot.commits.find((item) => item.oid === document.oid);
    const shortOid = commit?.shortOid ?? document.oid.slice(0, 8);
    header.innerHTML = `
      ${this.contentHeading(basename(document.path), document.path)}
      <div class="header-actions">${this.diffControls()}<code class="oid">${escapeHtml(shortOid)}</code></div>
    `;
    this.bindDiffControls();
    if (this.state.commitPatchLoading) {
      this.showEditorHtml(
        editorDocumentContentKey(document, "loading"),
        this.loadingBlock("Loading commit patch…"),
      );
    } else if (this.state.commitPatchError) {
      this.showEditorHtml(
        editorDocumentContentKey(
          document,
          `error:${this.state.commitPatchError}`,
        ),
        this.retryState(
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
    if (this.mountedEditorKey === key) return;
    this.captureMountedTextEditor();
    this.disposeMarkdownSurface();
    this.textEditor.detach();
    this.mountedTextTabId = null;
    this.diffEditor.destroy();
    const body = this.query("#content-body");
    this.resetEditorBodyClasses(body);
    body.innerHTML = html;
    this.mountedEditorKey = key;
  }

  private mountEditorDiff(key: string, patch: string, path: string): void {
    if (this.mountedEditorKey === key) {
      this.diffEditor.requestMeasure();
      return;
    }
    this.captureMountedTextEditor();
    this.disposeMarkdownSurface();
    this.textEditor.detach();
    this.mountedTextTabId = null;
    this.diffEditor.destroy();
    const body = this.query("#content-body");
    body.innerHTML = "";
    this.resetEditorBodyClasses(body);
    body.classList.add("diff-surface");
    this.diffEditor.mount(
      body,
      patch,
      path,
      this.state.preferences,
      this.diffPresentation(),
    );
    this.mountedEditorKey = key;
  }

  private mountTextEditor(key: string, tab: TextTabState): void {
    if (this.mountedEditorKey === key && this.mountedTextTabId === tab.id) {
      this.textEditor.requestMeasure();
      return;
    }
    this.captureMountedTextEditor();
    this.disposeMarkdownSurface();
    this.diffEditor.destroy();
    this.textEditor.detach();
    const body = this.query("#content-body");
    body.innerHTML = "";
    this.resetEditorBodyClasses(body);
    body.classList.add("text-surface");
    this.mountedTextTabId = tab.id;
    this.mountTextEditorSurface(body, tab);
    this.mountedEditorKey = key;
  }

  private mountMarkdownEditor(key: string, tab: TextTabState): void {
    if (this.mountedEditorKey === key) {
      this.textEditor.requestMeasure();
      return;
    }
    this.captureMountedTextEditor();
    this.disposeMarkdownSurface();
    this.diffEditor.destroy();
    this.textEditor.detach();
    const body = this.query("#content-body");
    body.innerHTML = "";
    this.resetEditorBodyClasses(body);
    body.classList.add("text-surface", "markdown-surface");

    if (tab.markdownMode === "source") {
      body.classList.add("markdown-source-surface");
      this.mountedTextTabId = tab.id;
      this.mountTextEditorSurface(body, tab);
    } else if (tab.markdownMode === "split") {
      body.classList.add("markdown-split-surface");
      body.innerHTML = `
        <div class="markdown-split-layout" id="markdown-split-layout" style="--markdown-source-width: ${this.markdownSourcePercent}%">
          <div class="markdown-source-pane" id="markdown-source-pane" aria-label="Markdown source editor"></div>
          <div class="workbench-splitter vertical markdown-splitter" id="markdown-splitter" aria-label="Resize Markdown source and preview"></div>
          <section class="markdown-preview-pane" id="markdown-preview" aria-label="Markdown preview">
            ${this.markdownPreviewLoadingBlock()}
          </section>
        </div>`;
      this.mountedTextTabId = tab.id;
      this.mountTextEditorSurface(this.query("#markdown-source-pane"), tab);
      const layout = this.query("#markdown-split-layout");
      this.markdownSplitterDisposer = attachSplitter(
        this.query("#markdown-splitter"),
        {
          orientation: "vertical",
          getValue: () => this.query("#markdown-source-pane").getBoundingClientRect().width,
          getRange: () => markdownSplitRange(layout.clientWidth),
          onChange: (value) => {
            if (layout.clientWidth <= 0) return;
            this.markdownSourcePercent = (value / layout.clientWidth) * 100;
            layout.style.setProperty(
              "--markdown-source-width",
              `${this.markdownSourcePercent}%`,
            );
            this.scheduleEditorMeasure();
          },
          onReset: () => {
            this.markdownSourcePercent = 50;
            layout.style.setProperty("--markdown-source-width", "50%");
            this.scheduleEditorMeasure();
          },
        },
      );
      this.queueMarkdownPreview(tab.id, tab.content, true);
    } else {
      body.classList.add("markdown-preview-surface");
      this.mountedTextTabId = null;
      body.innerHTML = `<section class="markdown-preview-pane full" id="markdown-preview" aria-label="Markdown preview">${this.markdownPreviewLoadingBlock()}</section>`;
      this.queueMarkdownPreview(tab.id, tab.content, true);
    }
    this.mountedEditorKey = key;
  }

  private mountTextEditorSurface(parent: HTMLElement, tab: TextTabState): void {
    this.textEditor.mount(
      parent,
      tab.id,
      tab.loadEpoch,
      tab.content,
      tab.document.path,
      this.state.preferences,
      (content) => {
        if (this.mountedTextTabId !== tab.id) return;
        const previous = textTab(this.state.editor, tab.id);
        const wasDirty = previous ? isTextTabDirty(previous) : false;
        this.state.editor = markTextEdited(this.state.editor, tab.id, content);
        const current = textTab(this.state.editor, tab.id);
        if (current?.markdownMode === "split") {
          this.queueMarkdownPreview(tab.id, content);
        }
        if (
          previous &&
          current &&
          (wasDirty !== isTextTabDirty(current) || previous.conflict)
        ) {
          this.renderEditor();
        }
      },
    );
  }

  private queueMarkdownPreview(
    tabId: string,
    content: string,
    immediate = false,
  ): void {
    const request = ++this.markdownPreviewSequence;
    this.markdownPreviewPending = { tabId, content, request };
    if (immediate) {
      if (this.markdownPreviewTimer !== null) {
        window.clearTimeout(this.markdownPreviewTimer);
        this.markdownPreviewTimer = null;
      }
      this.markdownPreviewPending = null;
      void this.updateMarkdownPreview({ tabId, content, request });
      return;
    }
    if (this.markdownPreviewTimer !== null) return;
    this.markdownPreviewTimer = window.setTimeout(() => {
      this.markdownPreviewTimer = null;
      const pending = this.markdownPreviewPending;
      this.markdownPreviewPending = null;
      if (pending) void this.updateMarkdownPreview(pending);
    }, 40);
  }

  private async updateMarkdownPreview(request: {
    tabId: string;
    content: string;
    request: number;
  }): Promise<void> {
    try {
      const result = await renderMarkdownPreview(request.content);
      if (request.request !== this.markdownPreviewSequence) return;
      const preview = this.root.querySelector<HTMLElement>("#markdown-preview");
      const active = activeTextTab(this.state.editor);
      if (
        !preview ||
        active?.id !== request.tabId ||
        active.markdownMode === "source"
      ) {
        return;
      }
      preview.innerHTML =
        result.status === "ready"
          ? `<article class="markdown-rendered">${result.html}</article>`
          : `<div class="markdown-preview-message" role="status"><strong>Preview paused for this large file</strong><span>The document is ${(result.byteLength / (1024 * 1024)).toFixed(1)} MiB. Live preview is limited to ${MARKDOWN_PREVIEW_MAX_BYTES / (1024 * 1024)} MiB; source editing and saving remain available.</span></div>`;
      this.attachMarkdownScrollSync();
    } catch (error) {
      if (request.request !== this.markdownPreviewSequence) return;
      const preview = this.root.querySelector<HTMLElement>("#markdown-preview");
      const active = activeTextTab(this.state.editor);
      if (!preview || active?.id !== request.tabId) return;
      preview.innerHTML = `<div class="markdown-preview-message error" role="alert"><strong>Markdown preview failed</strong><span>${escapeHtml(errorMessage(error))}</span></div>`;
    }
  }

  private markdownPreviewLoadingBlock(): string {
    return '<div class="markdown-preview-message" role="status"><strong>Rendering Markdown…</strong><span>The editor remains available while the preview engine loads.</span></div>';
  }

  private attachMarkdownScrollSync(): void {
    this.markdownScrollDisposer?.();
    this.markdownScrollDisposer = null;
    const active = activeTextTab(this.state.editor);
    const preview = this.root.querySelector<HTMLElement>("#markdown-preview");
    if (!preview || active?.markdownMode !== "split") return;
    preview.dataset.scrollSync = "proportional";
    this.markdownScrollDisposer = this.textEditor.linkVerticalScroll(preview);
  }

  private disposeMarkdownSurface(): void {
    this.markdownScrollDisposer?.();
    this.markdownScrollDisposer = null;
    this.markdownSplitterDisposer?.();
    this.markdownSplitterDisposer = null;
    if (this.markdownPreviewTimer !== null) {
      window.clearTimeout(this.markdownPreviewTimer);
      this.markdownPreviewTimer = null;
    }
    this.markdownPreviewPending = null;
    this.markdownPreviewSequence += 1;
  }

  private resetEditorBodyClasses(body: HTMLElement): void {
    body.classList.remove(
      "diff-surface",
      "text-surface",
      "markdown-surface",
      "markdown-source-surface",
      "markdown-split-surface",
      "markdown-preview-surface",
    );
  }

  private renderEditorContextActions(document: EditorDocument): void {
    const host = this.query("#editor-context-actions");
    const tab = document.kind === "project-file" ? activeTextTab(this.state.editor) : null;
    if (!tab || tab.status !== "ready" || !isMarkdownPath(tab.document.path)) {
      host.innerHTML = "";
      return;
    }
    const modes: Array<[MarkdownEditorMode, string, string]> = [
      ["source", "Source", "Edit Markdown source"],
      ["split", "Split", "Edit source with live preview"],
      ["preview", "Preview", "Rendered preview (read-only)"],
    ];
    host.innerHTML = `<div class="markdown-mode-controls" role="group" aria-label="Markdown editor mode">${modes
      .map(
        ([mode, label, title]) =>
          `<button type="button" data-markdown-mode="${mode}" aria-pressed="${tab.markdownMode === mode}" title="${title}">${label}</button>`,
      )
      .join("")}</div>`;
    host
      .querySelectorAll<HTMLButtonElement>("[data-markdown-mode]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const active = activeTextTab(this.state.editor);
          const mode = button.dataset.markdownMode as MarkdownEditorMode;
          if (!active || active.id !== tab.id || active.markdownMode === mode) return;
          this.captureMountedTextEditor();
          this.state.editor = setTextTabMarkdownMode(this.state.editor, tab.id, mode);
          this.renderEditor();
        });
      });
  }

  private renderEditorTabs(document: EditorDocument): string {
    const textTabs = this.state.editor.textTabs
      .map((tab, index) => {
        const active = document.kind === "project-file" && editorDocumentKey(document) === tab.id;
        const dirty = isTextTabDirty(tab);
        const state = tab.conflict
          ? "Conflict"
          : tab.saveRequest
            ? "Saving"
            : dirty
              ? "Unsaved"
              : "Saved";
        return `
          <div class="editor-tab ${this.editorTabFileStatusClass(tab.document.workspacePath)} ${active ? "active" : ""} ${dirty ? "dirty" : ""}" role="tab" aria-selected="${active}" data-editor-tab="${index}" title="${escapeAttribute(`${tab.document.workspacePath} · ${state}`)}">
            <button class="editor-tab-target" type="button" data-editor-tab-index="${index}">
              <span class="editor-tab-file-icon">${fileTypeIcon(tab.document.workspacePath)}</span>
              <span class="editor-tab-label">${escapeHtml(basename(tab.document.workspacePath))}</span>
              ${dirty ? '<span class="editor-dirty-dot" aria-label="Unsaved"></span>' : ""}
            </button>
            <button class="editor-tab-close" type="button" data-close-editor-tab-index="${index}" aria-label="Close ${escapeAttribute(basename(tab.document.workspacePath))}" title="Close">${icon("close", 12)}</button>
          </div>`;
      })
      .join("");
    const preview = this.state.editor.preview;
    const previewPath =
      preview?.kind === "working-diff" ? preview.selection.path : preview?.path;
    const previewTab = preview
      ? `<div class="editor-tab preview ${preview.kind === "working-diff" ? this.editorTabFileStatusClass(preview.selection.path) : ""} ${this.state.editor.active.kind === "preview" ? "active" : ""}" role="tab" aria-selected="${this.state.editor.active.kind === "preview"}">
          <button class="editor-tab-target" type="button" data-editor-preview>${escapeHtml(basename(previewPath ?? "Diff"))}<small>Diff</small></button>
          <button class="editor-tab-close" type="button" data-close-editor-preview aria-label="Close Diff preview" title="Close">${icon("close", 12)}</button>
        </div>`
      : "";
    if (!textTabs && !previewTab) {
      return '<span class="editor-tab active">Welcome</span>';
    }
    return `${textTabs}${previewTab}`;
  }

  private renderEditorTabMenu(): void {
    const toggle = this.query<HTMLButtonElement>("#editor-tab-menu-toggle");
    const menu = this.query("#editor-tab-menu");
    const hasDocuments =
      this.state.editor.textTabs.length > 0 || this.state.editor.preview !== null;
    if (!hasDocuments) this.editorTabMenuOpen = false;
    toggle.disabled = !hasDocuments;
    toggle.setAttribute("aria-expanded", String(this.editorTabMenuOpen));
    menu.classList.toggle("hidden", !this.editorTabMenuOpen);
    if (!this.editorTabMenuOpen) {
      menu.innerHTML = "";
      return;
    }
    const textItems = this.state.editor.textTabs
      .map((tab, index) => {
        const active =
          this.state.editor.active.kind === "text" &&
          this.state.editor.active.id === tab.id;
        const dirty = isTextTabDirty(tab);
        return `<button class="editor-tab-menu-item ${this.editorTabFileStatusClass(tab.document.workspacePath)} ${active ? "active" : ""}" type="button" role="menuitem" data-editor-menu-tab-index="${index}" title="${escapeAttribute(tab.document.workspacePath)}"><span class="editor-tab-menu-glyph">${fileTypeIcon(tab.document.workspacePath)}</span><span class="editor-tab-menu-copy"><strong>${escapeHtml(basename(tab.document.workspacePath))}</strong><small>${escapeHtml(tab.document.workspacePath)}</small></span>${dirty ? '<span class="editor-dirty-dot" aria-label="Unsaved"></span>' : ""}${active ? icon("check", 14) : ""}</button>`;
      })
      .join("");
    const preview = this.state.editor.preview;
    const previewPath =
      preview?.kind === "working-diff" ? preview.selection.path : preview?.path;
    const previewItem = preview
      ? `<button class="editor-tab-menu-item ${preview.kind === "working-diff" ? this.editorTabFileStatusClass(preview.selection.path) : ""} ${this.state.editor.active.kind === "preview" ? "active" : ""}" type="button" role="menuitem" data-editor-menu-preview title="${escapeAttribute(previewPath ?? "Diff")}"><span class="editor-tab-menu-glyph">${icon("changes", 14)}</span><span class="editor-tab-menu-copy"><strong>${escapeHtml(basename(previewPath ?? "Diff"))}</strong><small>Diff preview</small></span>${this.state.editor.active.kind === "preview" ? icon("check", 14) : ""}</button>`
      : "";
    menu.innerHTML = `${textItems}${previewItem}`;
  }

  private bindEditorTabMenuEvents(): void {
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-editor-menu-tab-index]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const index = Number(button.dataset.editorMenuTabIndex);
          const tab = this.state.editor.textTabs[index];
          if (!tab) return;
          this.editorTabMenuOpen = false;
          this.activateEditorTextTab(tab, true);
        });
      });
    this.root
      .querySelector<HTMLButtonElement>("[data-editor-menu-preview]")
      ?.addEventListener("click", () => {
        const preview = this.state.editor.preview;
        if (!preview) return;
        this.editorTabMenuOpen = false;
        this.captureMountedTextEditor();
        this.state.editor = activatePreview(this.state.editor, preview);
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
    const tab = activeTextTab(this.state.editor);
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
    this.state.editor = activateTextTab(this.state.editor, tab.id);
    this.renderEditor();
    if (forceReveal) this.revealActiveEditorTab();
  }

  private bindEditorTabEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-editor-tab-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.editorTabIndex);
        const tab = this.state.editor.textTabs[index];
        if (!tab) return;
        this.activateEditorTextTab(tab);
      });
    });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-close-editor-tab-index]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const index = Number(button.dataset.closeEditorTabIndex);
          const tab = this.state.editor.textTabs[index];
          if (tab) void this.requestCloseTextTab(tab.id);
        });
      });
    this.root.querySelector<HTMLButtonElement>("[data-editor-preview]")?.addEventListener(
      "click",
      () => {
        const preview = this.state.editor.preview;
        if (!preview) return;
        this.captureMountedTextEditor();
        this.state.editor = activatePreview(this.state.editor, preview);
        this.renderLeftTool();
        this.renderEditor();
      },
    );
    this.root
      .querySelector<HTMLButtonElement>("[data-close-editor-preview]")
      ?.addEventListener("click", () => {
        this.captureMountedTextEditor();
        this.state.editor = closePreview(this.state.editor);
        this.renderEditor();
      });
    this.bindEditorTabMenuEvents();
  }

  private captureMountedTextEditor(): void {
    const tabId = this.mountedTextTabId;
    if (!tabId || !textTab(this.state.editor, tabId)) return;
    this.textEditor.flushChanges();
    this.state.editor = captureTextContent(
      this.state.editor,
      tabId,
      this.textEditor.content(),
    );
  }

  private async saveTextTab(tabId: string): Promise<boolean> {
    if (this.mountedTextTabId === tabId) this.captureMountedTextEditor();
    const tab = textTab(this.state.editor, tabId);
    if (!tab) return true;
    const requestId = `text-save-${Date.now()}-${++this.textSaveSequence}`;
    const prepared = beginTextSave(this.state.editor, tabId, tab.content, requestId);
    this.state.editor = prepared.session;
    const request = prepared.request;
    if (!request) {
      if (isTextTabDirty(tab)) {
        this.setStatus("Wait for the current file operation before continuing", "warning");
        return false;
      }
      return true;
    }
    this.renderEditor();
    try {
      const result = await bridge.saveTextFile(
        request.document.repositoryRoot,
        request.document.repositoryId,
        request.document.path,
        request.expectedRevision,
        request.content,
        request.utf8Bom,
        request.requestId,
      );
      this.state.editor = completeTextSave(this.state.editor, tabId, result);
      const current = textTab(this.state.editor, tabId);
      this.renderEditor();
      this.renderLeftTool();
      if (current && !isTextTabDirty(current)) {
        this.setStatus(`Saved ${basename(current.document.workspacePath)}`, "success");
        return true;
      }
      this.setStatus("Saved captured changes; newer edits remain unsaved", "warning");
      return false;
    } catch (error) {
      const conflict = isWorkspaceConflict(error);
      this.state.editor = failTextSave(
        this.state.editor,
        tabId,
        request.requestId,
        errorMessage(error),
        conflict,
      );
      this.renderEditor();
      this.renderLeftTool();
      this.showError(error);
      return false;
    }
  }

  private async requestCloseTextTab(tabId: string): Promise<void> {
    this.captureMountedTextEditor();
    const tab = textTab(this.state.editor, tabId);
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
    const closed = closeTextTab(this.state.editor, tabId);
    this.state.editor = closed.session;
    if (!closed.blocked) {
      this.textEditor.dispose(tabId);
      this.renderLeftTool();
      this.renderEditor();
    }
  }

  private async saveDirtyTabsBefore(action: string): Promise<boolean> {
    this.captureMountedTextEditor();
    const dirty = dirtyTextTabs(this.state.editor);
    if (dirty.length === 0) return true;
    const save = window.confirm(
      `Save ${dirty.length} unsaved file${dirty.length === 1 ? "" : "s"} before ${action}?\n\nCancel keeps the current workspace open.`,
    );
    if (!save) return false;
    for (const tab of dirty) {
      if (!(await this.saveTextTab(tab.id))) return false;
    }
    return dirtyTextTabs(this.state.editor).length === 0;
  }

  private activeDocument(): EditorDocument {
    return activeEditorDocument(this.state.editor);
  }

  private activateDiffPreview(
    document: Exclude<EditorDocument, { kind: "welcome" | "project-file" }>,
  ): void {
    this.captureMountedTextEditor();
    this.state.editor = activatePreview(this.state.editor, document);
  }

  private contentHeading(title: string, subtitle: string): string {
    return `<div class="content-title-group"><span class="content-kicker">${escapeHtml(subtitle)}</span><h2>${escapeHtml(title)}</h2></div>`;
  }

  private diffControls(): string {
    return `
      <div class="diff-controls" role="group" aria-label="Diff presentation">
        <button type="button" data-diff-layout="unified" aria-pressed="${this.state.preferences.diffLayout === "unified"}" title="Unified diff">Unified</button>
        <button type="button" data-diff-layout="split" aria-pressed="${this.state.preferences.diffLayout === "split"}" title="Side-by-side diff">Split</button>
        <button type="button" data-diff-whitespace aria-pressed="${this.state.preferences.showWhitespace}" title="Show whitespace characters">Whitespace</button>
      </div>`;
  }

  private bindDiffControls(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-diff-layout]").forEach((button) => {
      button.addEventListener("click", () => {
        const layout = button.dataset.diffLayout as DiffLayout;
        if (layout === this.state.preferences.diffLayout) return;
        this.updatePreferences({ diffLayout: layout });
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-diff-whitespace]")?.addEventListener(
      "click",
      () => {
        this.updatePreferences({
          showWhitespace: !this.state.preferences.showWhitespace,
        });
      },
    );
  }

  private syncDiffControls(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-diff-layout]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.diffLayout === this.state.preferences.diffLayout),
      );
    });
    this.root
      .querySelector<HTMLButtonElement>("[data-diff-whitespace]")
      ?.setAttribute("aria-pressed", String(this.state.preferences.showWhitespace));
  }

  private diffPresentation(): DiffPresentation {
    return {
      layout: this.state.preferences.diffLayout,
      showWhitespace: this.state.preferences.showWhitespace,
      splitPercentage: this.state.layout.diffBeforePercent,
      onSplitPercentageChange: (value, committed) => {
        this.resizeWorkbench("diffBeforePercent", value);
        if (committed) this.persistWorkbenchLayout();
      },
    };
  }

  private async loadSelectedDiff(): Promise<void> {
    const snapshot = this.state.snapshot;
    const document = this.activeDocument();
    if (
      !snapshot ||
      document.kind !== "working-diff" ||
      document.repositoryRoot !== snapshot.root
    ) {
      return;
    }
    const selected = document.selection;
    const generation = ++this.diffGeneration;
    this.state.workingPatch = null;
    this.state.workingPatchLoading = true;
    this.state.workingPatchError = null;
    this.renderEditor();
    try {
      const diff = await bridge.readDiff(snapshot.root, selected.path, selected.staged);
      const current = this.activeDocument();
      if (
        generation !== this.diffGeneration ||
        current.kind !== "working-diff" ||
        current.repositoryRoot !== snapshot.root ||
        current.selection.path !== selected.path ||
        current.selection.staged !== selected.staged ||
        diff.path !== selected.path ||
        diff.staged !== selected.staged
      ) {
        return;
      }
      this.state.workingPatch = diff;
      this.state.workingPatchLoading = false;
      this.state.workingPatchVersion = generation;
      this.renderEditor();
      if (diff.truncated) this.setStatus("Patch truncated at 4 MiB", "warning");
    } catch (error) {
      const current = this.activeDocument();
      if (
        generation !== this.diffGeneration ||
        current.kind !== "working-diff" ||
        current.repositoryRoot !== snapshot.root ||
        current.selection.path !== selected.path ||
        current.selection.staged !== selected.staged
      ) {
        return;
      }
      this.state.workingPatchLoading = false;
      this.state.workingPatchError = errorMessage(error);
      this.renderEditor();
      this.showError(error);
    }
  }

  private loadVisibleCommitDetails(): void {
    const commit = selectedCommit(this.state.history.commits, this.state.selectedCommit);
    if (
      this.state.layout.bottomTool === "branches" &&
      this.state.gitDetail === "commit" &&
      commit &&
      !this.state.commitDetailsLoading &&
      (this.state.commitDetails?.oid !== commit.oid ||
        this.state.commitDetails.repositoryId !== commit.repositoryId)
    ) {
      void this.loadSelectedCommitDetails();
    }
  }

  private async loadSelectedCommitDetails(): Promise<void> {
    const snapshot = this.state.snapshot;
    const commit = selectedCommit(this.state.history.commits, this.state.selectedCommit);
    if (!snapshot || !commit) return;
    const key = commitKey(commit);
    const oid = commit.oid;
    const repositoryId = commit.repositoryId;
    const generation = ++this.commitDetailsGeneration;
    this.commitDiffGeneration += 1;
    this.state.commitDetails = null;
    this.state.selectedCommitFile = null;
    this.state.commitDetailsLoading = true;
    this.state.commitDetailsError = null;
    this.state.commitPatch = null;
    this.state.commitPatchLoading = false;
    this.state.commitPatchError = null;
    this.renderBottomTool();

    try {
      const details = await bridge.readCommitDetails(snapshot.root, repositoryId, oid);
      if (
        generation !== this.commitDetailsGeneration ||
        this.state.snapshot?.root !== snapshot.root ||
        this.state.selectedCommit !== key ||
        details.oid !== oid ||
        details.repositoryId !== repositoryId
      ) {
        return;
      }
      this.state.commitDetails = details;
      this.state.commitDetailsLoading = false;
      this.state.selectedCommitFile = details.files[0]?.path ?? null;
      this.renderBottomTool();
    } catch (error) {
      if (
        generation !== this.commitDetailsGeneration ||
        this.state.snapshot?.root !== snapshot.root ||
        this.state.selectedCommit !== key
      ) {
        return;
      }
      this.state.commitDetailsLoading = false;
      this.state.commitDetailsError = errorMessage(error);
      this.renderBottomTool();
      this.showError(error);
    }
  }

  private async loadSelectedCommitDiff(restoreFocus = false): Promise<void> {
    const snapshot = this.state.snapshot;
    const details = this.state.commitDetails;
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
    this.renderEditor();
    this.renderBottomTool();
    if (restoreFocus) this.focusCommitFile(file.path);

    try {
      const diff = await bridge.readCommitDiff(
        snapshot.root,
        repositoryId,
        oid,
        file.path,
        file.originalPath,
      );
      const activeDocument = this.activeDocument();
      if (
        generation !== this.commitDiffGeneration ||
        this.state.snapshot?.root !== snapshot.root ||
        this.state.selectedCommit !== key ||
        this.state.selectedCommitFile !== file.path ||
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
      this.renderBottomTool();
      if (restoreFocus) this.focusCommitFile(file.path);
      if (diff.truncated) this.setStatus("Patch truncated at 4 MiB", "warning");
    } catch (error) {
      const activeDocument = this.activeDocument();
      if (
        generation !== this.commitDiffGeneration ||
        this.state.snapshot?.root !== snapshot.root ||
        this.state.selectedCommit !== key ||
        this.state.selectedCommitFile !== file.path ||
        activeDocument.kind !== "commit-diff" ||
        activeDocument.repositoryId !== repositoryId ||
        activeDocument.oid !== oid ||
        activeDocument.path !== file.path
      ) {
        return;
      }
      this.state.commitPatchLoading = false;
      this.state.commitPatchError = errorMessage(error);
      this.renderEditor();
      this.renderBottomTool();
      if (restoreFocus) this.focusCommitFile(file.path);
      this.showError(error);
    }
  }

  private renderCommitFileTreeNode(node: CommitFileTreeNode, depth: number): string {
    if (node.kind === "directory") {
      return `<details class="commit-file-directory" open><summary style="--tree-depth:${depth}"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(node.name)}</span><small>${countCommitTreeFiles(node)}</small></summary><div role="group">${node.children.map((child) => this.renderCommitFileTreeNode(child, depth + 1)).join("")}</div></details>`;
    }
    return this.commitFileRow(node.file!, node.file!.path === this.state.selectedCommitFile, depth);
  }

  private commitFileRow(
    file: CommitFileChange,
    selected: boolean,
    depth: number | null = null,
  ): string {
    const previous = file.originalPath
      ? `<span class="commit-file-origin">${escapeHtml(file.originalPath)} →</span>`
      : "";
    const tree = depth !== null;
    return `
      <button class="commit-file-row file-status-${file.status} ${tree ? "tree-row" : "flat-row"} ${selected ? "selected" : ""}" type="button" ${tree ? `style="--tree-depth:${depth}"` : ""} data-commit-file="${escapeAttribute(file.path)}" aria-pressed="${selected}" title="${escapeAttribute(file.path)}">
        <span class="change-status status-${file.status}" title="${escapeAttribute(changeLabel(file.status))}">${changeCode(file.status)}</span>
        <span class="commit-file-glyph">${fileTypeIcon(file.path)}</span>
        <span class="change-path">
          ${previous}
          <span class="file-name">${escapeHtml(basename(file.path))}</span>
          ${tree ? "" : `<span class="file-directory">${escapeHtml(dirname(file.path))}</span>`}
        </span>
      </button>`;
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
    const snapshot = this.state.snapshot;
    const details = this.state.commitDetails;
    if (!snapshot || !details || !details.files.some((file) => file.path === path)) {
      return;
    }
    this.state.selectedCommitFile = path;
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
    this.renderBottomTool();
    this.renderEditor();
    if (restoreFocus) this.focusCommitFile(path);
    void this.loadSelectedCommitDiff(restoreFocus);
  }

  private focusCommitFile(path: string): void {
    const rows = this.root.querySelectorAll<HTMLButtonElement>("[data-commit-file]");
    Array.from(rows)
      .find((row) => row.dataset.commitFile === path)
      ?.focus();
  }

  private selectedCommitFile(details: CommitDetails): CommitFileChange | null {
    return (
      details.files.find((file) => file.path === this.state.selectedCommitFile) ??
      details.files[0] ??
      null
    );
  }

  private clearCommitInspection(): void {
    this.commitDetailsGeneration += 1;
    this.commitDiffGeneration += 1;
    this.state.selectedCommitFile = null;
    this.state.commitDetails = null;
    this.state.commitDetailsLoading = false;
    this.state.commitDetailsError = null;
    this.state.commitPatch = null;
    this.state.commitPatchLoading = false;
    this.state.commitPatchError = null;
  }

  private installSnapshotHistory(
    snapshot: RepositorySnapshot,
    preferTip = false,
    preserveFilters = false,
  ): void {
    const previousSource = this.state.history.source;
    const previousRoot = this.state.history.root;
    const previousSelected = this.state.selectedCommit;
    if (!preserveFilters) this.resetHistoryFilters();
    this.state.history = installSnapshotHistory(
      this.state.history,
      snapshot.root,
      snapshot.commits,
    );
    this.state.historyHasMore = snapshot.commits.length >= HISTORY_PAGE_SIZE;
    this.state.historyNextOffset = snapshot.commits.length;
    this.state.historyLoadingMore = false;
    this.state.historyRefreshing = false;
    this.state.historyPagingError = null;
    this.state.historyPagingRetry = null;
    this.historyPageSequence += 1;
    this.historyTopRefreshArmed = false;
    const selected =
      !preferTip && previousSource?.kind === "snapshot"
        ? snapshot.commits.find((commit) => commitKey(commit) === previousSelected)
            ? previousSelected
            : snapshot.commits[0]
              ? commitKey(snapshot.commits[0])
              : null
        : snapshot.commits[0]
          ? commitKey(snapshot.commits[0])
          : null;
    this.state.selectedCommit = selected;
    if (
      previousRoot !== snapshot.root ||
      previousSource?.kind !== "snapshot" ||
      previousSelected !== selected
    ) {
      this.clearCommitInspection();
    }
  }

  private resetHistoryFilters(): void {
    const query = defaultHistoryQuery();
    this.state.historyRefs = new Map(query.refs.map((reference) => [historyRefKey(reference), reference]));
    this.state.historyAuthorEmails = new Set(query.authorEmails);
    this.state.historyCurrentAuthor = query.currentAuthor;
    this.state.historyDatePreset = "all";
    this.state.historySinceEpoch = query.sinceEpoch;
    this.state.historyPaths = new Map(query.paths.map((path) => [historyPathKey(path), path]));
    this.state.historyRepositoryIds = new Set(query.repositoryIds);
    this.state.historyOrder = query.order;
    this.state.historyFirstParent = query.firstParent;
    this.state.historyExcludeMerges = query.excludeMerges;
    this.state.historyCollapseLinear = false;
    this.state.historyFilterMenu = null;
    this.state.historyBranchSubmenu = null;
  }

  private loadHistoryPreferences(snapshot: RepositorySnapshot): void {
    const preferences = loadHistoryRefPreferences(
      window.localStorage,
      snapshot.root,
      snapshot.branches.map(historyReference),
    );
    this.state.historyFavoriteRefs = new Map(
      preferences.favoriteRefs.map((reference) => [historyRefKey(reference), reference]),
    );
    this.state.historyRecentRefs = preferences.recentRefs;
  }

  private currentHistoryPreferences(): {
    favoriteRefs: HistoryRef[];
    recentRefs: HistoryRef[];
  } {
    return {
      favoriteRefs: Array.from(this.state.historyFavoriteRefs.values()),
      recentRefs: [...this.state.historyRecentRefs],
    };
  }

  private saveHistoryPreferences(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    saveHistoryRefPreferences(
      window.localStorage,
      snapshot.root,
      this.currentHistoryPreferences(),
    );
  }

  private recordRecentHistoryRef(reference: HistoryRef): void {
    const preferences = touchRecentRef(this.currentHistoryPreferences(), reference);
    this.state.historyRecentRefs = preferences.recentRefs;
    this.saveHistoryPreferences();
  }

  private toggleFavoriteHistoryRef(branch: BranchSummary): void {
    const preferences = toggleFavoriteRef(
      this.currentHistoryPreferences(),
      historyReference(branch),
    );
    this.state.historyFavoriteRefs = new Map(
      preferences.favoriteRefs.map((reference) => [historyRefKey(reference), reference]),
    );
    this.saveHistoryPreferences();
  }

  private recordRecentHistoryPath(path: HistoryPath): void {
    const key = historyPathKey(path);
    this.state.historyRecentPaths = [
      path,
      ...this.state.historyRecentPaths.filter((item) => historyPathKey(item) !== key),
    ].slice(0, 8);
  }

  private branchForKey(key: string): BranchSummary | null {
    return this.state.snapshot?.branches.find((branch) => branchKey(branch) === key) ?? null;
  }

  private pathForKey(key: string): HistoryPath | null {
    const candidate = historyPathCandidates(this.state.repositoryFiles).find(
      (path) => historyPathKey(path) === key,
    );
    return candidate
      ? { repositoryId: candidate.repositoryId, path: candidate.path }
      : null;
  }

  private activeHistoryQuery(): HistoryQuery {
    return normalizeHistoryQuery({
      repositoryIds: Array.from(this.state.historyRepositoryIds),
      refs: Array.from(this.state.historyRefs.values()),
      authorEmails: Array.from(this.state.historyAuthorEmails),
      currentAuthor: this.state.historyCurrentAuthor,
      sinceEpoch: this.state.historySinceEpoch,
      paths: Array.from(this.state.historyPaths.values()),
      firstParent: this.state.historyFirstParent,
      excludeMerges: this.state.historyExcludeMerges,
      order: this.state.historyOrder,
    });
  }

  private applyHistoryQuery(preferTip = false): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    const query = this.activeHistoryQuery();
    this.state.selectedCommit = null;
    this.clearCommitInspection();
    if (isSnapshotHistoryQuery(query)) {
      this.installSnapshotHistory(snapshot, preferTip);
      this.renderBottomTool();
      this.loadVisibleCommitDetails();
      return;
    }
    const pending = beginHistoryQuery(this.state.history, snapshot.root, query);
    this.state.history = pending.state;
    this.resetHistoryPaging();
    this.renderBottomTool();
    void this.loadHistory(pending.request);
  }

  private clearWorkingDiff(): void {
    this.diffGeneration += 1;
    this.state.workingPatch = null;
    this.state.workingPatchLoading = false;
    this.state.workingPatchError = null;
  }

  private renderCommitComposer(snapshot: RepositorySnapshot): string {
    const staged = snapshot.changes.filter(hasStagedChange);
    return `
      <section class="commit-tool" aria-label="Create commit">
        <div class="inspector-header">
          <span class="panel-eyebrow">Create commit</span>
          <h2>${staged.length} staged ${staged.length === 1 ? "file" : "files"}</h2>
        </div>
        <div class="commit-summary">
          ${staged.length === 0 ? '<p class="muted-copy">Stage at least one file to create a commit.</p>' : `<ul>${staged.slice(0, 3).map((change) => `<li><span class="change-status status-${change.indexStatus}">${changeCode(change.indexStatus)}</span><span>${escapeHtml(change.path)}</span></li>`).join("")}</ul>${staged.length > 3 ? `<small>and ${staged.length - 3} more</small>` : ""}`}
        </div>
        <div class="commit-form">
          <label for="commit-message">Commit message</label>
          <textarea id="commit-message" rows="4" placeholder="Describe this change…" ${staged.length === 0 ? "disabled" : ""}>${escapeHtml(this.state.commitMessage)}</textarea>
          <div class="commit-hint"><span>Ctrl/Cmd + Enter</span><span>${this.state.commitMessage.trim().length}/72</span></div>
          <button class="primary-button commit-button" id="commit-button" type="button" ${staged.length === 0 || this.state.commitMessage.trim().length === 0 || this.state.loading ? "disabled" : ""}>
            ${icon("commit", 16)} Commit ${staged.length || ""}
          </button>
        </div>
      </section>`;
  }

  private bindCommitComposer(snapshot: RepositorySnapshot): void {
    const staged = snapshot.changes.filter(hasStagedChange);
    const textarea = this.root.querySelector<HTMLTextAreaElement>("#commit-message");
    const button = this.root.querySelector<HTMLButtonElement>("#commit-button");
    textarea?.addEventListener("input", () => {
      this.state.commitMessage = textarea.value;
      if (button) {
        button.disabled = textarea.value.trim().length === 0 || staged.length === 0;
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

  private renderGitDetail(snapshot: RepositorySnapshot): string {
    if (this.state.gitDetail === "branch") {
      const branch = selectedBranch(snapshot, this.state.selectedBranch);
      return branch
        ? this.branchInspector(branch, snapshot)
        : this.inspectorPlaceholder();
    }
    const commit = selectedCommit(this.state.history.commits, this.state.selectedCommit);
    if (!commit) return this.inspectorPlaceholder();
    const details =
      this.state.commitDetails?.oid === commit.oid &&
      this.state.commitDetails.repositoryId === commit.repositoryId
        ? this.state.commitDetails
        : null;
    const fileCount = this.state.commitDetailsLoading
      ? "…"
      : this.state.commitDetailsError
        ? "!"
        : (details?.files.length.toString() ?? "…");
    const fileRows = this.state.commitDetailsLoading
      ? this.loadingBlock("Loading changed files…")
      : this.state.commitDetailsError
        ? this.retryState(
            "Could not load commit",
            this.state.commitDetailsError,
            "retry-commit-details",
            "history",
          )
        : details
          ? details.files.length
            ? this.state.commitFileView === "tree"
              ? `<div class="commit-file-tree" role="tree" aria-label="Changed files by directory">
                  <details class="commit-file-directory commit-file-root" open>
                    <summary style="--tree-depth:0"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(snapshot.repositoryRoots.find((root) => root.id === commit.repositoryId)?.displayName ?? basename(snapshot.root))}</span><small>${details.files.length} ${details.files.length === 1 ? "file" : "files"}</small></summary>
                    <div role="group">${buildCommitFileTree(details.files).map((node) => this.renderCommitFileTreeNode(node, 1)).join("")}</div>
                  </details>
                </div>`
              : `<div class="commit-file-flat-list" role="listbox" aria-label="Changed files as a flat list">${[...details.files]
                  .sort((left, right) => left.path.localeCompare(right.path))
                  .map((file) =>
                    this.commitFileRow(
                      file,
                      file.path === this.state.selectedCommitFile,
                    ),
                  )
                  .join("")}</div>`
            : '<div class="group-empty">No first-parent changes</div>'
          : this.loadingBlock("Loading changed files…");
    const nextView = this.state.commitFileView === "tree" ? "flat list" : "directory tree";
    return `
      <div class="commit-detail-layout">
        <section class="git-detail-files" aria-label="Changed files">
          <div class="commit-files-toolbar">
            <span class="commit-files-label">${icon("folder", 13)}<span>Files</span><b>${fileCount}</b></span>
            <button class="compact-icon-button" id="commit-file-view-toggle" type="button" aria-label="Show changed files as a ${nextView}" aria-pressed="${this.state.commitFileView === "tree"}" title="Show as ${nextView}">
              ${icon("eye", 14)}
            </button>
            <span class="commit-file-view-kind" aria-hidden="true">${icon(this.state.commitFileView === "tree" ? "folder" : "list", 13)}</span>
          </div>
          <div class="commit-file-list ${this.state.commitFileView}">${fileRows}</div>
        </section>
        <div class="workbench-splitter horizontal commit-summary-splitter" id="commit-summary-splitter" aria-label="Resize commit message and details"></div>
        ${this.commitInspector(commit)}
      </div>`;
  }

  private bindGitDetailEvents(snapshot: RepositorySnapshot): void {
    if (this.state.gitDetail === "branch") {
      const branch = selectedBranch(snapshot, this.state.selectedBranch);
      if (branch) this.bindBranchInspector(branch, snapshot);
      return;
    }
    this.bindCommitFileEvents();
    this.root
      .querySelector<HTMLButtonElement>("#commit-file-view-toggle")
      ?.addEventListener("click", () => {
        this.state.commitFileView = this.state.commitFileView === "tree" ? "flat" : "tree";
        saveCommitFileView(window.localStorage, this.state.commitFileView);
        this.renderBottomTool();
        this.root.querySelector<HTMLButtonElement>("#commit-file-view-toggle")?.focus();
      });
    this.root
      .querySelector<HTMLButtonElement>("#retry-commit-details")
      ?.addEventListener("click", () => void this.loadSelectedCommitDetails());
    const splitter = this.root.querySelector<HTMLElement>("#commit-summary-splitter");
    const layout = this.root.querySelector<HTMLElement>(".commit-detail-layout");
    if (splitter && layout) {
      this.commitDetailSplitterDisposer = attachSplitter(splitter, {
        orientation: "horizontal",
        direction: -1,
        getValue: () => this.state.layout.commitSummaryHeight,
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

  private async mutatePaths(stage: boolean, paths: string[]): Promise<void> {
    const snapshot = this.state.snapshot;
    if (!snapshot || paths.length === 0 || this.state.loading) return;
    const generation = ++this.requestGeneration;
    this.cancelActiveUntrackedScan();
    let pendingRoot: string | null = null;
    this.setLoading(true, stage ? "Staging changes…" : "Unstaging changes…");
    try {
      const next = stage
        ? await bridge.stagePaths(snapshot.root, paths)
        : await bridge.unstagePaths(snapshot.root, paths);
      this.state.snapshot = next;
      this.state.selectedBranch = null;
      this.installSnapshotHistory(next);
      const sourcePrefix = stage ? "worktree:" : "index:";
      const migrated = new Set(this.state.selectedChangeKeys);
      for (const path of paths) {
        const sourceKey = `${sourcePrefix}${path}`;
        if (!migrated.delete(sourceKey)) continue;
        if (changeExists(next, path, stage)) {
          migrated.add(changeSelectionKey(path, stage));
        }
      }
      this.state.selectedChangeKeys = migrated;
      if (
        this.state.selectedChange &&
        paths.includes(this.state.selectedChange.path) &&
        this.state.selectedChange.staged !== stage
      ) {
        this.state.selectedChange = changeExists(next, this.state.selectedChange.path, stage)
          ? { path: this.state.selectedChange.path, staged: stage }
          : null;
      }
      this.chooseValidChangeSelection();
      this.reconcileWorkingDocument(next);
      this.renderWorkspace();
      this.loadVisibleCommitDetails();
      if (this.activeDocument().kind === "working-diff") {
        void this.loadSelectedDiff();
      }
      pendingRoot = next.root;
    } catch (error) {
      this.showError(error);
    } finally {
      this.setLoading(false, "Ready");
    }
    if (pendingRoot && generation === this.requestGeneration) {
      void this.completeUntrackedScan(pendingRoot, generation);
    }
  }

  private async commit(): Promise<void> {
    const snapshot = this.state.snapshot;
    const message = this.state.commitMessage.trim();
    if (!snapshot || !message || this.state.loading) return;
    const generation = ++this.requestGeneration;
    this.cancelActiveUntrackedScan();
    let pendingRoot: string | null = null;
    this.setLoading(true, "Creating commit…");
    try {
      const next = await bridge.commitChanges(snapshot.root, message);
      this.state.snapshot = next;
      this.state.commitMessage = "";
      this.state.selectedBranch = null;
      this.installSnapshotHistory(next, true);
      this.chooseValidChangeSelection();
      this.reconcileWorkingDocument(next);
      this.renderWorkspace();
      this.loadVisibleCommitDetails();
      if (this.activeDocument().kind === "working-diff") {
        void this.loadSelectedDiff();
      }
      this.setStatus("Commit created", "success");
      pendingRoot = next.root;
    } catch (error) {
      this.showError(error);
    } finally {
      this.setLoading(false, "Ready");
    }
    if (pendingRoot && generation === this.requestGeneration) {
      void this.completeUntrackedScan(pendingRoot, generation);
    }
  }

  private async switchBranch(branch: BranchSummary): Promise<void> {
    const snapshot = this.state.snapshot;
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
    const snapshot = this.state.snapshot;
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
    if (this.state.snapshot?.branch.head === name) {
      this.state.newBranchName = "";
      this.renderBottomTool();
    }
  }

  private async runBranchMutation(
    loadingMessage: string,
    successMessage: string,
    mutation: (repositoryRoot: string) => Promise<RepositorySnapshot>,
  ): Promise<void> {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    if (!(await this.saveDirtyTabsBefore("changing branches"))) return;
    const generation = ++this.requestGeneration;
    this.cancelActiveUntrackedScan();
    this.clearError();
    let pendingRoot: string | null = null;
    let succeeded = false;
    this.setLoading(true, loadingMessage);
    this.renderBottomTool();
    try {
      const next = await mutation(snapshot.root);
      if (generation !== this.requestGeneration) return;
      this.state.snapshot = next;
      this.state.selectedBranch = null;
      this.installSnapshotHistory(next, true);
      this.state.selectedChangeKeys.clear();
      this.state.selectedChange = null;
      this.changeSelectionAnchor = null;
      this.chooseValidChangeSelection();
      this.captureMountedTextEditor();
      if (dirtyTextTabs(this.state.editor).length === 0) {
        this.state.editor = createEditorSession();
      }
      this.clearWorkingDiff();
      this.renderWorkspace();
      this.loadVisibleCommitDetails();
      void this.loadProjectFiles(next.root, generation);
      pendingRoot = next.root;
      succeeded = true;
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.showError(error);
    } finally {
      if (generation === this.requestGeneration) {
        this.setLoading(false, "Ready");
        this.renderBottomTool();
        if (succeeded) this.setStatus(successMessage, "success");
      }
    }
    if (pendingRoot && generation === this.requestGeneration) {
      void this.completeUntrackedScan(pendingRoot, generation);
    }
  }

  private async completeUntrackedScan(
    repositoryRoot: string,
    generation: number,
  ): Promise<void> {
    if (generation !== this.requestGeneration) return;
    const scan = {
      id: `${generation}-${++this.scanSequence}`,
      generation,
      root: repositoryRoot,
    };
    this.activeUntrackedScan = scan;
    this.setStatus("Scanning untracked files…", "busy");
    let completed = false;

    try {
      const supplement = await bridge.scanUntracked(repositoryRoot, scan.id);
      if (
        this.activeUntrackedScan !== scan ||
        generation !== this.requestGeneration ||
        supplement.root !== repositoryRoot
      ) {
        return;
      }
      const snapshot = this.state.snapshot;
      if (!snapshot || snapshot.root !== repositoryRoot) return;

      const tracked = snapshot.changes.filter(
        (change) => change.worktreeStatus !== "untracked",
      );
      this.state.snapshot = {
        ...snapshot,
        changes: [...tracked, ...supplement.changes].sort((left, right) =>
          left.path.localeCompare(right.path),
        ),
        untrackedState: "complete",
      };
      this.chooseValidChangeSelection();
      this.renderWorkspace();
      completed = true;
    } catch (error) {
      if (
        this.activeUntrackedScan !== scan ||
        generation !== this.requestGeneration
      ) {
        return;
      }
      const snapshot = this.state.snapshot;
      if (snapshot?.root === repositoryRoot) {
        snapshot.untrackedState = "failed";
        this.renderWorkspace();
      }
      this.showError(error);
    } finally {
      if (this.activeUntrackedScan === scan) {
        this.activeUntrackedScan = null;
        if (completed) {
          const recoveries = this.state.workspaceReplacement.recoveries.length;
          this.setStatus(
            recoveries > 0
              ? `${recoveries} replacement recovery ${recoveries === 1 ? "record needs" : "records need"} review`
              : "Ready",
            recoveries > 0 ? "warning" : "normal",
          );
        }
      }
    }
  }

  private cancelActiveUntrackedScan(): void {
    const scan = this.activeUntrackedScan;
    if (!scan) return;
    this.activeUntrackedScan = null;
    void bridge.cancelUntrackedScan(scan.id).catch(() => {
      // Generation checks still prevent an obsolete supplement from being merged.
    });
  }

  private chooseValidChangeSelection(): void {
    const changes = this.state.snapshot?.changes ?? [];
    const validKeys = new Set<string>();
    for (const change of changes) {
      if (hasStagedChange(change)) validKeys.add(changeSelectionKey(change.path, true));
      if (hasWorktreeChange(change)) validKeys.add(changeSelectionKey(change.path, false));
    }
    this.state.selectedChangeKeys = new Set(
      Array.from(this.state.selectedChangeKeys).filter((key) => validKeys.has(key)),
    );
    const current = this.state.selectedChange;
    const valid = current
      ? changes.some(
          (change) =>
            change.path === current.path &&
            (current.staged ? hasStagedChange(change) : hasWorktreeChange(change)),
        )
      : false;
    if (current && valid) {
      const currentKey = changeSelectionKey(current.path, current.staged);
      if (this.state.selectedChangeKeys.size === 0) {
        this.state.selectedChangeKeys.add(currentKey);
      } else if (!this.state.selectedChangeKeys.has(currentKey)) {
        const selectedKey = Array.from(this.state.selectedChangeKeys).at(-1);
        this.state.selectedChange = selectedKey ? changeSelectionFromKey(selectedKey) : null;
      }
      return;
    }

    const selectedKey = Array.from(this.state.selectedChangeKeys).at(-1);
    if (selectedKey) {
      this.state.selectedChange = changeSelectionFromKey(selectedKey);
      return;
    }

    const staged = changes.find(hasStagedChange);
    const unstaged = changes.find(hasWorktreeChange);
    this.state.selectedChange = staged
      ? { path: staged.path, staged: true }
      : unstaged
        ? { path: unstaged.path, staged: false }
        : null;
    if (this.state.selectedChange) {
      this.state.selectedChangeKeys.add(
        changeSelectionKey(
          this.state.selectedChange.path,
          this.state.selectedChange.staged,
        ),
      );
      this.changeSelectionAnchor = changeSelectionKey(
        this.state.selectedChange.path,
        this.state.selectedChange.staged,
      );
    } else {
      this.changeSelectionAnchor = null;
    }
  }

  private reconcileWorkingDocument(snapshot: RepositorySnapshot): void {
    const document = this.activeDocument();
    if (document.kind !== "working-diff") return;
    const stillValid = snapshot.changes.some(
      (change) =>
        change.path === document.selection.path &&
        (document.selection.staged
          ? hasStagedChange(change)
          : hasWorktreeChange(change)),
    );
    if (stillValid) {
      this.clearWorkingDiff();
      this.state.workingPatchLoading = true;
      return;
    }
    const replacement =
      this.state.selectedChange?.path === document.selection.path
        ? this.state.selectedChange
        : null;
    if (replacement) {
      this.activateDiffPreview({
        kind: "working-diff",
        repositoryRoot: snapshot.root,
        selection: { ...replacement },
      });
      this.clearWorkingDiff();
      this.state.workingPatchLoading = true;
      return;
    }
    this.state.editor = closePreview(this.state.editor);
    this.clearWorkingDiff();
  }

  private renderStatus(snapshot: RepositorySnapshot): void {
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
    this.textEditor.setReadOnly(loading);
    this.root.classList.toggle("is-busy", loading);
    this.query<HTMLButtonElement>("#refresh-button").disabled = loading;
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
        this.state.snapshot?.root ?? null,
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
    const currentRoot = this.state.snapshot?.root;
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
    input.value = path || this.state.snapshot?.root || "";
    dialog.classList.remove("hidden");
    window.setTimeout(() => input.focus(), 0);
  }

  private closeRepositoryDialog(): void {
    if (!this.state.snapshot && !bridge.isDemo) return;
    this.query("#repository-dialog").classList.add("hidden");
  }

  private commitInspector(commit: CommitSummary): string {
    const details =
      this.state.commitDetails?.oid === commit.oid &&
      this.state.commitDetails.repositoryId === commit.repositoryId
        ? this.state.commitDetails
        : null;
    const comparison = details
      ? details.parentOid?.slice(0, 10) ?? "Empty tree"
      : commit.parents[0]?.slice(0, 10) ?? "Empty tree";
    const references = commitReferences(
      commit.decorations,
      (this.state.snapshot?.branches ?? []).filter(
        (branch) => branch.repositoryId === commit.repositoryId,
      ),
    );
    const referenceRows = references
      .map((reference) => this.commitReferenceBadge(reference))
      .join("");
    const referenceSummary = references
      .slice(0, 3)
      .map((reference) => reference.label)
      .join(", ");
    return `
      <section class="commit-information" aria-label="Commit message and details">
        <h2>${escapeHtml(commit.subject)}</h2>
        <p class="commit-authorship">
          <code title="${escapeAttribute(commit.oid)}">${escapeHtml(commit.shortOid)}</code>
          <span>${escapeHtml(commit.authorName)}</span>
          <span class="commit-email">&lt;${escapeHtml(commit.authorEmail)}&gt;</span>
          <span>on</span>
          <time datetime="${new Date(commit.authoredAt * 1000).toISOString()}">${escapeHtml(formatAbsolute(commit.authoredAt))}</time>
        </p>
        ${(this.state.snapshot?.repositoryRoots.length ?? 0) > 1 ? `<span class="commit-comparison">Git root: ${escapeHtml(this.state.snapshot?.repositoryRoots.find((root) => root.id === commit.repositoryId)?.relativePath ?? commit.repositoryId)}</span>` : ""}
        ${references.length === 0 ? '<span class="commit-no-references">No named refs point to this commit</span>' : references.length <= 3 ? `<div class="commit-reference-list">${referenceRows}</div>` : `<details class="commit-reference-overflow"><summary><span>In ${references.length} refs: ${escapeHtml(referenceSummary)}…</span><b>Show all</b></summary><div class="commit-reference-list">${referenceRows}</div></details>`}
        <span class="commit-comparison" title="First-parent comparison">Compared with ${escapeHtml(comparison)}</span>
      </section>`;
  }

  private branchInspector(
    branch: BranchSummary,
    snapshot: RepositorySnapshot,
  ): string {
    const safety = this.branchSafety(snapshot);
    const mainRoot = branch.repositoryId === ".";
    const localTarget = branch.kind === "local" && mainRoot;
    const canCheckout =
      localTarget && !branch.current && safety.ready && !this.state.loading;
    const checkoutLabel = branch.current
      ? "Current branch"
      : localTarget
        ? safety.ready
          ? `Checkout ${branch.name}`
          : "Checkout blocked"
        : mainRoot ? "Local branches only" : "Submodule history only";
    const blockers = safety.blockers.length
      ? `<ul class="branch-blockers">${safety.blockers
          .slice(0, 5)
          .map((path) => `<li>${escapeHtml(path)}</li>`)
          .join("")}</ul>${safety.blockers.length > 5 ? `<small>and ${safety.blockers.length - 5} more</small>` : ""}`
      : "";
    return `
      <div class="inspector-header"><span class="panel-eyebrow">${escapeHtml(branch.kind)}</span><h2>${escapeHtml(branch.name)}</h2></div>
      <dl class="metadata-list">
        <div><dt>State</dt><dd>${branch.current ? "Checked out" : "Available"}</dd></div>
        <div><dt>Upstream</dt><dd>${escapeHtml(branch.upstream ?? "None")}</dd></div>
        <div><dt>Tracking</dt><dd>${escapeHtml(branch.tracking ?? "No divergence")}</dd></div>
        <div><dt>Updated</dt><dd>${formatRelative(branch.committedAt)}</dd></div>
      </dl>
      <section class="branch-action-card ${safety.ready ? "ready" : "blocked"}">
        <div class="branch-action-heading"><span>${icon("branch", 15)}</span><strong>Checkout</strong></div>
        <p>${localTarget ? escapeHtml(safety.message) : mainRoot ? "Select a local branch to check it out. Remote and tag checkout remain deferred." : "This initialized submodule is available for history inspection only; branch mutations remain scoped to the main repository."}</p>
        ${localTarget ? blockers : ""}
        <button class="primary-button" id="checkout-branch" type="button" ${canCheckout ? "" : "disabled"}>${escapeHtml(checkoutLabel)}</button>
      </section>
      ${mainRoot ? `<section class="branch-action-card create-branch-card ${safety.ready ? "ready" : "blocked"}">
        <div class="branch-action-heading"><span>${icon("plus", 15)}</span><strong>New local branch</strong></div>
        <p>Create from the current <code>HEAD</code>. The same clean-worktree gate applies.</p>
        <form id="create-branch-form">
          <label for="new-branch-name">Branch name</label>
          <input id="new-branch-name" type="text" value="${escapeAttribute(this.state.newBranchName)}" placeholder="feature/name" autocomplete="off" spellcheck="false" />
          <button class="secondary-button" id="create-branch-button" type="submit" ${safety.ready && this.state.newBranchName.trim() && !this.state.loading ? "" : "disabled"}>Create and checkout</button>
        </form>
      </section>` : ""}`;
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

  private inspectorPlaceholder(): string {
    return `<div class="inspector-header"><span class="panel-eyebrow">Details</span><h2>Nothing selected</h2></div><p class="muted-copy inspector-copy">Select an item to inspect its metadata and available actions.</p>`;
  }

  private emptyState(
    title: string,
    detail: string,
    iconName: "folder" | "changes" | "history" | "branch" | "check",
    compact = false,
  ): string {
    return `<div class="empty-state ${compact ? "compact" : ""}"><span class="empty-icon">${icon(iconName, compact ? 18 : 24)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
  }

  private loadingBlock(label: string): string {
    return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
  }

  private retryState(
    title: string,
    detail: string,
    buttonId: string,
    iconName: "changes" | "history" | "folder",
  ): string {
    return `<div class="empty-state"><span class="empty-icon">${icon(iconName, 24)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p><button class="secondary-button retry-button" id="${buttonId}" type="button">Try again</button></div>`;
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing application element: ${selector}`);
    return element;
  }
}

function hasStagedChange(change: FileChange): boolean {
  return change.indexStatus !== "unmodified" && change.indexStatus !== "ignored";
}

function hasWorktreeChange(change: FileChange): boolean {
  return change.worktreeStatus !== "unmodified" && change.worktreeStatus !== "ignored";
}

function changeSelectionKey(path: string, staged: boolean): string {
  return `${staged ? "index" : "worktree"}:${path}`;
}

function changePathFromKey(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

function changeSelectionFromKey(key: string): ChangeSelection {
  return {
    path: changePathFromKey(key),
    staged: key.startsWith("index:"),
  };
}

function changeExists(
  snapshot: RepositorySnapshot,
  path: string,
  staged: boolean,
): boolean {
  return snapshot.changes.some(
    (change) =>
      change.path === path && (staged ? hasStagedChange(change) : hasWorktreeChange(change)),
  );
}

function countCommitTreeFiles(node: CommitFileTreeNode): number {
  if (node.kind === "file") return 1;
  return node.children.reduce((total, child) => total + countCommitTreeFiles(child), 0);
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

function changeCode(kind: ChangeKind): string {
  const codes: Record<ChangeKind, string> = {
    unmodified: "·",
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    copied: "C",
    typeChanged: "T",
    unmerged: "U",
    untracked: "?",
    ignored: "!",
    unknown: "·",
  };
  return codes[kind];
}

function changeLabel(kind: ChangeKind): string {
  const labels: Record<ChangeKind, string> = {
    unmodified: "Unmodified",
    added: "Added",
    modified: "Modified",
    deleted: "Deleted",
    renamed: "Renamed",
    copied: "Copied",
    typeChanged: "Type changed",
    unmerged: "Unmerged",
    untracked: "Untracked",
    ignored: "Ignored",
    unknown: "Unknown",
  };
  return labels[kind];
}

function commandSurfaceTitle(mode: NavigationMode): string {
  const titles: Record<NavigationMode, string> = {
    files: "Search project files",
    recent: "Filter recent files",
    workspace: "Search text in current project",
    commands: "Search available commands",
  };
  return titles[mode];
}

function commandSurfaceHint(mode: NavigationMode): string {
  const hints: Record<NavigationMode, string> = {
    files: "Go to File · tracked and non-ignored project catalog",
    recent: "Recent Files · successful opens in this repository",
    workspace: "Find in Files · bounded search · reviewed recoverable replacement",
    commands: "Command Palette · only currently safe commands are enabled",
  };
  return hints[mode];
}

function replacementRecoveryLabel(recovery: ReplacementRecoverySummary): string {
  return recovery.status === "applied" ? "Ready to verify" : "Needs recovery";
}

function replacementFileStateLabel(
  state: ReplacementRecoverySummary["files"][number]["state"],
): string {
  const labels: Record<ReplacementRecoverySummary["files"][number]["state"], string> = {
    original: "Original",
    replaced: "Replaced",
    conflict: "Changed externally",
    unavailable: "Unavailable",
  };
  return labels[state];
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
  return normalized.split("/").pop() || normalized;
}

function projectMonogram(path: string): string {
  const name = basename(path).trim();
  return (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "P").toLocaleUpperCase();
}

function markdownSplitRange(width: number): { minimum: number; maximum: number } {
  const usableWidth = Math.max(0, width - 5);
  const minimum = Math.min(220, usableWidth / 2);
  return {
    minimum,
    maximum: Math.max(minimum, usableWidth - minimum),
  };
}

function dirname(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const offset = normalized.lastIndexOf("/");
  return offset < 0 ? "" : normalized.slice(0, offset);
}

function formatRelative(epochSeconds: number): string {
  if (!epochSeconds) return "Unknown time";
  const difference = epochSeconds * 1000 - Date.now();
  const absolute = Math.abs(difference);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (absolute < 60_000) return formatter.format(Math.round(difference / 1000), "second");
  if (absolute < 3_600_000) return formatter.format(Math.round(difference / 60_000), "minute");
  if (absolute < 86_400_000) return formatter.format(Math.round(difference / 3_600_000), "hour");
  if (absolute < 2_592_000_000) return formatter.format(Math.round(difference / 86_400_000), "day");
  return new Date(epochSeconds * 1000).toLocaleDateString();
}

function formatAbsolute(epochSeconds: number): string {
  if (!epochSeconds) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochSeconds * 1000));
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
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

function isWorkspaceConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as Record<string, unknown>).kind === "conflict",
  );
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
