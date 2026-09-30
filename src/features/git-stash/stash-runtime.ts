import { editorDocumentKey, type EditorDocument } from "../../editor-document.ts";
import type { StashCommandAction } from "../../application/commands/stash-command-ids.ts";
import { icon } from "../../icons.ts";
import type { CommonCopy } from "../../localization/catalog.ts";
import type { Localization } from "../../localization/localization.ts";
import type { StashCopy } from "../../localization/stash-copy.ts";
import type { RepositoryMutationOutcome, StashEntry, StashMutationKind, StashMutationRequest } from "../../models.ts";
import { buildCommitFileTree } from "../../presentation/git-presentation.ts";
import type { ApplicationDialogRuntime } from "../../shared/application-dialog-runtime.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import { StashContextActions } from "./stash-context-actions.ts";
import { StashController, type StashGateway, stashDomKey, stashKey } from "./stash-controller.ts";
import { renderStashDetails, renderStashList, stashFileDirectoryPaths } from "./stash-view.ts";

export interface StashRuntimeGateway extends StashGateway {
  executeStashMutation(root: string, request: StashMutationRequest): Promise<RepositoryMutationOutcome>;
}

export interface StashRuntimePorts {
  copy(): StashCopy;
  common(): CommonCopy;
  localization(): Localization;
  workspaceRoot(): string | null;
  visible(): boolean;
  busy(): boolean;
  clean(): boolean;
  confirm: ApplicationDialogRuntime["confirm"];
  runMutation(
    request: StashMutationRequest,
    metadataOnly: boolean,
    progress: string,
    completed: string,
  ): Promise<boolean>;
  openDiff(document: Extract<EditorDocument, { kind: "commit-diff" }>): void;
  closeDiff(document: Extract<EditorDocument, { kind: "commit-diff" }>): void;
  activeDocument(): EditorDocument;
  renderEditor(): void;
  presentationChanged(): void;
  status(message: string, kind: "success" | "warning"): void;
  error(error: unknown): void;
}

export class StashRuntime {
  readonly controller: StashController;
  private readonly context: StashContextActions;
  private readonly root: HTMLElement;
  private readonly ports: StashRuntimePorts;
  private readonly pinned = new Map<string, Extract<EditorDocument, { kind: "commit-diff" }>>();
  private readonly releaseController: () => void;

  constructor(
    root: HTMLElement,
    contextMenu: ContextMenuPort,
    gateway: StashRuntimeGateway,
    ports: StashRuntimePorts,
  ) {
    this.root = root;
    this.ports = ports;
    this.controller = new StashController(gateway);
    this.releaseController = this.controller.subscribe(() => {
      if (ports.visible() && root.querySelector("#stash-tool-grid")) this.render();
      if (this.isDiff(ports.activeDocument())) ports.renderEditor();
      contextMenu.revalidate();
    });
    this.context = new StashContextActions(root, contextMenu, {
      state: () => this.controller.state,
      copy: ports.copy,
      busy: ports.busy,
      clean: ports.clean,
      current: (entry) => this.controller.isCurrent(entry),
      select: (entry) => this.controller.select(entry),
      action: (action, entry) => this.handleAction(action, entry),
      blocked: (reason) => ports.status(reason, "warning"),
      error: ports.error,
    });
  }

  clear(): void { this.pinned.clear(); this.controller.clear(); }

  async load(root: string, preserveSelection: boolean): Promise<void> {
    await this.controller.load(root, preserveSelection);
    if (this.prunePinned()) this.ports.renderEditor();
  }

  activate(root: string): void {
    this.render();
    if (this.controller.state.root !== root) void this.load(root, false);
  }

  isDiff(document: EditorDocument): boolean {
    if (document.kind !== "commit-diff") return false;
    const entry = this.controller.selectedEntry();
    return Boolean(entry && this.controller.state.root === document.repositoryRoot &&
      entry.repositoryId === document.repositoryId && entry.oid === document.oid);
  }

  files() { return this.controller.state.details?.files ?? []; }

  pinnedDocuments(): readonly Extract<EditorDocument, { kind: "commit-diff" }>[] {
    return [...this.pinned.values()];
  }

  async activatePinned(document: Extract<EditorDocument, { kind: "commit-diff" }>): Promise<boolean> {
    const pinned = this.pinned.get(editorDocumentKey(document));
    if (!pinned) return false;
    document = pinned;
    const entry = this.controller.state.entries.find((candidate) =>
      candidate.repositoryId === document.repositoryId && candidate.oid === document.oid
    );
    if (!entry) return false;
    const details = await this.controller.ensureSelectedDetails(entry);
    if (!details?.files.some((file) => file.path === document.path) || !this.controller.selectFile(document.path)) return false;
    this.ports.openDiff(document);
    return true;
  }

