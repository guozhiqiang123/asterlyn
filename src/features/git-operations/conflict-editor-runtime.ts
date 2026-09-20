import { editorDocumentContentKey, type EditorDocument } from "../../editor-document.ts";
import { icon } from "../../icons.ts";
import type { EditorCopy, GitOperationCopy } from "../../localization/catalog.ts";
import type { GitConflictContent, RepositorySnapshot } from "../../models.ts";
import type { AppPreferences } from "../../preferences.ts";
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
    copy: GitOperationCopy,
    editorCopy: EditorCopy,
    beforeTransition: () => void,
    onContentChange: (content: string) => void,
  ): void;
  setConflictReadOnly(readOnly: boolean): void;
  flushConflict(): string | null;
}

export interface ConflictEditorRuntimeOptions {
  root: HTMLElement;
  controller: GitOperationController;
  editor: ConflictEditorSessionPort;
  surface: ConflictEditorSurfacePort;
  snapshot(): RepositorySnapshot | null;
  activeDocument(): EditorDocument;
  activate(document: ConflictDocument): void;
  renderEditor(): void;
  preferences(): AppPreferences;
  copy(): GitOperationCopy;
  editorCopy(): EditorCopy;
  status(message: string): void;
  resolve(deleteFile: boolean): void;
}

/** Owns the persistent editor-region presentation for one Git conflict draft. */
export class ConflictEditorRuntime {
  private readonly options: ConflictEditorRuntimeOptions;

  constructor(options: ConflictEditorRuntimeOptions) {
    this.options = options;
  }

  async open(path: string): Promise<void> {
    const { controller } = this.options;
    const snapshot = this.options.snapshot();
    if (!snapshot?.operation?.conflicts.some((conflict) => conflict.path === path)) return;
    if (controller.hasUnsavedConflict() && controller.state.conflict?.path !== path) {
      this.options.status(this.options.copy().discardConflict);
      return;
    }
    const opening = controller.openConflict(path);
    this.options.activate({ kind: "conflict-resolution", repositoryRoot: snapshot.root, path });
    this.options.renderEditor();
    await opening;
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
    this.query("#content-header").innerHTML = `${contentHeading(basename(document.path), document.path)}
      <div class="header-actions conflict-editor-actions">
        <button class="secondary-button" id="conflict-resolve-delete" type="button" ${resolving || !state.conflict ? "disabled" : ""}>${escapeHtml(copy.resolveAsDeleted)}</button>
        <button class="primary-button" id="conflict-resolve-save" type="button" ${resolving || state.conflict?.binary !== false ? "disabled" : ""}>${escapeHtml(resolving ? copy.resolving : copy.saveAndStage)}</button>
      </div>`;
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
        copy,
        this.options.editorCopy(),
        () => undefined,
        (content) => controller.setConflictResult(content),
      );
      surface.setConflictReadOnly(resolving);
    }
    root.querySelector<HTMLButtonElement>("#conflict-resolve-delete")?.addEventListener("click", () => this.options.resolve(true));
    root.querySelector<HTMLButtonElement>("#conflict-resolve-save")?.addEventListener("click", () => this.options.resolve(false));
    return true;
  }

  capture(): void {
    if (this.options.activeDocument().kind !== "conflict-resolution") return;
    const content = this.options.surface.flushConflict();
    if (content !== null) this.options.controller.setConflictResult(content);
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.options.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing conflict editor element: ${selector}`);
    return element;
  }
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
