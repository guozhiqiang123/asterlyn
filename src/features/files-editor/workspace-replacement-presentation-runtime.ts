import type { DiffPresentation } from "../../diff-presentation.ts";
import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import type { EditorCopy, ReplacementCopy } from "../../localization/catalog.ts";
import type { WorkspaceReplacementFilePreview } from "../../models.ts";
import type { AppPreferences } from "../../preferences.ts";
import type { EffectiveTheme } from "../../presentation/presentation-environment.ts";
import { sortFilesByName } from "../../presentation/file-name-order.ts";
import { buildProjectTree, descendantProjectDirectories, type ProjectTreeNode } from "../../presentation/project-tree.ts";
import { LazyEditableDiffEditor } from "./lazy-merge-editor-runtime.ts";
import { projectTreeRows } from "./project-files-view.ts";
import { renderWorkspaceReplacementDialog } from "./workspace-navigation-view.ts";
import type { WorkspaceReplacementController, WorkspaceReplacementFileSession, WorkspaceReplacementRecoveryAction } from "./workspace-replacement-controller.ts";
import { buildWorkspaceReplacementActionDocument, replacementActionForChunk } from "./workspace-replacement-diff-session.ts";

export interface WorkspaceReplacementPresentationOptions {
  readonly controller: WorkspaceReplacementController;
  readonly copy: () => ReplacementCopy;
  readonly editorCopy: () => EditorCopy;
  readonly blockedOpenPaths: () => ReadonlySet<string>;
  readonly commandSurfaceOpen: () => boolean;
  readonly close: () => void;
  readonly cancel: () => void;
  readonly apply: () => void;
  readonly updatePreview: () => void;
  readonly openWindow: () => void;
  readonly resolveRecovery: (id: string, action: WorkspaceReplacementRecoveryAction) => void;
  readonly review: () => void;
  readonly search: () => void;
  readonly fileSaved: (workspacePath: string) => Promise<void>;
  readonly preferences: () => AppPreferences;
  readonly presentation: () => DiffPresentation;
  readonly setDiffLayout: (layout: "unified" | "split") => void;
  readonly setWhitespace: (visible: boolean) => void;
  readonly describeError: (error: unknown) => string;
}

