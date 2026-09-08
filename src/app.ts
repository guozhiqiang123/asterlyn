import { bridge } from "./bridge";
import { BRAND } from "./brand";
import { DiffEditor } from "./diff-editor";
import { icon } from "./icons";
import type {
  BranchSummary,
  ChangeKind,
  ChangeSelection,
  CommitSummary,
  FileChange,
  RepositorySnapshot,
  WorkspaceView,
} from "./models";

const RECENT_REPOSITORY_KEY = "asterlyn.recentRepository";

interface AppState {
  snapshot: RepositorySnapshot | null;
  activeView: WorkspaceView;
  selectedChange: ChangeSelection | null;
  selectedCommit: string | null;
  selectedBranch: string | null;
  commitMessage: string;
  loading: boolean;
  error: string | null;
}

export class AsterlynApp {
  private readonly diffEditor = new DiffEditor();
  private readonly state: AppState = {
    snapshot: null,
    activeView: "changes",
    selectedChange: null,
    selectedCommit: null,
    selectedBranch: null,
    commitMessage: "",
    loading: false,
    error: null,
  };
  private requestGeneration = 0;
  private diffGeneration = 0;

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
      this.openRepositoryDialog();
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
          <div class="topbar-actions">
            <span class="demo-badge ${bridge.isDemo ? "" : "hidden"}">Browser demo</span>
            <button class="icon-button" id="refresh-button" type="button" aria-label="Refresh repository" title="Refresh (Ctrl/Cmd+R)">
              ${icon("refresh", 17)}
            </button>
          </div>
        </header>

        <div class="workspace">
          <nav class="activity-rail" aria-label="Workspace views">
            ${this.activityButton("changes", "Changes", "changes")}
            ${this.activityButton("history", "History", "history")}
            ${this.activityButton("branches", "Branches", "branch")}
            <span class="rail-spacer"></span>
            <span class="rail-version" aria-label="${BRAND.name} version ${BRAND.version}">${BRAND.version}</span>
          </nav>

          <aside class="navigator" aria-label="Repository navigation">
            <div class="panel-header">
              <div>
                <span class="panel-eyebrow">Repository</span>
                <h1 id="navigator-title">Changes</h1>
              </div>
              <span class="panel-count" id="navigator-count">0</span>
            </div>
            <div class="navigator-body" id="navigator-body">
              ${this.loadingBlock("Waiting for a repository")}
            </div>
          </aside>

          <section class="content-panel" aria-label="Content">
            <div class="content-header" id="content-header">
              <div class="content-title-group">
                <span class="content-kicker">Welcome</span>
                <h2>${BRAND.name} Git Workbench</h2>
              </div>
            </div>
            <div class="content-body" id="content-body">
              ${this.emptyState("Open a repository", "Inspect local changes, history, and branches in one focused workspace.", "folder")}
            </div>
          </section>

