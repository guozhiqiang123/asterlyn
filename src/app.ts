import { bridge } from "./bridge";
import { BRAND } from "./brand";
import { DiffEditor } from "./diff-editor";
import { icon } from "./icons";
import { preferredRemote, remotePolicy } from "./remote-policy";
import { windowControls } from "./window-controls";
import type { DiffLayout, DiffPresentation } from "./diff-presentation";
import {
  editorDocumentContentKey,
  type EditorDocument,
} from "./workbench/editor-document";
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
  buildProjectTree,
  type ProjectTreeNode,
} from "./workbench/project-tree";
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
  RepositorySnapshot,
} from "./models";

const RECENT_REPOSITORY_KEY = "asterlyn.recentRepository";

interface AppState {
  snapshot: RepositorySnapshot | null;
  layout: WorkbenchLayout;
  activeDocument: EditorDocument;
  gitDetail: "branch" | "commit";
  projectFiles: string[];
  projectFilesLoading: boolean;
  projectFilesError: string | null;
  projectFilesTruncated: boolean;
  selectedChange: ChangeSelection | null;
  selectedChangeKeys: Set<string>;
  changeQuery: string;
  selectedCommit: string | null;
  historyQuery: string;
  selectedCommitFile: string | null;
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
  diffLayout: DiffLayout;
  showWhitespace: boolean;
  selectedBranch: string | null;
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
  private readonly state: AppState = {
    snapshot: null,
    layout: loadWorkbenchLayout(window.localStorage),
    activeDocument: { kind: "welcome" },
    gitDetail: "commit",
    projectFiles: [],
    projectFilesLoading: false,
    projectFilesError: null,
    projectFilesTruncated: false,
    selectedChange: null,
    selectedChangeKeys: new Set(),
    changeQuery: "",
    selectedCommit: null,
    historyQuery: "",
    selectedCommitFile: null,
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
    diffLayout: "split",
    showWhitespace: false,
    selectedBranch: null,
    newBranchName: "",
    syncPopoverOpen: false,
    selectedRemote: null,
    remoteOperation: null,
    commitMessage: "",
    loading: false,
    error: null,
  };
  private requestGeneration = 0;
  private diffGeneration = 0;
  private commitDetailsGeneration = 0;
  private commitDiffGeneration = 0;
  private changeSelectionAnchor: string | null = null;
  private scanSequence = 0;
  private remoteOperationSequence = 0;
  private projectFilesGeneration = 0;
  private mountedEditorKey: string | null = null;
  private repositoryChooserOpen = false;
  private splitterDisposers: Array<() => void> = [];
  private workspaceResizeObserver: ResizeObserver | null = null;
  private activeUntrackedScan: {
    id: string;
    generation: number;
    root: string;
  } | null = null;

  constructor(private readonly root: HTMLElement) {}