export class WorkspaceReplacementPresentationRuntime {
  private readonly editor: LazyEditableDiffEditor;
  private commandSurfaceSuppressed = false;
  private selectedPath: string | null = null;
  private selectedPlanId: string | null = null;
  private expandedUnchanged = false;
  private loadGeneration = 0;
  private fileView: "tree" | "flat" = "tree";
  private expandedDirectories = new Set<string>();
  private autoSaveAction = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: WorkspaceReplacementPresentationOptions,
  ) {
    this.editor = new LazyEditableDiffEditor(options.editorCopy());
  }

  renderDialog(): void {
    const host = this.query("#workspace-replacement-dialog");
    const state = this.options.controller.state;
    const open = state.dialog !== null;
    const restoreFocus = open && (host.classList.contains("hidden") || host.contains(host.ownerDocument.activeElement));
    this.syncModalStack(open);
    host.classList.toggle("hidden", !open);
    host.innerHTML = renderWorkspaceReplacementDialog({
      dialog: state.dialog,
      replacement: state.replacement,
      replacementText: state.text,
      recoveryBusy: state.recoveryBusy,
      blockedOpenPaths: new Set([
        ...this.options.blockedOpenPaths(),
        ...this.options.controller.changedSessionPaths(),
      ]),
      copy: this.options.copy(),
    });
    if (!open) return;
    this.syncSelection();
    this.bindDialog();
    if (restoreFocus) queueMicrotask(() => {
      host.querySelector<HTMLElement>("#replacement-dialog-text:not(:disabled), [data-replacement-close], #replacement-cancel-operation")?.focus();
    });
  }

  renderTool(): void {
    const host = this.query("#replacement-tool-host");
    const state = this.options.controller.state.replacement;
    const copy = this.options.copy();
    if (state.status !== "ready" || !state.preview || !state.request) {
      this.selectedPath = null;
      this.selectedPlanId = null;
      this.editor.destroy();
      const loading = state.status === "previewing";
      const message = loading ? copy.preparingPreview : state.error ?? copy.noReplacementPreview;
      host.innerHTML = `<div class="replacement-tool-empty">${loading ? '<span class="spinner"></span>' : icon("search", 24)}<strong>${escapeHtml(message)}</strong>${loading ? "" : `<button class="primary-button" data-replacement-search type="button">${escapeHtml(copy.search)}</button>`}</div>`;
      host.querySelector<HTMLButtonElement>("[data-replacement-search]")?.addEventListener("click", this.options.search);
      return;
    }
    if (this.selectedPlanId !== state.preview.planId) {
      this.selectedPlanId = state.preview.planId;
      this.selectedPath = state.preview.files[0]?.workspacePath ?? null;
      this.expandedUnchanged = false;
      this.expandedDirectories = new Set(allDirectoryPaths(replacementTree(state.preview.files)));
    } else if (!state.preview.files.some((file) => file.workspacePath === this.selectedPath)) {
      this.selectedPath = state.preview.files[0]?.workspacePath ?? null;
    }
    const editor = this.options.editorCopy();
    const presentation = this.options.presentation();
    const replacementText = this.options.controller.state.text;
    const draftChanged = replacementText !== state.request.replacement;
    const files = this.renderFiles(state.preview.files);
    host.innerHTML = `<div class="replacement-tool-layout">
      <aside class="replacement-tool-files"><div class="replacement-tool-summary" role="group" aria-label="${escapeAttribute(copy.replacementMapping)}"><span>${escapeHtml(copy.replaceLabel)}</span><code title="${escapeAttribute(state.request.query)}">${escapeHtml(state.request.query)}</code><label for="replacement-tool-text">${escapeHtml(copy.withLabel)}</label><input id="replacement-tool-text" type="text" value="${escapeAttribute(replacementText)}" /><button class="secondary-button" id="replacement-tool-update" type="button" ${draftChanged ? "" : "disabled"}>${escapeHtml(copy.updatePreview)}</button><small class="replacement-tool-draft ${draftChanged ? "" : "hidden"}">${escapeHtml(copy.previewChanged)}</small></div><div class="replacement-tool-file-toolbar"><button class="compact-icon-button ${this.fileView === "tree" ? "active" : ""}" data-replacement-file-view type="button" aria-pressed="${this.fileView === "tree"}" title="${escapeAttribute(this.fileView === "tree" ? copy.flatView : copy.treeView)}">${icon("eye", 14)}</button><button class="compact-icon-button" data-replacement-expand type="button" title="${escapeAttribute(copy.expandAll)}" ${this.fileView === "tree" ? "" : "disabled"}>${icon("expand", 14)}</button><button class="compact-icon-button" data-replacement-collapse type="button" title="${escapeAttribute(copy.collapseAll)}" ${this.fileView === "tree" ? "" : "disabled"}>${icon("collapse", 14)}</button></div><div class="replacement-tool-file-list ${this.fileView}" role="${this.fileView === "tree" ? "tree" : "listbox"}">${files}</div></aside>
      <section class="replacement-tool-comparison"><div class="replacement-tool-toolbar"><strong id="replacement-tool-path">${escapeHtml(this.selectedPath ?? "")}</strong><div class="replacement-tool-actions"><span class="replacement-tool-save-state" id="replacement-tool-save-state"></span><button class="secondary-button replacement-tool-save" id="replacement-tool-save" type="button" disabled>${escapeHtml(copy.saveFile)}</button><button class="compact-icon-button" data-replacement-tool-change="previous" type="button" aria-label="${escapeAttribute(editor.previousChange)}" title="${escapeAttribute(editor.previousChange)}">${icon("up", 15)}</button><button class="compact-icon-button" data-replacement-tool-change="next" type="button" aria-label="${escapeAttribute(editor.nextChange)}" title="${escapeAttribute(editor.nextChange)}">${icon("down", 15)}</button><span class="diff-control-separator" aria-hidden="true"></span><button class="compact-icon-button ${this.expandedUnchanged ? "active" : ""}" data-replacement-tool-unchanged type="button" aria-pressed="${this.expandedUnchanged}"></button><div class="diff-controls" role="group" aria-label="${escapeAttribute(editor.diffPresentation)}"><button type="button" data-replacement-tool-layout="unified" aria-pressed="${presentation.layout === "unified"}" title="${escapeAttribute(editor.unifiedTitle)}">${escapeHtml(editor.unified)}</button><button type="button" data-replacement-tool-layout="split" aria-pressed="${presentation.layout === "split"}" title="${escapeAttribute(editor.sideBySideTitle)}">${escapeHtml(editor.sideBySide)}</button><button type="button" data-replacement-tool-whitespace aria-pressed="${presentation.showWhitespace}" title="${escapeAttribute(editor.whitespaceTitle)}">${escapeHtml(editor.whitespace)}</button></div><button class="secondary-button replacement-tool-review" id="replacement-tool-review" type="button" ${draftChanged ? "disabled" : ""}>${escapeHtml(copy.reviewAndApply)}</button></div></div><div class="replacement-tool-diff diff-surface editable-diff-surface" id="replacement-tool-diff"></div></section>
    </div>`;
    this.syncUnchangedButton();
    this.bindTool();
    void this.loadSelectedSession();
  }

  setTheme(theme: EffectiveTheme): void { this.editor.setTheme(theme); }
  setPreferences(preferences: AppPreferences): void { this.editor.setPreferences(preferences); }
  setPresentation(presentation: DiffPresentation): void {
    this.editor.setPresentation(presentation);
    this.root.querySelectorAll<HTMLButtonElement>("[data-replacement-tool-layout]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.replacementToolLayout === presentation.layout));
    });
    this.root.querySelector<HTMLButtonElement>("[data-replacement-tool-whitespace]")
      ?.setAttribute("aria-pressed", String(presentation.showWhitespace));
  }
  setPhrases(phrases: Readonly<Record<string, string>>): void { this.editor.setPhrases(phrases); }
  setEditorCopy(copy: EditorCopy): void { this.editor.setCopy(copy); }
  requestMeasure(): void { this.editor.requestMeasure(); }

  dispose(): void {
    this.loadGeneration += 1;
    this.editor.destroy();
    this.syncModalStack(false);
  }

  private bindDialog(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-replacement-close]").forEach((button) => {
      button.addEventListener("click", this.options.close);
    });
    this.root.querySelector<HTMLButtonElement>("#replacement-cancel-operation")
      ?.addEventListener("click", this.options.cancel);
    this.root.querySelector<HTMLInputElement>("#replacement-select-all")
      ?.addEventListener("change", (event) => {
        this.options.controller.selectAll((event.currentTarget as HTMLInputElement).checked);
        this.syncSelection();
      });
    this.root.querySelectorAll<HTMLInputElement>("[data-replacement-file]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const path = checkbox.dataset.replacementFile;
        if (!path) return;
        this.options.controller.toggleFile(path);
        this.syncSelection();
      });
    });
    const text = this.root.querySelector<HTMLInputElement>("#replacement-dialog-text");
    text?.addEventListener("input", () => {
      this.options.controller.setText(text.value);
      this.syncDraft();
    });
    text?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && this.previewChanged()) this.options.updatePreview();
    });
    this.root.querySelector<HTMLButtonElement>("#replacement-update-preview")
      ?.addEventListener("click", this.options.updatePreview);
    this.root.querySelector<HTMLButtonElement>("#replacement-open-window")
      ?.addEventListener("click", this.options.openWindow);
    this.root.querySelector<HTMLButtonElement>("#replacement-apply")
      ?.addEventListener("click", this.options.apply);
    this.root.querySelectorAll<HTMLButtonElement>("[data-recovery-rollback]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.recoveryRollback;
        if (id) this.options.resolveRecovery(id, "rollback");
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-recovery-keep]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.recoveryKeep;
        if (id) this.options.resolveRecovery(id, "keep");
      });
    });
  }

  private syncSelection(): void {
    const state = this.options.controller.state.replacement;
    const preview = state.preview;
    if (!preview) return;
    for (const checkbox of this.root.querySelectorAll<HTMLInputElement>("[data-replacement-file]")) {
      const selected = state.selectedPaths.has(checkbox.dataset.replacementFile ?? "");
      checkbox.checked = selected;
      checkbox.closest("[data-replacement-card]")?.classList.toggle("selected", selected);
    }
    const selectAll = this.root.querySelector<HTMLInputElement>("#replacement-select-all");
    if (selectAll) {
      selectAll.checked = state.selectedPaths.size === preview.files.length;
      selectAll.indeterminate = state.selectedPaths.size > 0 && state.selectedPaths.size < preview.files.length;
    }
    const selectedFiles = preview.files.filter((file) => state.selectedPaths.has(file.workspacePath));
    const matches = selectedFiles.reduce((total, file) => total + file.matchCount, 0);
    const apply = this.root.querySelector<HTMLButtonElement>("#replacement-apply");
    if (apply) {
      apply.textContent = this.options.copy().applySelection(matches, selectedFiles.length);
      apply.disabled = selectedFiles.length === 0 || this.previewChanged();
    }
  }

  private syncDraft(): void {
    const changed = this.previewChanged();
    const warning = this.root.querySelector<HTMLElement>(".replacement-draft-warning");
    warning?.classList.toggle("hidden", !changed);
    const update = this.root.querySelector<HTMLButtonElement>("#replacement-update-preview");
    if (update) update.disabled = !changed;
    const open = this.root.querySelector<HTMLButtonElement>("#replacement-open-window");
    if (open) open.disabled = changed;
    this.syncSelection();
  }

  private previewChanged(): boolean {
    const state = this.options.controller.state;
    return state.text !== state.replacement.request?.replacement;
  }

  private bindTool(): void {
    const text = this.root.querySelector<HTMLInputElement>("#replacement-tool-text");
    text?.addEventListener("input", () => {
      this.options.controller.setText(text.value);
      this.syncToolDraft();
    });
    text?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && this.previewChanged()) this.options.updatePreview();
    });
    this.root.querySelector<HTMLButtonElement>("#replacement-tool-update")
      ?.addEventListener("click", this.options.updatePreview);
    this.root.querySelector<HTMLElement>(".replacement-tool-file-list")
      ?.addEventListener("click", (event) => this.activateFileTree(event));
    this.root.querySelector<HTMLButtonElement>("[data-replacement-file-view]")
      ?.addEventListener("click", () => {
        this.fileView = this.fileView === "tree" ? "flat" : "tree";
        this.renderFileList();
      });
    this.root.querySelector<HTMLButtonElement>("[data-replacement-expand]")
      ?.addEventListener("click", () => {
        const files = this.options.controller.state.replacement.preview?.files ?? [];
        this.expandedDirectories = new Set(allDirectoryPaths(replacementTree(files)));
        this.renderFileList();
      });
    this.root.querySelector<HTMLButtonElement>("[data-replacement-collapse]")
      ?.addEventListener("click", () => {
        this.expandedDirectories = new Set();
        this.renderFileList();
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-replacement-tool-change]").forEach((button) => {
      button.addEventListener("click", () => this.editor.navigateChange(
        button.dataset.replacementToolChange === "next" ? 1 : -1,
      ));
    });
    this.root.querySelector<HTMLButtonElement>("[data-replacement-tool-unchanged]")
      ?.addEventListener("click", () => {
        this.expandedUnchanged = !this.expandedUnchanged;
        this.syncUnchangedButton();
        this.mountSelectedSession();
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-replacement-tool-layout]").forEach((button) => {
      button.addEventListener("click", () => {
        const layout = button.dataset.replacementToolLayout;
        if (layout === "split" || layout === "unified") this.options.setDiffLayout(layout);
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-replacement-tool-whitespace]")
      ?.addEventListener("click", () => this.options.setWhitespace(!this.options.presentation().showWhitespace));
    this.root.querySelector<HTMLButtonElement>("#replacement-tool-review")
      ?.addEventListener("click", this.options.review);
    this.root.querySelector<HTMLButtonElement>("#replacement-tool-save")
      ?.addEventListener("click", () => void this.saveSelectedSession());
  }

  private renderFiles(files: readonly WorkspaceReplacementFilePreview[]): string {
    const byPath = new Map(files.map((file) => [file.workspacePath, file]));
    if (this.fileView === "flat") {
      return sortFilesByName(files.map((file) => ({ path: file.workspacePath }))).map(({ path }) => {
        const file = byPath.get(path)!;
        const selected = file.workspacePath === this.selectedPath;
        return `<button class="replacement-tool-file flat ${selected ? "selected" : ""}" data-replacement-tool-file="${escapeAttribute(file.workspacePath)}" type="button" role="option" aria-selected="${selected}" title="${escapeAttribute(file.workspacePath)}"><span class="replacement-file-glyph">${fileTypeIcon(file.workspacePath)}</span><span class="replacement-file-copy"><strong>${escapeHtml(basename(file.workspacePath))}</strong><small>${escapeHtml(dirname(file.workspacePath))} · ${escapeHtml(this.options.copy().matches(file.matchCount))}</small></span></button>`;
      }).join("");
    }
    return projectTreeRows(replacementTree(files), this.expandedDirectories).map((row) => {
      if (row.node.kind === "directory") {
        const expanded = this.expandedDirectories.has(row.node.path);
        return `<button class="replacement-tool-file directory" data-replacement-directory="${escapeAttribute(row.node.path)}" type="button" role="treeitem" style="--tree-depth:${row.depth}" aria-expanded="${expanded}"><span class="tree-chevron ${expanded ? "expanded" : ""}">${icon("chevron", 12)}</span>${icon("folder", 15)}<strong>${escapeHtml(row.label)}</strong><small>${row.fileCount}</small></button>`;
      }
      const file = byPath.get(row.node.path);
      if (!file) return "";
      const selected = file.workspacePath === this.selectedPath;
      return `<button class="replacement-tool-file tree ${selected ? "selected" : ""}" data-replacement-tool-file="${escapeAttribute(file.workspacePath)}" type="button" role="treeitem" style="--tree-depth:${row.depth}" aria-selected="${selected}" title="${escapeAttribute(file.workspacePath)}"><span class="replacement-tree-spacer"></span><span class="replacement-file-glyph">${fileTypeIcon(file.workspacePath)}</span><strong>${escapeHtml(basename(file.workspacePath))}</strong><small>${escapeHtml(this.options.copy().matches(file.matchCount))}</small></button>`;
    }).join("");
  }

  private renderFileList(): void {
    const files = this.options.controller.state.replacement.preview?.files ?? [];
    const list = this.root.querySelector<HTMLElement>(".replacement-tool-file-list");
    if (!list) return;
    const scrollTop = list.scrollTop;
    list.className = `replacement-tool-file-list ${this.fileView}`;
    list.setAttribute("role", this.fileView === "tree" ? "tree" : "listbox");
    list.innerHTML = this.renderFiles(files);
    list.scrollTop = scrollTop;
    const view = this.root.querySelector<HTMLButtonElement>("[data-replacement-file-view]");
    if (view) {
      view.classList.toggle("active", this.fileView === "tree");
      view.setAttribute("aria-pressed", String(this.fileView === "tree"));
      view.title = this.fileView === "tree" ? this.options.copy().flatView : this.options.copy().treeView;
    }
    for (const selector of ["[data-replacement-expand]", "[data-replacement-collapse]"]) {
      const button = this.root.querySelector<HTMLButtonElement>(selector);
      if (button) button.disabled = this.fileView !== "tree";
    }
  }

  private activateFileTree(event: Event): void {
    const target = (event.target as Element | null)?.closest<HTMLButtonElement>(
      "[data-replacement-tool-file], [data-replacement-directory]",
    );
    if (!target) return;
    const directory = target.dataset.replacementDirectory;
    if (directory) {
      if (this.expandedDirectories.has(directory)) this.expandedDirectories.delete(directory);
      else this.expandedDirectories.add(directory);
      this.renderFileList();
      return;
    }
    const path = target.dataset.replacementToolFile;
    if (!path || path === this.selectedPath) return;
    this.selectedPath = path;
    this.renderFileList();
    const label = this.root.querySelector("#replacement-tool-path");
    if (label) label.textContent = path;
    void this.loadSelectedSession();
  }

  private async loadSelectedSession(): Promise<void> {
    const state = this.options.controller.state.replacement;
    const preview = state.preview;
    const path = this.selectedPath;
    const host = this.root.querySelector<HTMLElement>("#replacement-tool-diff");
    const file = preview?.files.find((candidate) => candidate.workspacePath === path);
    if (!host || !preview || !file || !path) return;
    if (this.options.blockedOpenPaths().has(path)) {
      this.editor.destroy();
      host.innerHTML = `<div class="replacement-tool-error" role="alert"><strong>${escapeHtml(this.options.copy().blockedFile)}</strong><small>${escapeHtml(path)}</small></div>`;
      return;
    }
    const generation = ++this.loadGeneration;
    const cached = this.options.controller.fileSession(path);
    if (cached?.planId === preview.planId) {
      this.mountSession(host, cached);
      return;
    }
    this.editor.destroy();
    host.innerHTML = `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(this.options.copy().loadingComparison)}</span></div>`;
    const session = await this.options.controller.loadFileSession(file, this.options.describeError);
    const currentHost = this.root.querySelector<HTMLElement>("#replacement-tool-diff");
    if (generation !== this.loadGeneration || this.selectedPath !== path || !currentHost?.isConnected) return;
    if (session) this.mountSession(currentHost, session);
    else currentHost.innerHTML = `<div class="replacement-tool-error" role="alert"><strong>${escapeHtml(this.options.copy().comparisonUnavailable)}</strong></div>`;
  }

  private syncToolDraft(): void {
    const changed = this.previewChanged();
    this.root.querySelector<HTMLElement>(".replacement-tool-draft")?.classList.toggle("hidden", !changed);
    const update = this.root.querySelector<HTMLButtonElement>("#replacement-tool-update");
    if (update) update.disabled = !changed;
    const review = this.root.querySelector<HTMLButtonElement>("#replacement-tool-review");
    if (review) review.disabled = changed;
  }

  private syncUnchangedButton(): void {
    const button = this.root.querySelector<HTMLButtonElement>("[data-replacement-tool-unchanged]");
    if (!button) return;
    const copy = this.options.editorCopy();
    const label = this.expandedUnchanged ? copy.collapseUnchanged : copy.expandUnchanged;
    button.classList.toggle("active", this.expandedUnchanged);
    button.setAttribute("aria-pressed", String(this.expandedUnchanged));
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = icon(this.expandedUnchanged ? "collapse" : "expand", 15);
  }

  private mountSelectedSession(): void {
    const path = this.selectedPath;
    const host = this.root.querySelector<HTMLElement>("#replacement-tool-diff");
    const session = path ? this.options.controller.fileSession(path) : null;
    if (host && session) this.mountSession(host, session);
  }

  private mountSession(host: HTMLElement, session: WorkspaceReplacementFileSession): void {
    if (session.workspacePath !== this.selectedPath) return;
    const copy = this.options.copy();
    const actions = buildWorkspaceReplacementActionDocument(
      session.originalContent,
      session.proposedContent,
      session.content,
    );
    this.editor.mount(
      host,
      actions.content,
      session.content,
      session.workspacePath,
      this.options.preferences(),
      this.options.presentation(),
      this.expandedUnchanged,
      (content) => {
        const previous = this.options.controller.fileSession(session.workspacePath);
        const current = this.options.controller.updateFileContent(session.workspacePath, content);
        if (
          !current ||
          previous?.content === content ||
          this.selectedPath !== session.workspacePath
        ) return;
        queueMicrotask(() => {
          if (this.selectedPath === session.workspacePath) this.mountSelectedSession();
        });
      },
      {
        unifiedControl: {
          label: copy.updatePatch,
          title: copy.updatePatch,
          disabled: session.status === "saving",
        },
        control: (chunk) => {
          const kind = replacementActionForChunk(chunk, actions.actions);
          const latest = this.options.controller.fileSession(session.workspacePath) ?? session;
          const hasDraft = latest.content !== latest.persistedContent;
          const disabled = latest.status === "saving" || (kind === "replace" && hasDraft);
          const label = kind === "replace" ? copy.replacePatch : kind === "rollback" ? copy.rollbackPatch : copy.updatePatch;
          return {
            label,
            title: disabled && kind === "replace" ? copy.saveBeforeReplace : label,
            disabled,
          };
        },
        activate: () => {
          const latest = this.options.controller.fileSession(session.workspacePath);
          this.autoSaveAction = Boolean(latest && latest.status === "ready" && latest.content === latest.persistedContent);
        },
        revert: () => {
          this.mountSelectedSession();
          if (this.autoSaveAction) void this.saveSelectedSession();
          this.autoSaveAction = false;
        },
        save: (content) => {
          this.options.controller.updateFileContent(session.workspacePath, content);
          void this.saveSelectedSession();
        },
      },
    );
    this.syncFileSaveState(session);
  }

  private async saveSelectedSession(): Promise<void> {
    const path = this.selectedPath;
    if (!path) return;
    this.syncFileSaveState(this.options.controller.fileSession(path));
    const outcome = await this.options.controller.saveFileSession(path, this.options.describeError);
    if (this.selectedPath !== path) return;
    if (outcome.status === "saved") {
      this.mountSelectedSession();
      this.syncFileSaveState(outcome.session);
      await this.options.fileSaved(path);
      return;
    }
    this.syncFileSaveState(this.options.controller.fileSession(path));
  }

  private syncFileSaveState(session: WorkspaceReplacementFileSession | null): void {
    const copy = this.options.copy();
    const status = this.root.querySelector<HTMLElement>("#replacement-tool-save-state");
    const save = this.root.querySelector<HTMLButtonElement>("#replacement-tool-save");
    if (!status || !save || !session) return;
    const dirty = session.content !== session.persistedContent;
    status.textContent = session.error ?? (session.status === "saving" ? this.options.editorCopy().saving : dirty ? copy.unsavedFile : copy.savedFile);
    status.classList.toggle("error", Boolean(session.error));
    save.disabled = !dirty || session.status === "saving";
  }

  private syncModalStack(open: boolean): void {
    const command = this.query("#command-surface");
    if (open && this.options.commandSurfaceOpen() && !command.classList.contains("hidden")) {
      this.commandSurfaceSuppressed = true;
      command.classList.add("hidden");
      command.setAttribute("inert", "");
      command.setAttribute("aria-hidden", "true");
    } else if (!open && this.commandSurfaceSuppressed) {
      this.commandSurfaceSuppressed = false;
      command.removeAttribute("inert");
      command.removeAttribute("aria-hidden");
      command.classList.toggle("hidden", !this.options.commandSurfaceOpen());
      if (this.options.commandSurfaceOpen()) queueMicrotask(() => {
        command.querySelector<HTMLElement>("#command-surface-input")?.focus();
      });
    }
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workspace replacement element: ${selector}`);
    return element;
  }
}

function replacementTree(files: readonly WorkspaceReplacementFilePreview[]): ProjectTreeNode[] {
  return buildProjectTree(files.map((file) => file.workspacePath));
}

function allDirectoryPaths(nodes: readonly ProjectTreeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "directory" ? descendantProjectDirectories(node) : []);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/gu, "&#96;");
}