  unpin(document: Extract<EditorDocument, { kind: "commit-diff" }>): boolean {
    return this.pinned.delete(editorDocumentKey(document));
  }

  loadDiff(document: Extract<EditorDocument, { kind: "commit-diff" }>, expanded: boolean): Promise<unknown> {
    return this.isDiff(document) ? this.controller.loadSelectedDiff(expanded) : Promise.resolve(null);
  }

  selectAdjacent(path: string): boolean {
    if (!this.controller.selectFile(path)) return false;
    this.openSelectedFile(false);
    return true;
  }

  render(): void {
    if (!this.ports.visible()) return;
    const copy = this.ports.copy();
    const listScroll = this.root.querySelector<HTMLElement>(".stash-list");
    const fileScroll = this.root.querySelector<HTMLElement>("#stash-file-list");
    const listPosition = { top: listScroll?.scrollTop ?? 0, left: listScroll?.scrollLeft ?? 0 };
    const filePosition = { top: fileScroll?.scrollTop ?? 0, left: fileScroll?.scrollLeft ?? 0 };
    const localization = this.ports.localization();
    this.query("#stash-list-body").innerHTML = renderStashList(this.controller.state, copy, localization.catalog.locale);
    this.query("#stash-detail-body").innerHTML = renderStashDetails(this.controller.state, copy, localization);
    this.root.querySelectorAll<HTMLButtonElement>("[data-stash-key]").forEach((row) => {
      row.onclick = () => { const entry = this.entry(row.dataset.stashKey); if (entry) this.controller.select(entry); };
      row.ondblclick = () => { const entry = this.entry(row.dataset.stashKey); if (entry) void this.openDiff(entry, false); };
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-stash-file]").forEach((row) => {
      row.onclick = () => { if (row.dataset.stashFile) this.openFile(row.dataset.stashFile, false); };
      row.ondblclick = () => { if (row.dataset.stashFile) this.openFile(row.dataset.stashFile, true); };
    });
    this.root.querySelectorAll<HTMLDetailsElement>("[data-stash-file-directory]").forEach((directory) => {
      directory.ontoggle = () => {
        const path = directory.dataset.stashFileDirectory;
        const renderedExpanded = directory.dataset.stashFileRenderedExpanded === "true";
        if (path && directory.open !== renderedExpanded) this.controller.setDirectoryExpanded(path, directory.open);
      };
    });
    this.root.querySelector<HTMLButtonElement>("#stash-file-view-toggle")?.addEventListener("click", () => {
      this.controller.toggleFileView();
      this.refocus("#stash-file-view-toggle");
    }, { once: true });
    this.root.querySelector<HTMLButtonElement>("#stash-file-expand-all")?.addEventListener("click", () => {
      this.controller.expandDirectories();
      this.refocus("#stash-file-expand-all");
    }, { once: true });
    this.root.querySelector<HTMLButtonElement>("#stash-file-collapse-all")?.addEventListener("click", () => {
      const files = this.controller.state.details?.files ?? [];
      this.controller.collapseDirectories([".", ...stashFileDirectoryPaths(buildCommitFileTree(files))]);
      this.refocus("#stash-file-collapse-all");
    }, { once: true });
    this.root.querySelector<HTMLButtonElement>("#retry-stash-catalog")?.addEventListener("click", () => this.refresh(true), { once: true });
    this.root.querySelector<HTMLButtonElement>("#retry-stash-details")?.addEventListener("click", () => {
      const entry = this.controller.selectedEntry();
      if (entry) void this.controller.ensureSelectedDetails(entry);
    }, { once: true });
    this.root.querySelectorAll<HTMLButtonElement>("[data-stash-action]").forEach((button) => {
      button.onclick = () => {
        const entry = this.controller.selectedEntry();
        const action = button.dataset.stashAction;
        if (entry && (action === "apply" || action === "pop")) void this.handleAction(action, entry);
      };
    });
    const nextList = this.root.querySelector<HTMLElement>(".stash-list");
    const nextFiles = this.root.querySelector<HTMLElement>("#stash-file-list");
    if (nextList) { nextList.scrollTop = listPosition.top; nextList.scrollLeft = listPosition.left; }
    if (nextFiles) { nextFiles.scrollTop = filePosition.top; nextFiles.scrollLeft = filePosition.left; }
    this.ports.presentationChanged();
  }

  commandAvailability(action: StashCommandAction): { enabled: boolean; reason?: string } {
    const copy = this.ports.copy();
    if (!this.ports.visible() || !this.ports.workspaceRoot()) {
      return { enabled: false, reason: copy.selectStash };
    }
    if (this.ports.busy() || this.controller.state.loading || this.controller.state.detailsLoading) {
      return { enabled: false, reason: copy.loading };
    }
    if (action === "refresh") return { enabled: true };
    const entry = this.controller.selectedEntry();
    if (!entry) return { enabled: false, reason: copy.selectStash };
    if (action === "apply" || action === "pop" || action === "unstash") {
      return this.ports.clean()
        ? { enabled: true }
        : { enabled: false, reason: copy.cleanRequired };
    }
    if (action === "drop") return { enabled: true };
    if (action === "clear") return this.controller.state.truncatedRepositoryIds.includes(entry.repositoryId)
      ? { enabled: false, reason: copy.truncated }
      : { enabled: true };
    const files = this.controller.state.details?.files ?? [];
    if (action === "toggle-view") return { enabled: true };
    if (action === "open-diff" || action === "open-diff-new-tab") {
      return this.controller.selectedFile()
        ? { enabled: true }
        : { enabled: false, reason: copy.noFiles };
    }
    return this.controller.state.fileView === "tree" && files.length > 0
      ? { enabled: true }
      : { enabled: false, reason: copy.noFiles };
  }

  async executeCommand(action: StashCommandAction): Promise<void> {
    const availability = this.commandAvailability(action);
    if (!availability.enabled) {
      if (availability.reason) this.ports.status(availability.reason, "warning");
      return;
    }
    if (action === "refresh") { this.refresh(true); return; }
    if (action === "toggle-view") { this.controller.toggleFileView(); return; }
    if (action === "expand-all") { this.controller.expandDirectories(); return; }
    if (action === "collapse-all") {
      const files = this.controller.state.details?.files ?? [];
      this.controller.collapseDirectories([".", ...stashFileDirectoryPaths(buildCommitFileTree(files))]);
      return;
    }
    if (action === "open-diff" || action === "open-diff-new-tab") {
      this.openSelectedFile(action === "open-diff-new-tab");
      return;
    }
    const entry = this.controller.selectedEntry();
    if (entry) await this.handleAction(action, entry);
  }

  dispose(): void { this.releaseController(); this.context.dispose(); }

  private refresh(preserve: boolean): void {
    const root = this.ports.workspaceRoot();
    if (root) void this.load(root, preserve);
  }

  private entry(key?: string): StashEntry | null {
    return this.controller.state.entries.find((candidate) => stashDomKey(candidate) === key) ?? null;
  }

  private refocus(selector: string): void {
    queueMicrotask(() => this.root.querySelector<HTMLButtonElement>(selector)?.focus());
  }

  private async handleAction(
    action: "apply" | "pop" | "unstash" | "drop" | "clear" | "show-diff" | "show-diff-new-tab",
    entry: StashEntry,
  ): Promise<void> {
    if (!this.controller.isCurrent(entry)) {
      this.refresh(true);
      this.ports.status(this.ports.copy().changedRefresh, "warning");
      return;
    }
    if (action === "show-diff" || action === "show-diff-new-tab") {
      await this.openDiff(entry, action === "show-diff-new-tab");
      return;
    }
    if (action === "unstash") { this.openDialog(entry); return; }
    const copy = this.ports.copy();
    if (action === "drop" && !(await this.ports.confirm({
      title: copy.dropTitle, message: copy.dropMessage(entry.reference), confirmLabel: copy.drop,
      cancelLabel: this.ports.common().cancel, destructive: true,
    }))) return;
    if (action === "clear" && !(await this.ports.confirm({
      title: copy.clearTitle, message: copy.clearMessage, confirmLabel: copy.clear,
      cancelLabel: this.ports.common().cancel, destructive: true,
    }))) return;
    await this.execute(action, entry, false, null);
  }

  private async execute(kind: StashMutationKind, entry: StashEntry, reinstateIndex: boolean, branchName: string | null): Promise<void> {
    const root = this.ports.workspaceRoot();
    if (!root || !this.controller.isCurrent(entry)) return;
    const request: StashMutationRequest = {
      kind, repositoryId: entry.repositoryId,
      reference: kind === "clear" ? null : entry.reference,
      oid: kind === "clear" ? null : entry.oid,
      reinstateIndex, branchName,
      expectedOids: kind === "clear"
        ? this.controller.state.entries.filter((candidate) => candidate.repositoryId === entry.repositoryId).map((candidate) => candidate.oid)
        : [],
    };
    const copy = this.ports.copy();
    const metadataOnly = kind === "drop" || kind === "clear";
    const succeeded = await this.ports.runMutation(request, metadataOnly, copy.mutationAction, copy.operationComplete(kind));
    if (this.ports.workspaceRoot() === root) {
      await this.load(root, succeeded);
      if (!succeeded) this.ports.status(copy.changedRefresh, "warning");
    }
  }

  private async openDiff(entry: StashEntry, newTab: boolean): Promise<void> {
    const details = await this.controller.ensureSelectedDetails(entry);
    const file = details?.files.find((candidate) => candidate.path === this.controller.state.selectedFile) ?? details?.files[0];
    if (file) this.openFile(file.path, newTab);
  }

  private openFile(path: string, newTab: boolean): void {
    if (!this.controller.selectFile(path)) return;
    this.openSelectedFile(newTab);
  }

  private openSelectedFile(newTab: boolean): void {
    const root = this.controller.state.root;
    const entry = this.controller.selectedEntry();
    const file = this.controller.selectedFile();
    if (!root || !entry || !file) return;
    const document = { kind: "commit-diff", repositoryRoot: root, repositoryId: entry.repositoryId, oid: entry.oid, path: file.path } as const;
    if (newTab) this.pinned.set(editorDocumentKey(document), document);
    this.ports.openDiff(document);
  }

  private prunePinned(): boolean {
    const before = this.pinned.size;
    const valid = new Set(this.controller.state.entries.map((entry) => stashKey(entry)));
    for (const [key, document] of this.pinned) {
      if (document.repositoryRoot !== this.controller.state.root || !valid.has(stashKey(document))) {
        this.pinned.delete(key);
        this.ports.closeDiff(document);
      }
    }
    return before !== this.pinned.size;
  }

  private openDialog(entry: StashEntry): void {
    if (!this.controller.isCurrent(entry)) return;
    const copy = this.ports.copy();
    const common = this.ports.common();
    const host = this.query("#stash-unstash-dialog");
    host.innerHTML = `<section class="dialog stash-unstash-dialog" role="dialog" aria-modal="true" aria-labelledby="stash-unstash-title"><div class="dialog-heading"><h2 id="stash-unstash-title">${escape(copy.unstashTitle)}</h2><button class="icon-button" data-stash-dialog-close type="button" aria-label="${escape(common.close)}">${icon("close", 17)}</button></div><div class="stash-unstash-options"><label><input type="radio" name="stash-mode" value="apply" checked />${escape(copy.applyMode)}</label><label><input type="radio" name="stash-mode" value="pop" />${escape(copy.popMode)}</label><label><input id="stash-reinstate-index" type="checkbox" />${escape(copy.reinstateIndex)}</label><label class="stash-branch-option"><input id="stash-new-branch" type="checkbox" />${escape(copy.newBranch)}<input id="stash-branch-name" type="text" spellcheck="false" autocomplete="off" placeholder="${escape(copy.newBranchPlaceholder)}" disabled /></label></div><div class="dialog-actions"><button class="secondary-button" data-stash-dialog-close type="button">${escape(common.cancel)}</button><button class="primary-button" id="stash-unstash-confirm" type="button">${escape(copy.execute)}</button></div></section>`;
    const close = () => { host.classList.add("hidden"); host.innerHTML = ""; host.onclick = null; host.onkeydown = null; };
    host.querySelectorAll<HTMLButtonElement>("[data-stash-dialog-close]").forEach((button) => button.onclick = close);
    host.onclick = (event) => { if (event.target === host) close(); };
    host.onkeydown = (event) => { if (event.key === "Escape") close(); };
    const branchToggle = host.querySelector<HTMLInputElement>("#stash-new-branch")!;
    const branchInput = host.querySelector<HTMLInputElement>("#stash-branch-name")!;
    const reinstate = host.querySelector<HTMLInputElement>("#stash-reinstate-index")!;
    branchToggle.onchange = () => { branchInput.disabled = !branchToggle.checked; reinstate.disabled = branchToggle.checked; if (branchToggle.checked) branchInput.focus(); };
    host.querySelector<HTMLButtonElement>("#stash-unstash-confirm")!.onclick = () => {
      const branchName = branchToggle.checked ? branchInput.value.trim() : null;
      if (branchToggle.checked && !branchName) { branchInput.focus(); return; }
      const mode = host.querySelector<HTMLInputElement>('input[name="stash-mode"]:checked')?.value === "pop" ? "pop" : "apply";
      close();
      void this.execute(branchName ? "branch" : mode, entry, !branchName && reinstate.checked, branchName);
    };
    host.classList.remove("hidden");
    queueMicrotask(() => host.querySelector<HTMLInputElement>('input[name="stash-mode"]')?.focus());
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Stash element: ${selector}`);
    return element;
  }
}

function escape(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