  async start(): Promise<void> {
    this.renderShell();
    this.bindShellEvents();

    if (bridge.isDemo) {
      await this.openRepository("/workspace/asterlyn");
      return;
    }

    const initial = await bridge.initialRepository();
    if (initial) {
      await this.openRepository(initial);
      return;
    }

    const recent = window.localStorage.getItem(RECENT_REPOSITORY_KEY);
    if (recent) {
      await this.openRepository(recent);
    } else {
      await this.chooseRepository();
    }
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <main class="app-shell">
        <header class="topbar" data-tauri-drag-region>
          <div class="brand" data-tauri-drag-region>
            <span class="brand-mark" aria-hidden="true"><span>A</span></span>
            <span class="brand-name">${BRAND.name}</span>
            <span class="milestone-pill">${BRAND.milestone}</span>
          </div>
          <button class="repository-switcher" id="repository-switcher" type="button" aria-label="Open repository">
            ${icon("folder", 16)}
            <span class="repository-name" id="repository-name">No repository</span>
            <span class="repository-path" id="repository-path">Open a local folder</span>
          </button>
          <div class="topbar-actions" data-tauri-drag-region>
            <span class="demo-badge ${bridge.isDemo ? "" : "hidden"}">Browser demo</span>
            <div class="sync-anchor" id="sync-anchor">
              <button class="icon-button sync-button" id="sync-button" type="button" aria-label="Remote sync" title="Remote sync" aria-haspopup="dialog" aria-expanded="false">
                ${icon("sync", 17)}
                <span class="sync-badge hidden" id="sync-badge"></span>
              </button>
              <section class="sync-popover hidden" id="sync-popover" role="dialog" aria-label="Remote sync"></section>
            </div>
            <button class="icon-button" id="refresh-button" type="button" aria-label="Refresh repository" title="Refresh (Ctrl/Cmd+R)">
              ${icon("refresh", 17)}
            </button>
            <div class="window-controls ${windowControls.available ? "" : "hidden"}" role="group" aria-label="Window controls">
              <button class="window-control-button" id="window-minimize" type="button" aria-label="Minimize window" title="Minimize">
                ${icon("minimize", 15)}
              </button>
              <button class="window-control-button" id="window-maximize" type="button" aria-label="Maximize window" title="Maximize">
                ${icon("maximize", 14)}
              </button>
              <button class="window-control-button close" id="window-close" type="button" aria-label="Close window" title="Close">
                ${icon("close", 15)}
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
                  <div>
                    <span class="panel-eyebrow" id="navigator-eyebrow">Repository</span>
                    <h1 id="navigator-title">Files</h1>
                  </div>
                  <span class="panel-count" id="navigator-count">0</span>
                </div>
                <div class="navigator-body" id="navigator-body">
                  ${this.loadingBlock("Waiting for a repository")}
                </div>
              </aside>

              <div class="workbench-splitter vertical" id="left-splitter" aria-label="Resize left tool window"></div>

              <section class="content-panel editor-panel" id="editor-panel" aria-label="Editor">
                <div class="editor-tabbar" id="editor-tabbar">
                  <span class="editor-tab active">Welcome</span>
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
                  ${icon("minimize", 14)}
                </button>
              </div>
              <div class="git-tool-grid" id="git-tool-grid">
                <section class="git-tool-pane branch-tree-pane" aria-label="Branches">
                  <div class="git-pane-header"><strong>Branches</strong><span id="branch-count">0</span></div>
                  <div class="git-pane-body" id="branch-navigation-body"></div>
                </section>
                <div class="workbench-splitter vertical" id="branch-tree-splitter" aria-label="Resize branch tree"></div>
                <section class="git-tool-pane commit-log-pane" aria-label="Commit log">
                  <div class="git-pane-header"><strong>Log</strong><span id="history-count">0</span></div>
                  <div class="git-pane-body" id="history-navigation-body"></div>
                </section>
                <div class="workbench-splitter vertical" id="branch-details-splitter" aria-label="Resize Git details"></div>
                <aside class="git-tool-pane git-details-pane" aria-label="Git details">
                  <div class="git-pane-body" id="git-detail-body">${this.inspectorPlaceholder()}</div>
                </aside>
              </div>
            </section>
          </section>
        </div>

        <footer class="statusbar">
          <div class="status-left">
            <span class="status-indicator" id="status-indicator"></span>
            <span id="status-message">Ready</span>
          </div>
          <div class="status-right" id="branch-status"></div>
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
    this.query("#repository-switcher").addEventListener("click", () =>
      void this.chooseRepository(),
    );
    this.query("#sync-button").addEventListener("click", (event) => {
      event.stopPropagation();
      if (!this.state.snapshot) return;
      this.state.syncPopoverOpen = !this.state.syncPopoverOpen;
      this.renderRemotePopover(this.state.snapshot);
    });
    this.query("#refresh-button").addEventListener("click", () => void this.refresh());
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
    this.query<HTMLFormElement>("#repository-form").addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const path = this.query<HTMLInputElement>("#repository-input").value.trim();
        if (path) void this.openRepository(path);
      },
    );
    this.root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool as "files" | "branches" | "changes";
        this.toggleTool(tool);
      });
    });
    this.query("#hide-git-tool").addEventListener("click", () => {
      this.toggleTool("branches");
    });
    this.bindWorkbenchSplitters();
    this.workspaceResizeObserver = new ResizeObserver(() => {
      this.applyWorkbenchLayout(false);
    });
    this.workspaceResizeObserver.observe(this.query("#workbench"));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.closeRepositoryDialog();
        if (this.state.syncPopoverOpen && !this.state.remoteOperation) {
          this.state.syncPopoverOpen = false;
          if (this.state.snapshot) this.renderRemotePopover(this.state.snapshot);
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void this.refresh();
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f" &&
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
        }
      }
    });
    window.addEventListener("pointerdown", (event) => {
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
      void this.runWindowAction(() => windowControls.close());
    });

    this.refreshMaximizeControl();
    void windowControls
      .onResized(() => this.refreshMaximizeControl())
      .catch((error) => this.showError(error));
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
    button.innerHTML = icon(maximized ? "restore" : "maximize", 14);
  }

  private refreshMaximizeControl(): void {
    void this.syncMaximizeControl().catch((error) => this.showError(error));
  }

  private async openRepository(path: string): Promise<void> {
    const generation = ++this.requestGeneration;
    this.cancelActiveUntrackedScan();
    void this.cancelActiveRemoteOperation();
    let pendingRoot: string | null = null;
    this.setLoading(true, "Opening repository…");
    try {
      const snapshot = await bridge.openRepository(path);
      if (generation !== this.requestGeneration) return;
      window.localStorage.setItem(RECENT_REPOSITORY_KEY, snapshot.root);
      this.state.snapshot = snapshot;
      this.state.changeQuery = "";
      this.state.selectedChangeKeys.clear();
      this.changeSelectionAnchor = null;
      this.state.selectedCommit = snapshot.commits[0]?.oid ?? null;
      this.state.historyQuery = "";
      this.clearCommitInspection();
      this.state.commitDetailsLoading =
        this.state.layout.bottomTool === "branches" &&
        this.state.selectedCommit !== null;
      this.state.gitDetail = "commit";
      this.state.activeDocument = { kind: "welcome" };
      this.clearWorkingDiff();
      this.state.projectFiles = [];
      this.state.projectFilesLoading = true;
      this.state.projectFilesError = null;
      this.state.projectFilesTruncated = false;
      this.state.selectedBranch =
        snapshot.branches.find((branch) => branch.current)?.fullName ??
        snapshot.branches[0]?.fullName ??
        null;
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
      pendingRoot = snapshot.root;
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.showError(error);
      if (!this.state.snapshot && bridge.isDemo) this.openRepositoryDialog(path);
    } finally {
      if (generation === this.requestGeneration) this.setLoading(false, "Ready");
    }
    if (pendingRoot && generation === this.requestGeneration) {
      void this.completeUntrackedScan(pendingRoot, generation);
    }
  }

  private async refresh(): Promise<void> {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.loading) return;
    await this.openRepository(snapshot.root);
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
    this.state.selectedBranch =
      snapshot.branches.find((branch) => branch.current)?.fullName ??
      snapshot.branches[0]?.fullName ??
      null;
    this.state.selectedChangeKeys.clear();
    this.state.selectedChange = null;
    this.changeSelectionAnchor = null;
    this.chooseValidChangeSelection();
    this.reconcileWorkingDocument(snapshot);
    this.renderWorkspace();
    if (this.state.activeDocument.kind === "working-diff") {
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
      if (
        this.state.selectedCommit &&
        this.state.commitDetails?.oid !== this.state.selectedCommit
      ) {
        void this.loadSelectedCommitDetails();
      }
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
      | "diffBeforePercent",
    value: number,
  ): void {
    this.state.layout = reduceWorkbenchLayout(this.state.layout, {
      type: "resize",
      dimension,
      value,
    });
    this.applyWorkbenchLayout(false);
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
    const leftOpen = this.state.layout.leftTool !== null;
    const bottomOpen = this.state.layout.bottomTool !== null;
    workbench.classList.toggle("left-tool-open", leftOpen);
    workbench.classList.toggle("bottom-tool-open", bottomOpen);
    this.query("#left-tool").toggleAttribute("hidden", !leftOpen);
    this.query("#left-splitter").toggleAttribute("hidden", !leftOpen);
    this.query("#bottom-tool").toggleAttribute("hidden", !bottomOpen);
    this.query("#bottom-splitter").toggleAttribute("hidden", !bottomOpen);
    if (persist) this.persistWorkbenchLayout();
    window.requestAnimationFrame(() => this.diffEditor.requestMeasure());
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
    this.query("#repository-name").textContent = basename(snapshot.root);
    this.query("#repository-path").textContent = snapshot.root;
    this.state.selectedRemote = preferredRemote(snapshot, this.state.selectedRemote);
    this.renderRemotePopover(snapshot);
  }

  private renderLeftTool(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot || !this.state.layout.leftTool) return;
    const eyebrow = this.query("#navigator-eyebrow");
    const title = this.query("#navigator-title");
    const count = this.query("#navigator-count");
    const body = this.query("#navigator-body");

    if (this.state.layout.leftTool === "changes") {
      eyebrow.textContent = "Version control";
      title.textContent = "Changes";
      const filtered = this.filteredChanges(snapshot);
      count.textContent = filtered.length.toString();
      count.title = this.state.changeQuery
        ? `${filtered.length} of ${snapshot.changes.length} changed files`
        : `${snapshot.changes.length} changed files`;
      body.innerHTML = `<div class="changes-tool-layout"><div class="changes-tool-navigation">${this.renderChangeNavigation(snapshot)}</div>${this.renderCommitComposer(snapshot)}</div>`;
      this.bindChangeEvents();
      this.bindCommitComposer(snapshot);
      return;
    }

    eyebrow.textContent = "Project";
    title.textContent = basename(snapshot.root);
    count.textContent = this.state.projectFiles.length.toString();
    count.title = `${this.state.projectFiles.length} repository files`;
    body.innerHTML = this.renderProjectNavigation(snapshot);
    this.bindProjectEvents();
  }

  private renderBottomTool(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.layout.bottomTool !== "branches") return;
    const commits = this.filteredHistoryCommits(snapshot);
    this.query("#branch-count").textContent = String(snapshot.branches.length);
    this.query("#history-count").textContent = String(commits.length);
    this.query("#branch-navigation-body").innerHTML =
      this.renderBranchNavigation(snapshot);
    this.query("#history-navigation-body").innerHTML =
      this.renderHistoryNavigation(snapshot);
    this.query("#git-detail-body").innerHTML = this.renderGitDetail(snapshot);
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
      this.state.projectFilesTruncated = result.truncated;
      this.state.projectFilesLoading = false;
      if (this.state.layout.leftTool === "files") this.renderLeftTool();
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
      this.showError(error);
    }
  }

  private renderProjectNavigation(snapshot: RepositorySnapshot): string {
    const untracked = snapshot.changes
      .filter((change) => change.worktreeStatus === "untracked")
      .map((change) => change.path);
    const paths = Array.from(new Set([...this.state.projectFiles, ...untracked]));
    if (paths.length === 0 && this.state.projectFilesLoading) {
      return this.loadingBlock("Loading project files…");
    }
    if (paths.length === 0 && this.state.projectFilesError) {
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
        ? '<div class="project-tree-notice warning"><span>!</span><span>Showing the first 5,000 tracked paths.</span></div>'
        : "",
      this.state.projectFilesError
        ? `<div class="project-tree-notice warning"><span>!</span><span>${escapeHtml(this.state.projectFilesError)}</span></div>`
        : "",
    ].join("");
    return `<div class="project-tree" role="tree" aria-label="Project files">${buildProjectTree(paths).map((node) => this.renderProjectNode(node, 0)).join("")}</div>${notices}`;
  }

  private renderProjectNode(node: ProjectTreeNode, depth: number): string {
    if (node.kind === "directory") {
      return `<details class="project-directory" ${depth < 2 ? "open" : ""}><summary style="--tree-depth:${depth}"><span class="tree-chevron">${icon("chevron", 12)}</span>${icon("folder", 15)}<span>${escapeHtml(node.name)}</span></summary><div role="group">${node.children.map((child) => this.renderProjectNode(child, depth + 1)).join("")}</div></details>`;
    }
    const selected =
      this.state.activeDocument.kind === "project-file" &&
      this.state.activeDocument.path === node.path;
    return `<button class="project-file-row ${selected ? "selected" : ""}" type="button" role="treeitem" style="--tree-depth:${depth}" data-project-file="${escapeAttribute(node.path)}" aria-selected="${selected}" title="${escapeAttribute(node.path)}"><span class="project-file-glyph">${fileGlyph(node.name)}</span><span>${escapeHtml(node.name)}</span></button>`;
  }

  private bindProjectEvents(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    this.root
      .querySelector<HTMLButtonElement>("#retry-project-files")
      ?.addEventListener("click", () => {
        void this.loadProjectFiles(snapshot.root);
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-project-file]").forEach((row) => {
      row.addEventListener("click", () => {
        const path = row.dataset.projectFile;
        const current = this.state.snapshot;
        if (!path || !current) return;
        this.state.activeDocument = {
          kind: "project-file",
          repositoryRoot: current.root,
          path,
        };
        this.renderLeftTool();
        this.renderEditor();
      });
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
      <div class="change-row ${selected ? "selected" : ""} ${primary ? "primary" : ""}" role="option" tabindex="0" data-change-key="${escapeAttribute(key)}" data-change-path="${escapeAttribute(change.path)}" data-staged="${staged}" aria-selected="${selected}" aria-label="${selected ? "Selected, " : ""}view ${staged ? "staged" : "working tree"} diff for ${escapeAttribute(change.path)}">
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

  private renderHistoryNavigation(snapshot: RepositorySnapshot): string {
    if (snapshot.commits.length === 0) {
      return this.emptyState("No commits yet", "The first commit will appear here.", "history", true);
    }
    const commits = this.filteredHistoryCommits(snapshot);
    return `
      <div class="history-navigation">
        <label class="history-filter" for="history-filter">
          ${icon("search", 14)}
          <input id="history-filter" type="search" value="${escapeAttribute(this.state.historyQuery)}" placeholder="Filter message, author, hash…" autocomplete="off" spellcheck="false" aria-label="Filter commit history" aria-keyshortcuts="Control+F Meta+F" />
          <span>Ctrl F</span>
        </label>
        <div class="history-results" id="history-results" aria-live="polite">
          ${this.renderHistoryRows(commits)}
        </div>
      </div>`;
  }

  private renderHistoryRows(commits: CommitSummary[]): string {
    if (commits.length === 0) {
      return `<div class="history-no-results"><strong>No matching commits</strong><span>Try a message, author, decoration, or full hash.</span></div>`;
    }
    return `<div class="history-list">${commits
      .map((commit) => {
        const selected = commit.oid === this.state.selectedCommit;
        return `
          <button class="history-row ${selected ? "selected" : ""}" type="button" data-commit="${commit.oid}" aria-pressed="${selected}">
            <span class="graph-dot ${commit.parents.length > 1 ? "merge" : ""}"></span>
            <span class="history-copy">
              <span class="history-subject">${escapeHtml(commit.subject)}</span>
              <span class="history-meta">${escapeHtml(commit.authorName)} · ${formatRelative(commit.authoredAt)}</span>
            </span>
            <code>${escapeHtml(commit.shortOid)}</code>
          </button>`;
      })
      .join("")}</div>`;
  }

  private filteredHistoryCommits(snapshot: RepositorySnapshot): CommitSummary[] {
    const query = this.state.historyQuery.trim().toLocaleLowerCase();
    if (!query) return snapshot.commits;
    return snapshot.commits.filter((commit) =>
      [
        commit.oid,
        commit.shortOid,
        commit.subject,
        commit.authorName,
        commit.authorEmail,
        ...commit.decorations,
      ].some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }

  private renderBranchNavigation(snapshot: RepositorySnapshot): string {
    if (snapshot.branches.length === 0) {
      return this.emptyState("No refs", "Branches and tags will appear here.", "branch", true);
    }
    const groups: Array<[string, BranchSummary["kind"]]> = [
      ["Local", "local"],
      ["Remote", "remote"],
      ["Tags", "tag"],
    ];
    return groups
      .map(([label, kind]) => {
        const branches = snapshot.branches.filter((branch) => branch.kind === kind);
        if (branches.length === 0) return "";
        return `<section class="branch-group"><div class="group-header"><span>${label}<b>${branches.length}</b></span></div>${branches
          .map((branch) => this.branchRow(branch))
          .join("")}</section>`;
      })
      .join("");
  }

  private branchRow(branch: BranchSummary): string {
    const selected = branch.fullName === this.state.selectedBranch;
    return `
      <button class="branch-row ${selected ? "selected" : ""}" type="button" data-branch="${escapeAttribute(branch.fullName)}" aria-pressed="${selected}">
        <span class="branch-glyph ${branch.current ? "current" : ""}">${icon("branch", 15)}</span>
        <span class="branch-copy">
          <span>${escapeHtml(branch.name)}</span>
          <small>${escapeHtml(branch.subject)}</small>
        </span>
        ${branch.current ? '<span class="current-pill">Current</span>' : ""}
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
      this.state.activeDocument = {
        kind: "working-diff",
        repositoryRoot: this.state.snapshot.root,
        selection: { ...this.state.selectedChange },
      };
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
        const oid = first.dataset.commit;
        if (oid) this.selectCommit(oid, true);
      }
    });
    this.bindHistoryRows();
  }

  private bindHistoryRows(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-commit]").forEach((row) => {
      row.addEventListener("click", () => {
        const oid = row.dataset.commit;
        if (oid) this.selectCommit(oid);
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
        const oid = target?.dataset.commit;
        if (oid) this.selectCommit(oid, true);
      });
    });
  }

  private renderHistoryResults(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.layout.bottomTool !== "branches") return;
    const commits = this.filteredHistoryCommits(snapshot);
    this.query("#history-results").innerHTML = this.renderHistoryRows(commits);
    const count = this.query("#history-count");
    count.textContent = commits.length.toString();
    count.title = `${commits.length} of ${snapshot.commits.length} commits`;
    this.bindHistoryRows();
  }

  private focusHistoryFilter(): void {
    const input = this.root.querySelector<HTMLInputElement>("#history-filter");
    input?.focus();
    input?.select();
  }

  private selectCommit(oid: string, restoreFocus = false): void {
    if (oid === this.state.selectedCommit && this.state.commitDetails?.oid === oid) {
      this.state.gitDetail = "commit";
      this.renderBottomTool();
      if (restoreFocus) this.focusHistoryCommit(oid);
      return;
    }
    this.state.selectedCommit = oid;
    this.state.gitDetail = "commit";
    this.clearCommitInspection();
    this.state.commitDetailsLoading = true;
    this.renderBottomTool();
    if (restoreFocus) this.focusHistoryCommit(oid);
    void this.loadSelectedCommitDetails();
  }

  private focusHistoryCommit(oid: string): void {
    this.root
      .querySelector<HTMLButtonElement>(`[data-commit="${oid}"]`)
      ?.focus();
  }

  private bindBranchEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-branch]").forEach((row) => {
      row.addEventListener("click", () => {
        const fullName = row.dataset.branch;
        if (fullName) this.selectBranch(fullName);
      });
      row.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const rows = Array.from(
          this.root.querySelectorAll<HTMLButtonElement>("[data-branch]"),
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
        const fullName = target?.dataset.branch;
        if (fullName) this.selectBranch(fullName, true);
      });
    });
  }

  private selectBranch(fullName: string, restoreFocus = false): void {
    this.state.selectedBranch = fullName;
    this.state.gitDetail = "branch";
    this.renderBottomTool();
    if (restoreFocus) {
      const rows = this.root.querySelectorAll<HTMLButtonElement>("[data-branch]");
      Array.from(rows)
        .find((row) => row.dataset.branch === fullName)
        ?.focus();
    }
  }

  private renderEditor(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    const document = this.state.activeDocument;
    const header = this.query("#content-header");
    const tabbar = this.query("#editor-tabbar");

    if (document.kind === "welcome") {
      tabbar.innerHTML = '<span class="editor-tab active">Welcome</span>';
      header.innerHTML = this.contentHeading(`${BRAND.name} Editor`, "Workspace");
      this.showEditorHtml(
        "welcome",
        this.emptyState(
          "Editor workspace ready",
          "Choose a changed or committed file to open its Diff. File editing arrives in Stage 3 without changing this layout.",
          "folder",
        ),
      );
      return;
    }

    if (document.kind === "project-file") {
      tabbar.innerHTML = `<span class="editor-tab active">${escapeHtml(basename(document.path))}</span>`;
      header.innerHTML = this.contentHeading(basename(document.path), document.path);
      this.showEditorHtml(
        editorDocumentContentKey(document, "navigation-placeholder-v1"),
        this.emptyState(
          "File navigation is connected",
          "This read-only project tree establishes the editor route. File loading, editing, save, and recovery belong to Stage 3.",
          "folder",
        ),
      );
      return;
    }

    if (document.kind === "working-diff") {
      const selected = document.selection;
      tabbar.innerHTML = `<span class="editor-tab active">${escapeHtml(basename(selected.path))} <small>Diff</small></span>`;
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
        );
      }
      return;
    }

    const commit = snapshot.commits.find((item) => item.oid === document.oid);
    const shortOid = commit?.shortOid ?? document.oid.slice(0, 8);
    tabbar.innerHTML = `<span class="editor-tab active">${escapeHtml(basename(document.path))} <small>${escapeHtml(shortOid)}</small></span>`;
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
      );
    }
  }

  private showEditorHtml(key: string, html: string): void {
    if (this.mountedEditorKey === key) return;
    this.diffEditor.destroy();
    const body = this.query("#content-body");
    body.classList.remove("diff-surface");
    body.innerHTML = html;
    this.mountedEditorKey = key;
  }

  private mountEditorDiff(key: string, patch: string): void {
    if (this.mountedEditorKey === key) {
      this.diffEditor.requestMeasure();
      return;
    }
    this.diffEditor.destroy();
    const body = this.query("#content-body");
    body.innerHTML = "";
    body.classList.add("diff-surface");
    this.diffEditor.mount(body, patch, this.diffPresentation());
    this.mountedEditorKey = key;
  }

  private contentHeading(title: string, subtitle: string): string {
    return `<div class="content-title-group"><span class="content-kicker">${escapeHtml(subtitle)}</span><h2>${escapeHtml(title)}</h2></div>`;
  }

  private diffControls(): string {
    return `
      <div class="diff-controls" role="group" aria-label="Diff presentation">
        <button type="button" data-diff-layout="unified" aria-pressed="${this.state.diffLayout === "unified"}" title="Unified diff">Unified</button>
        <button type="button" data-diff-layout="split" aria-pressed="${this.state.diffLayout === "split"}" title="Side-by-side diff">Split</button>
        <button type="button" data-diff-whitespace aria-pressed="${this.state.showWhitespace}" title="Show whitespace characters">Whitespace</button>
      </div>`;
  }

  private bindDiffControls(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-diff-layout]").forEach((button) => {
      button.addEventListener("click", () => {
        const layout = button.dataset.diffLayout as DiffLayout;
        if (layout === this.state.diffLayout) return;
        this.state.diffLayout = layout;
        this.syncDiffControls();
        this.diffEditor.setPresentation(this.diffPresentation());
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-diff-whitespace]")?.addEventListener(
      "click",
      () => {
        this.state.showWhitespace = !this.state.showWhitespace;
        this.syncDiffControls();
        this.diffEditor.setPresentation(this.diffPresentation());
      },
    );
  }

  private syncDiffControls(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-diff-layout]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.diffLayout === this.state.diffLayout),
      );
    });
    this.root
      .querySelector<HTMLButtonElement>("[data-diff-whitespace]")
      ?.setAttribute("aria-pressed", String(this.state.showWhitespace));
  }

  private diffPresentation(): DiffPresentation {
    return {
      layout: this.state.diffLayout,
      showWhitespace: this.state.showWhitespace,
      splitPercentage: this.state.layout.diffBeforePercent,
      onSplitPercentageChange: (value, committed) => {
        this.resizeWorkbench("diffBeforePercent", value);
        if (committed) this.persistWorkbenchLayout();
      },
    };
  }

  private async loadSelectedDiff(): Promise<void> {
    const snapshot = this.state.snapshot;
    const document = this.state.activeDocument;
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
      const current = this.state.activeDocument;
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
      const current = this.state.activeDocument;
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

  private async loadSelectedCommitDetails(): Promise<void> {
    const snapshot = this.state.snapshot;
    const oid = this.state.selectedCommit;
    if (!snapshot || !oid) return;
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
      const details = await bridge.readCommitDetails(snapshot.root, oid);
      if (
        generation !== this.commitDetailsGeneration ||
        this.state.snapshot?.root !== snapshot.root ||
        this.state.selectedCommit !== oid ||
        details.oid !== oid
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
        this.state.selectedCommit !== oid
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
    const document = this.state.activeDocument;
    if (
      !snapshot ||
      !details ||
      !file ||
      document.kind !== "commit-diff" ||
      document.repositoryRoot !== snapshot.root ||
      document.oid !== details.oid ||
      document.path !== file.path
    ) {
      return;
    }
    const oid = details.oid;
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
        oid,
        file.path,
        file.originalPath,
      );
      if (
        generation !== this.commitDiffGeneration ||
        this.state.snapshot?.root !== snapshot.root ||
        this.state.selectedCommit !== oid ||
        this.state.selectedCommitFile !== file.path ||
        this.state.activeDocument.kind !== "commit-diff" ||
        this.state.activeDocument.oid !== oid ||
        this.state.activeDocument.path !== file.path ||
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
      if (
        generation !== this.commitDiffGeneration ||
        this.state.snapshot?.root !== snapshot.root ||
        this.state.selectedCommit !== oid ||
        this.state.selectedCommitFile !== file.path ||
        this.state.activeDocument.kind !== "commit-diff" ||
        this.state.activeDocument.oid !== oid ||
        this.state.activeDocument.path !== file.path
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

  private commitFileRow(file: CommitFileChange, selected: boolean): string {
    const previous = file.originalPath
      ? `<span class="commit-file-origin">${escapeHtml(file.originalPath)} →</span>`
      : "";
    return `
      <button class="commit-file-row ${selected ? "selected" : ""}" type="button" data-commit-file="${escapeAttribute(file.path)}" aria-pressed="${selected}" title="${escapeAttribute(file.path)}">
        <span class="change-status status-${file.status}" title="${escapeAttribute(changeLabel(file.status))}">${changeCode(file.status)}</span>
        <span class="change-path">
          ${previous}
          <span class="file-name">${escapeHtml(basename(file.path))}</span>
          <span class="file-directory">${escapeHtml(dirname(file.path))}</span>
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
    this.state.activeDocument = {
      kind: "commit-diff",
      repositoryRoot: snapshot.root,
      oid: details.oid,
      path,
    };
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
    const commit = selectedCommit(snapshot, this.state.selectedCommit);
    if (!commit) return this.inspectorPlaceholder();
    const details =
      this.state.commitDetails?.oid === commit.oid ? this.state.commitDetails : null;
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
            ? details.files
                .map((file) =>
                  this.commitFileRow(
                    file,
                    file.path === this.state.selectedCommitFile,
                  ),
                )
                .join("")
            : '<div class="group-empty">No first-parent changes</div>'
          : this.loadingBlock("Loading changed files…");
    return `
      <div class="commit-detail-layout">
        <div class="inspector-header commit-detail-header"><span class="panel-eyebrow">Commit</span><h2>${escapeHtml(commit.shortOid)}</h2></div>
        <section class="git-detail-files" aria-label="Changed files">
          <div class="commit-files-header"><span>Changed files</span><b>${fileCount}</b></div>
          <div class="commit-file-list">${fileRows}</div>
        </section>
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
      .querySelector<HTMLButtonElement>("#retry-commit-details")
      ?.addEventListener("click", () => void this.loadSelectedCommitDetails());
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
      if (this.state.activeDocument.kind === "working-diff") {
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
      this.state.selectedCommit = next.commits[0]?.oid ?? null;
      this.clearCommitInspection();
      this.chooseValidChangeSelection();
      this.reconcileWorkingDocument(next);
      this.renderWorkspace();
      if (this.state.activeDocument.kind === "working-diff") {
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
      this.state.selectedBranch =
        next.branches.find((branch) => branch.current)?.fullName ??
        next.branches[0]?.fullName ??
        null;
      this.state.selectedChangeKeys.clear();
      this.state.selectedChange = null;
      this.changeSelectionAnchor = null;
      this.chooseValidChangeSelection();
      this.state.activeDocument = { kind: "welcome" };
      this.clearWorkingDiff();
      this.renderWorkspace();
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
        if (completed) this.setStatus("Ready", "normal");
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
    const document = this.state.activeDocument;
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
      this.state.activeDocument = {
        kind: "working-diff",
        repositoryRoot: snapshot.root,
        selection: { ...replacement },
      };
      this.clearWorkingDiff();
      this.state.workingPatchLoading = true;
      return;
    }
    this.state.activeDocument = { kind: "welcome" };
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
        await this.openRepository(choice.path);
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
    const details = this.state.commitDetails?.oid === commit.oid ? this.state.commitDetails : null;
    const comparison = details
      ? details.parentOid?.slice(0, 10) ?? "Empty tree"
      : commit.parents[0]?.slice(0, 10) ?? "Empty tree";
    return `
      <details class="commit-information">
        <summary>
          <span class="commit-information-label">${icon("chevron", 13)} Commit information</span>
          <span class="commit-information-preview">${escapeHtml(commit.authorName)} · ${formatRelative(commit.authoredAt)}</span>
        </summary>
        <div class="message-card"><span>Message</span><p>${escapeHtml(commit.subject)}</p></div>
        <dl class="metadata-list">
          <div><dt>Author</dt><dd>${escapeHtml(commit.authorName)}</dd></div>
          <div><dt>Email</dt><dd>${escapeHtml(commit.authorEmail)}</dd></div>
          <div><dt>Date</dt><dd>${formatAbsolute(commit.authoredAt)}</dd></div>
          <div><dt>Object</dt><dd title="${escapeAttribute(commit.oid)}">${escapeHtml(commit.oid)}</dd></div>
          <div><dt>Parents</dt><dd>${commit.parents.length || "None"}</dd></div>
          <div><dt>Compared with</dt><dd>${escapeHtml(comparison)}</dd></div>
        </dl>
      </details>`;
  }

  private branchInspector(
    branch: BranchSummary,
    snapshot: RepositorySnapshot,
  ): string {
    const safety = this.branchSafety(snapshot);
    const localTarget = branch.kind === "local";
    const canCheckout =
      localTarget && !branch.current && safety.ready && !this.state.loading;
    const checkoutLabel = branch.current
      ? "Current branch"
      : localTarget
        ? safety.ready
          ? `Checkout ${branch.name}`
          : "Checkout blocked"
        : "Local branches only";
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
        <p>${localTarget ? escapeHtml(safety.message) : "Select a local branch to check it out. Remote and tag checkout remain deferred."}</p>
        ${localTarget ? blockers : ""}
        <button class="primary-button" id="checkout-branch" type="button" ${canCheckout ? "" : "disabled"}>${escapeHtml(checkoutLabel)}</button>
      </section>
      <section class="branch-action-card create-branch-card ${safety.ready ? "ready" : "blocked"}">
        <div class="branch-action-heading"><span>${icon("plus", 15)}</span><strong>New local branch</strong></div>
        <p>Create from the current <code>HEAD</code>. The same clean-worktree gate applies.</p>
        <form id="create-branch-form">
          <label for="new-branch-name">Branch name</label>
          <input id="new-branch-name" type="text" value="${escapeAttribute(this.state.newBranchName)}" placeholder="feature/name" autocomplete="off" spellcheck="false" />
          <button class="secondary-button" id="create-branch-button" type="submit" ${safety.ready && this.state.newBranchName.trim() && !this.state.loading ? "" : "disabled"}>Create and checkout</button>
        </form>
      </section>`;
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

function selectedCommit(
  snapshot: RepositorySnapshot,
  oid: string | null,
): CommitSummary | null {
  return snapshot.commits.find((commit) => commit.oid === oid) ?? snapshot.commits[0] ?? null;
}

function selectedBranch(
  snapshot: RepositorySnapshot,
  fullName: string | null,
): BranchSummary | null {
  return (
    snapshot.branches.find((branch) => branch.fullName === fullName) ??
    snapshot.branches[0] ??
    null
  );
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

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
  return normalized.split("/").pop() || normalized;
}

function dirname(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const offset = normalized.lastIndexOf("/");
  return offset < 0 ? "" : normalized.slice(0, offset);
}

function fileGlyph(name: string): string {
  const extension = name.includes(".") ? name.split(".").pop()?.toLocaleUpperCase() : null;
  const labels: Record<string, string> = {
    CSS: "#",
    HTML: "<>",
    JS: "JS",
    JSON: "{}",
    MD: "M",
    RS: "R",
    TS: "TS",
    TOML: "T",
  };
  return extension ? (labels[extension] ?? "·") : "·";
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
