import { editorDocumentContentKey, type EditorDocument } from "../../editor-document.ts";
import { icon } from "../../icons.ts";
import type { EditorCopy, GitOperationCopy } from "../../localization/catalog.ts";
import type { GitConflictContent, RepositorySnapshot } from "../../models.ts";
import type { AppPreferences } from "../../preferences.ts";
import type { DiffPresentation } from "../../diff-presentation.ts";
import type { DiffReviewSummary } from "../../shared/diff-review/diff-review-model.ts";
import { CONFLICT_DIFF_CAPABILITIES } from "../../shared/diff-review/diff-review-model.ts";
import { renderDiffReviewToolbar } from "../../shared/diff-review/diff-review-toolbar.ts";
import type {
  GitOperationChange,
  GitOperationController,
} from "./git-operation-controller.ts";

type ConflictDocument = Extract<EditorDocument, { kind: "conflict-resolution" }>;

interface ConflictEditorSessionPort {
  closePreview(): void;
}

interface ConflictEditorSurfacePort {
  showHtml(key: string, html: string, beforeTransition: () => void): void;
  mountConflict(
    key: string,
    conflict: GitConflictContent,
    result: string,
    preferences: AppPreferences,
    presentation: DiffPresentation,
    copy: GitOperationCopy,
    editorCopy: EditorCopy,
    beforeTransition: () => void,
    onContentChange: (content: string) => void,
    onReady: () => void,
  ): void;
  setConflictReadOnly(readOnly: boolean): void;
  flushConflict(): string | null;
  navigateDiffChange(direction: 1 | -1): boolean;
  conflictReviewSummary(): DiffReviewSummary | null;
  conflictUnchangedExpanded(): boolean;
  setConflictUnchangedExpanded(expanded: boolean): void;
}

export interface ConflictEditorRuntimeOptions {
  root: HTMLElement;
  controller: GitOperationController;
  editor: ConflictEditorSessionPort;
  surface: ConflictEditorSurfacePort;
  snapshot(): RepositorySnapshot | null;
  activeDocument(): EditorDocument;
  activate(document: ConflictDocument): void;
  selectConflict(path: string): void;
  renderEditor(): void;
  preferences(): AppPreferences;
  presentation(): DiffPresentation;
  copy(): GitOperationCopy;
  editorCopy(): EditorCopy;
  status(message: string): void;
  resolve(deleteFile: boolean): void;
  setDiffLayout(layout: "unified" | "split"): void;
  setWhitespace(showWhitespace: boolean): void;
  conflictSourceAvailable(path: string): boolean;
  revealConflictSource(): void;
  confirmDiscard(): Promise<boolean>;
  notifyBlockedSwitch(): Promise<void>;
}

/** Owns the persistent editor-region presentation for one Git conflict draft. */
export class ConflictEditorRuntime {
  private readonly options: ConflictEditorRuntimeOptions;
  private blockedSwitchNotice: Promise<void> | null = null;

  constructor(options: ConflictEditorRuntimeOptions) {
    this.options = options;
  }

  async open(path: string): Promise<boolean> {
    const { controller } = this.options;
    const snapshot = this.options.snapshot();
    if (!snapshot?.changes.some((change) => change.path === path && change.conflicted) &&
      !snapshot?.operation?.conflicts.some((conflict) => conflict.path === path)) return false;
    if (controller.state.conflict?.path !== path && this.hasUnsavedReview()) {
      await this.notifyBlockedSwitch();
      return false;
    }
    this.options.selectConflict(path);
    const opening = controller.openConflict(path);
    this.options.activate({ kind: "conflict-resolution", repositoryRoot: snapshot.root, path });
    this.options.renderEditor();
    return opening;
  }

  handleChange(change: GitOperationChange): void {
    if (!change.conflictChanged || change.reason === "draft") return;
    const document = this.options.activeDocument();
    if (document.kind !== "conflict-resolution") return;
    const state = this.options.controller.state;
    if (!state.conflict && state.loading !== "conflict") this.options.editor.closePreview();
    this.options.renderEditor();
  }