          <aside class="inspector" id="inspector" aria-label="Details">
            ${this.inspectorPlaceholder()}
          </aside>
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
                <span class="panel-eyebrow">Workspace</span>
                <h2 id="dialog-title">Open a Git repository</h2>
              </div>
              <button class="icon-button" id="dialog-close" type="button" aria-label="Close">${icon("close", 17)}</button>
            </div>
            <p>Enter the path to a local repository. Asterlyn reads Git state directly and does not import or copy the project.</p>
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
    view: WorkspaceView,
    label: string,
    iconName: "changes" | "history" | "branch",
  ): string {
    return `<button class="activity-button ${view === this.state.activeView ? "active" : ""}" data-view="${view}" type="button" aria-label="${label}" title="${label}" ${view === this.state.activeView ? 'aria-current="page"' : ""}>${icon(iconName, 20)}<span>${label}</span></button>`;
  }

  private bindShellEvents(): void {
    this.query("#repository-switcher").addEventListener("click", () =>
      this.openRepositoryDialog(),
    );
    this.query("#refresh-button").addEventListener("click", () => void this.refresh());
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
    this.root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.view as WorkspaceView;
        this.switchView(view);
      });
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closeRepositoryDialog();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void this.refresh();
      }
    });
  }

  private async openRepository(path: string): Promise<void> {
    const generation = ++this.requestGeneration;
    this.setLoading(true, "Opening repository…");
    try {
      const snapshot = await bridge.openRepository(path);
      if (generation !== this.requestGeneration) return;
      window.localStorage.setItem(RECENT_REPOSITORY_KEY, snapshot.root);
      this.state.snapshot = snapshot;
      this.state.selectedCommit = snapshot.commits[0]?.oid ?? null;
      this.state.selectedBranch =
        snapshot.branches.find((branch) => branch.current)?.fullName ??
        snapshot.branches[0]?.fullName ??
        null;
      this.chooseValidChangeSelection();
      this.state.error = null;
      this.closeRepositoryDialog();
      this.renderWorkspace();
      if (this.state.activeView === "changes") void this.loadSelectedDiff();
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.showError(error);
      if (!this.state.snapshot) this.openRepositoryDialog(path);
    } finally {
      if (generation === this.requestGeneration) this.setLoading(false, "Ready");
    }
  }

  private async refresh(): Promise<void> {
    const snapshot = this.state.snapshot;
    if (!snapshot || this.state.loading) return;
    await this.openRepository(snapshot.root);
  }

  private switchView(view: WorkspaceView): void {
    if (view === this.state.activeView) return;
    this.state.activeView = view;
    this.diffEditor.destroy();
    this.root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    this.renderWorkspace();
    if (view === "changes") void this.loadSelectedDiff();
  }

  private renderWorkspace(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    this.renderTopbar(snapshot);
    this.renderNavigator(snapshot);
    this.renderContent(snapshot);
    this.renderInspector(snapshot);
    this.renderStatus(snapshot);
  }

  private renderTopbar(snapshot: RepositorySnapshot): void {
    this.query("#repository-name").textContent = basename(snapshot.root);
    this.query("#repository-path").textContent = snapshot.root;
  }

  private renderNavigator(snapshot: RepositorySnapshot): void {
    const title = this.query("#navigator-title");
    const count = this.query("#navigator-count");
    const body = this.query("#navigator-body");

    if (this.state.activeView === "changes") {
      title.textContent = "Changes";
      count.textContent = snapshot.changes.length.toString();
      body.innerHTML = this.renderChangeNavigation(snapshot);
      this.bindChangeEvents();
      return;
    }

    if (this.state.activeView === "history") {
      title.textContent = "History";
      count.textContent = snapshot.commits.length.toString();
      body.innerHTML = this.renderHistoryNavigation(snapshot);
      this.bindHistoryEvents();
      return;
    }

    title.textContent = "Branches";
    count.textContent = snapshot.branches.length.toString();
    body.innerHTML = this.renderBranchNavigation(snapshot);
    this.bindBranchEvents();
  }

  private renderChangeNavigation(snapshot: RepositorySnapshot): string {
    const staged = snapshot.changes.filter(hasStagedChange);
    const unstaged = snapshot.changes.filter(hasWorktreeChange);
    if (staged.length === 0 && unstaged.length === 0) {
      return this.emptyState(
        "Working tree clean",
        "There are no local changes to review.",
        "check",
        true,
      );
    }
    return [
      this.renderChangeGroup("Staged", staged, true),
      this.renderChangeGroup("Unstaged", unstaged, false),
    ].join("");
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
    const selected =
      this.state.selectedChange?.path === change.path &&
      this.state.selectedChange.staged === staged;
    const actionLabel = staged ? "Unstage" : "Stage";
    return `
      <div class="change-row ${selected ? "selected" : ""}" role="button" tabindex="0" data-change-path="${escapeAttribute(change.path)}" data-staged="${staged}" aria-pressed="${selected}" aria-label="View ${staged ? "staged" : "working tree"} diff for ${escapeAttribute(change.path)}">
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
    return `<div class="history-list">${snapshot.commits
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
        this.state.selectedChange = { path, staged: row.dataset.staged === "true" };
        this.renderWorkspace();
        void this.loadSelectedDiff();
      });
      row.addEventListener("keydown", (event) => {
        if (event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        const path = row.dataset.changePath;
        if (!path) return;
        this.state.selectedChange = { path, staged: row.dataset.staged === "true" };
        this.renderWorkspace();
        void this.loadSelectedDiff();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-group-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const staged = button.dataset.groupAction === "stage";
        const snapshot = this.state.snapshot;
        if (!snapshot) return;
        const paths = snapshot.changes
          .filter(staged ? hasWorktreeChange : hasStagedChange)
          .map((change) => change.path);
        void this.mutatePaths(staged, paths);
      });
    });
  }

  private bindHistoryEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-commit]").forEach((row) => {
      row.addEventListener("click", () => {
        this.state.selectedCommit = row.dataset.commit ?? null;
        this.renderWorkspace();
      });
    });
  }

  private bindBranchEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-branch]").forEach((row) => {
      row.addEventListener("click", () => {
        this.state.selectedBranch = row.dataset.branch ?? null;
        this.renderWorkspace();
      });
    });
  }

  private renderContent(snapshot: RepositorySnapshot): void {
    this.diffEditor.destroy();
    const header = this.query("#content-header");
    const body = this.query("#content-body");

    if (this.state.activeView === "changes") {
      const selected = this.state.selectedChange;
      if (!selected) {
        header.innerHTML = this.contentHeading("Working tree", "No changes selected");
        body.innerHTML = this.emptyState(
          "Nothing to review",
          "Select a changed file to inspect its patch.",
          "changes",
        );
        return;
      }
      header.innerHTML = `
        ${this.contentHeading(basename(selected.path), selected.path)}
        <div class="header-actions"><span class="scope-pill">${selected.staged ? "Staged" : "Working tree"}</span></div>
      `;
      body.innerHTML = this.loadingBlock("Loading patch…");
      return;
    }

    if (this.state.activeView === "history") {
      const commit = selectedCommit(snapshot, this.state.selectedCommit);
      if (!commit) {
        header.innerHTML = this.contentHeading("History", "No commit selected");
        body.innerHTML = this.emptyState("No history", "Create a commit to start the history.", "history");
        return;
      }
      header.innerHTML = `
        ${this.contentHeading(commit.subject, commit.shortOid)}
        <div class="header-actions"><code class="oid">${escapeHtml(commit.shortOid)}</code></div>
      `;
      body.innerHTML = this.commitDetail(commit);
      return;
    }

    const branch = selectedBranch(snapshot, this.state.selectedBranch);
    if (!branch) {
      header.innerHTML = this.contentHeading("Branches", "No branch selected");
      body.innerHTML = this.emptyState("No branch", "Create a commit to establish a branch.", "branch");
      return;
    }
    header.innerHTML = `
      ${this.contentHeading(branch.name, branch.kind)}
      <div class="header-actions">${branch.current ? '<span class="scope-pill success">Checked out</span>' : ""}</div>
    `;
    body.innerHTML = this.branchDetail(branch);
  }

  private contentHeading(title: string, subtitle: string): string {
    return `<div class="content-title-group"><span class="content-kicker">${escapeHtml(subtitle)}</span><h2>${escapeHtml(title)}</h2></div>`;
  }

  private async loadSelectedDiff(): Promise<void> {
    const snapshot = this.state.snapshot;
    const selected = this.state.selectedChange;
    if (!snapshot || !selected || this.state.activeView !== "changes") return;
    const generation = ++this.diffGeneration;
    try {
      const diff = await bridge.readDiff(snapshot.root, selected.path, selected.staged);
      if (generation !== this.diffGeneration || this.state.activeView !== "changes") return;
      const body = this.query("#content-body");
      body.innerHTML = "";
      body.classList.add("diff-surface");
      this.diffEditor.mount(body, diff.patch || "No textual diff is available for this selection.");
      if (diff.truncated) this.setStatus("Patch truncated at 4 MiB", "warning");
    } catch (error) {
      if (generation !== this.diffGeneration) return;
      this.query("#content-body").innerHTML = this.emptyState(
        "Could not load patch",
        errorMessage(error),
        "changes",
      );
      this.showError(error);
    }
  }

  private renderInspector(snapshot: RepositorySnapshot): void {
    const inspector = this.query("#inspector");
    if (this.state.activeView === "changes") {
      const staged = snapshot.changes.filter(hasStagedChange);
      inspector.innerHTML = `
        <div class="inspector-header">
          <span class="panel-eyebrow">Create commit</span>
          <h2>${staged.length} staged ${staged.length === 1 ? "file" : "files"}</h2>
        </div>
        <div class="commit-summary">
          ${staged.length === 0 ? '<p class="muted-copy">Stage at least one file to create a commit.</p>' : `<ul>${staged.slice(0, 5).map((change) => `<li><span class="change-status status-${change.indexStatus}">${changeCode(change.indexStatus)}</span><span>${escapeHtml(change.path)}</span></li>`).join("")}</ul>${staged.length > 5 ? `<small>and ${staged.length - 5} more</small>` : ""}`}
        </div>
        <div class="commit-form">
          <label for="commit-message">Commit message</label>
          <textarea id="commit-message" rows="7" placeholder="Describe this change…" ${staged.length === 0 ? "disabled" : ""}>${escapeHtml(this.state.commitMessage)}</textarea>
          <div class="commit-hint"><span>Ctrl/Cmd + Enter</span><span>${this.state.commitMessage.trim().length}/72</span></div>
          <button class="primary-button commit-button" id="commit-button" type="button" ${staged.length === 0 || this.state.commitMessage.trim().length === 0 || this.state.loading ? "disabled" : ""}>
            ${icon("commit", 16)} Commit ${staged.length || ""}
          </button>
        </div>
        <div class="safety-note"><span>${icon("check", 15)}</span><p>Only staged changes are committed. Asterlyn refreshes repository truth after the operation.</p></div>
      `;
      const textarea = this.root.querySelector<HTMLTextAreaElement>("#commit-message");
      const button = this.root.querySelector<HTMLButtonElement>("#commit-button");
      textarea?.addEventListener("input", () => {
        this.state.commitMessage = textarea.value;
        if (button) button.disabled = textarea.value.trim().length === 0 || staged.length === 0;
        const counter = textarea.parentElement?.querySelector(".commit-hint span:last-child");
        if (counter) counter.textContent = `${textarea.value.trim().length}/72`;
      });
      textarea?.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          if (!button?.disabled) void this.commit();
        }
      });
      button?.addEventListener("click", () => void this.commit());
      return;
    }

    if (this.state.activeView === "history") {
      const commit = selectedCommit(snapshot, this.state.selectedCommit);
      inspector.innerHTML = commit ? this.commitInspector(commit) : this.inspectorPlaceholder();
      return;
    }

    const branch = selectedBranch(snapshot, this.state.selectedBranch);
    inspector.innerHTML = branch ? this.branchInspector(branch) : this.inspectorPlaceholder();
  }

  private async mutatePaths(stage: boolean, paths: string[]): Promise<void> {
    const snapshot = this.state.snapshot;
    if (!snapshot || paths.length === 0 || this.state.loading) return;
    this.setLoading(true, stage ? "Staging changes…" : "Unstaging changes…");
    try {
      const next = stage
        ? await bridge.stagePaths(snapshot.root, paths)
        : await bridge.unstagePaths(snapshot.root, paths);
      this.state.snapshot = next;
      this.chooseValidChangeSelection();
      this.renderWorkspace();
      void this.loadSelectedDiff();
    } catch (error) {
      this.showError(error);
    } finally {
      this.setLoading(false, "Ready");
    }
  }

  private async commit(): Promise<void> {
    const snapshot = this.state.snapshot;
    const message = this.state.commitMessage.trim();
    if (!snapshot || !message || this.state.loading) return;
    this.setLoading(true, "Creating commit…");
    try {
      const next = await bridge.commitChanges(snapshot.root, message);
      this.state.snapshot = next;
      this.state.commitMessage = "";
      this.state.selectedCommit = next.commits[0]?.oid ?? null;
      this.chooseValidChangeSelection();
      this.renderWorkspace();
      void this.loadSelectedDiff();
      this.setStatus("Commit created", "success");
    } catch (error) {
      this.showError(error);
    } finally {
      this.setLoading(false, "Ready");
    }
  }

  private chooseValidChangeSelection(): void {
    const changes = this.state.snapshot?.changes ?? [];
    const current = this.state.selectedChange;
    const valid = current
      ? changes.some(
          (change) =>
            change.path === current.path &&
            (current.staged ? hasStagedChange(change) : hasWorktreeChange(change)),
        )
      : false;
    if (valid) return;

    const staged = changes.find(hasStagedChange);
    const unstaged = changes.find(hasWorktreeChange);
    this.state.selectedChange = staged
      ? { path: staged.path, staged: true }
      : unstaged
        ? { path: unstaged.path, staged: false }
        : null;
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

  private commitDetail(commit: CommitSummary): string {
    return `
      <article class="detail-canvas">
        <div class="commit-avatar">${escapeHtml(initials(commit.authorName))}</div>
        <div class="detail-lead">
          <span>${escapeHtml(commit.authorName)} &lt;${escapeHtml(commit.authorEmail)}&gt;</span>
          <time>${formatAbsolute(commit.authoredAt)}</time>
        </div>
        <h3>${escapeHtml(commit.subject)}</h3>
        <div class="detail-grid">
          <div><span>Commit</span><code>${escapeHtml(commit.oid)}</code></div>
          <div><span>Parents</span><code>${commit.parents.length ? commit.parents.map((parent) => escapeHtml(parent.slice(0, 10))).join(", ") : "Root commit"}</code></div>
        </div>
        ${commit.decorations.length ? `<div class="decoration-list">${commit.decorations.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
        <div class="detail-placeholder"><span>${icon("changes", 22)}</span><div><strong>Commit file details</strong><p>Per-commit changed files and patch inspection are scheduled for the next M1 slice.</p></div></div>
      </article>`;
  }

  private branchDetail(branch: BranchSummary): string {
    return `
      <article class="detail-canvas">
        <div class="branch-hero">${icon("branch", 26)}</div>
        <div class="detail-lead"><span>${escapeHtml(branch.kind)} branch</span><time>${formatAbsolute(branch.committedAt)}</time></div>
        <h3>${escapeHtml(branch.name)}</h3>
        <div class="detail-grid">
          <div><span>Tip</span><code>${escapeHtml(branch.oid)}</code></div>
          <div><span>Upstream</span><code>${escapeHtml(branch.upstream ?? "Not configured")}</code></div>
          <div><span>Tracking</span><code>${escapeHtml(branch.tracking ?? "Up to date or unavailable")}</code></div>
        </div>
        <div class="detail-placeholder"><span>${icon("history", 22)}</span><div><strong>Latest commit</strong><p>${escapeHtml(branch.subject)}</p></div></div>
      </article>`;
  }

  private commitInspector(commit: CommitSummary): string {
    return `
      <div class="inspector-header"><span class="panel-eyebrow">Commit</span><h2>${escapeHtml(commit.shortOid)}</h2></div>
      <dl class="metadata-list">
        <div><dt>Author</dt><dd>${escapeHtml(commit.authorName)}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(commit.authorEmail)}</dd></div>
        <div><dt>Date</dt><dd>${formatAbsolute(commit.authoredAt)}</dd></div>
        <div><dt>Parents</dt><dd>${commit.parents.length || "None"}</dd></div>
      </dl>
      <div class="message-card"><span>Message</span><p>${escapeHtml(commit.subject)}</p></div>`;
  }

  private branchInspector(branch: BranchSummary): string {
    return `
      <div class="inspector-header"><span class="panel-eyebrow">${escapeHtml(branch.kind)}</span><h2>${escapeHtml(branch.name)}</h2></div>
      <dl class="metadata-list">
        <div><dt>State</dt><dd>${branch.current ? "Checked out" : "Available"}</dd></div>
        <div><dt>Upstream</dt><dd>${escapeHtml(branch.upstream ?? "None")}</dd></div>
        <div><dt>Tracking</dt><dd>${escapeHtml(branch.tracking ?? "No divergence")}</dd></div>
        <div><dt>Updated</dt><dd>${formatRelative(branch.committedAt)}</dd></div>
      </dl>
      <div class="safety-note"><span>${icon("branch", 15)}</span><p>Checkout and branch mutation arrive in Stage 2 after recovery and conflict flows are in place.</p></div>`;
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
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