  render(document: EditorDocument): boolean {
    if (document.kind !== "conflict-resolution") return false;
    const { controller, root, surface } = this.options;
    const state = controller.state;
    const copy = this.options.copy();
    const resolving = state.loading === "resolve";
    surface.setConflictReadOnly(resolving);
    const conflict = state.conflict;
    if (state.loading === "conflict") {
      surface.showHtml(editorDocumentContentKey(document, "loading"), loadingBlock(copy.readingConflict), () => undefined);
    } else if (!conflict || conflict.path !== document.path) {
      surface.showHtml(
        editorDocumentContentKey(document, `error:${state.error ?? "unavailable"}`),
        retryState(copy.conflictUnavailable, state.error ?? copy.conflictUnavailable, "retry-conflict-editor", "changes", this.options.editorCopy()),
        () => undefined,
      );
      this.query("#retry-conflict-editor").addEventListener("click", () => void this.open(document.path));
    } else if (conflict.binary) {
      surface.showHtml(
        editorDocumentContentKey(document, `binary:${conflict.revisionToken}`),
        emptyState(copy.binaryConflict, copy.resolveSafetyNote, "changes"),
        () => undefined,
      );
    } else {
      surface.mountConflict(
        editorDocumentContentKey(document, conflict.revisionToken),
        conflict,
        state.conflictResult,
        this.options.preferences(),
        this.options.presentation(),
        copy,
        this.options.editorCopy(),
        () => undefined,
        (content) => {
          controller.setConflictResult(content);
          this.options.renderEditor();
        },
        () => this.options.renderEditor(),
      );
      surface.setConflictReadOnly(resolving);
    }
    const summary = surface.conflictReviewSummary();
    const canSave = !resolving && state.conflict?.binary === false && conflictReviewCompletionReady(summary);
    this.query("#content-header").innerHTML = `${contentHeading(basename(document.path), document.path)}
      <div class="header-actions conflict-editor-actions">
        ${this.toolbar(summary, Boolean(conflict && !conflict.binary), document.path)}
        <button class="secondary-button" id="conflict-resolve-cancel" type="button" ${resolving ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button>
        <button class="secondary-button destructive-secondary" id="conflict-resolve-delete" type="button" ${resolving || !state.conflict ? "disabled" : ""}>${escapeHtml(copy.resolveAsDeleted)}</button>
        <button class="primary-button" id="conflict-resolve-save" type="button" ${canSave ? "" : "disabled"}>${escapeHtml(resolving ? copy.resolving : copy.saveAndStage)}</button>
      </div>`;
    this.query("#content-header").querySelectorAll<HTMLButtonElement>("[data-diff-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.diffAction;
        if (action === "toggle-unchanged") {
          surface.setConflictUnchangedExpanded(!surface.conflictUnchangedExpanded());
          this.options.renderEditor();
          return;
        }
        if (action === "previous-file" || action === "next-file") {
          const target = conflictFileNavigation(this.options.snapshot(), document.path)[
            action === "next-file" ? "next" : "previous"
          ];
          if (target) void this.open(target);
          return;
        }
        if (action === "open-source") {
          this.options.revealConflictSource();
          return;
        }
        const direction = action === "next-change" ? 1 : -1;
        if (!surface.navigateDiffChange(direction)) this.options.status(this.options.editorCopy().noFileChange(direction === 1 ? "next" : "previous"));
      });
    });
    this.query("#content-header").querySelector<HTMLButtonElement>("[data-diff-whitespace]")?.addEventListener("click", () => {
      this.options.setWhitespace(!this.options.preferences().showWhitespace);
    });
    this.query("#content-header").querySelectorAll<HTMLButtonElement>("[data-diff-layout]").forEach((button) => {
      button.addEventListener("click", () => {
        const layout = button.dataset.diffLayout;
        if (layout === "split" || layout === "unified") this.options.setDiffLayout(layout);
      });
    });
    root.querySelector<HTMLButtonElement>("#conflict-resolve-cancel")?.addEventListener("click", () => void this.requestCancel());
    root.querySelector<HTMLButtonElement>("#conflict-resolve-delete")?.addEventListener("click", () => this.options.resolve(true));
    root.querySelector<HTMLButtonElement>("#conflict-resolve-save")?.addEventListener("click", () => void this.requestSave());
    return true;
  }

  private toolbar(summary: DiffReviewSummary | null, ready: boolean, path: string): string {
    const editor = this.options.editorCopy();
    const copy = this.options.copy();
    const files = conflictFileNavigation(this.options.snapshot(), path);
    return renderDiffReviewToolbar({
      namespace: "editor",
      capabilities: CONFLICT_DIFF_CAPABILITIES,
      ready,
      layout: this.options.presentation().layout,
      showWhitespace: this.options.preferences().showWhitespace,
      expandedUnchanged: this.options.surface.conflictUnchangedExpanded(),
      previousFileAvailable: files.previous !== null,
      nextFileAvailable: files.next !== null,
      sourceAvailable: this.options.conflictSourceAvailable(path),
      summary: summary ? copy.conflictReviewSummary(summary.conflicts, summary.pendingConflicts, summary.total) : null,
      copy: {
        toolbar: editor.diffToolbar,
        navigation: editor.diffNavigation,
        previousBlock: copy.previousConflict,
        nextBlock: copy.nextConflict,
        previousFile: copy.previousConflictFile,
        nextFile: copy.nextConflictFile,
        openSource: copy.revealConflictFile,
        collapseUnchanged: editor.collapseUnchanged,
        expandUnchanged: editor.expandUnchanged,
        presentation: editor.diffPresentation,
        unified: editor.unified,
        unifiedTitle: editor.unifiedTitle,
        split: editor.sideBySide,
        splitTitle: editor.sideBySideTitle,
        whitespace: editor.whitespace,
        whitespaceTitle: editor.whitespaceTitle,
      },
    });
  }

  capture(): void {
    if (this.options.activeDocument().kind !== "conflict-resolution") return;
    const content = this.options.surface.flushConflict();
    if (content !== null) this.options.controller.setConflictResult(content);
  }

  async requestCancel(): Promise<boolean> {
    this.capture();
    const { controller } = this.options;
    const conflict = controller.state.conflict;
    const result = controller.state.conflictResult;
    if (controller.hasUnsavedConflict() && !(await this.options.confirmDiscard())) return false;
    if (controller.state.conflict !== conflict || controller.state.conflictResult !== result) return false;
    if (!controller.closeDialog(true)) return false;
    this.options.editor.closePreview();
    return true;
  }

  async requestSave(): Promise<boolean> {
    this.capture();
    const { controller } = this.options;
    const conflict = controller.state.conflict;
    const result = controller.state.conflictResult;
    if (!conflictReviewCompletionReady(this.options.surface.conflictReviewSummary())) return false;
    if (controller.state.conflict !== conflict || controller.state.conflictResult !== result) return false;
    this.options.resolve(false);
    return true;
  }

  private hasUnsavedReview(): boolean {
    const summary = this.options.surface.conflictReviewSummary();
    return this.options.controller.hasUnsavedConflict() || Boolean(
      summary && (summary.explicitlyReviewed > 0 || summary.manual > 0),
    );
  }

  private async notifyBlockedSwitch(): Promise<void> {
    this.blockedSwitchNotice ??= this.options.notifyBlockedSwitch();
    try { await this.blockedSwitchNotice; } finally { this.blockedSwitchNotice = null; }
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.options.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing conflict editor element: ${selector}`);
    return element;
  }
}

export function conflictFileNavigation(
  snapshot: RepositorySnapshot | null,
  path: string,
): { readonly previous: string | null; readonly next: string | null } {
  const paths = [...new Set([
    ...(snapshot?.changes.filter((change) => change.conflicted).map((change) => change.path) ?? []),
    ...(snapshot?.operation?.conflicts.map((conflict) => conflict.path) ?? []),
  ])];
  const index = paths.indexOf(path);
  return {
    previous: index > 0 ? paths[index - 1] ?? null : null,
    next: index >= 0 ? paths[index + 1] ?? null : null,
  };
}

export function conflictReviewCompletionReady(summary: DiffReviewSummary | null): boolean {
  return summary !== null && summary.pendingConflicts === 0;
}

function basename(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function contentHeading(title: string, subtitle: string): string {
  return `<div class="content-title-group"><h2>${escapeHtml(title)}</h2><small>${escapeHtml(subtitle)}</small></div>`;
}

function loadingBlock(label: string): string {
  return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

function emptyState(title: string, detail: string, iconName: "changes"): string {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName, 24)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

function retryState(
  title: string,
  detail: string,
  retryId: string,
  iconName: "changes",
  copy: EditorCopy,
): string {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName, 24)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p><button class="secondary-button retry-button" id="${retryId}" type="button">${escapeHtml(copy.tryAgain)}</button></div>`;
}
