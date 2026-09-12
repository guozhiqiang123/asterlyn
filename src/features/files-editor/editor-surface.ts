import type { DiffPresentation } from "../../diff-presentation.ts";
import type { ImageDiffPreview, ImagePreview } from "../../models.ts";
import { attachSplitter } from "../../workbench/splitter.ts";
import { editorDocumentContentKey, editorDocumentKey, type EditorDocument, type ProjectImageDocument } from "../../workbench/editor-document.ts";
import { textTab, type EditorSession, type TextTabState } from "../../workbench/editor-session.ts";
import type { AppPreferences } from "../../workbench/preferences.ts";
import { MARKDOWN_PREVIEW_MAX_BYTES } from "../../workbench/markdown-format.ts";
import { LazyDiffEditor, LazyTextEditor } from "./lazy-editor-runtime.ts";
import {
  emptyImageSide,
  imagePreviewCard,
  loadingBlock,
  markdownPreviewLoadingBlock,
  retryState,
} from "./editor-view.ts";

export type ImageSurfaceState =
  | { key: string; version: number; status: "loading"; error: null; image: null; diff: null }
  | { key: string; version: number; status: "ready"; error: null; image: ImagePreview | null; diff: ImageDiffPreview | null }
  | { key: string; version: number; status: "error"; error: string; image: null; diff: null };

type DiffDocument = Extract<EditorDocument, { kind: "working-diff" | "commit-diff" }>;

export class EditorSurface {
  private readonly diffEditor = new LazyDiffEditor();
  private readonly textEditor = new LazyTextEditor();
  private mountedEditorKey: string | null = null;
  private mountedTextTabId: string | null = null;
  private markdownSourcePercent = 50;
  private markdownSplitterDisposer: (() => void) | null = null;
  private markdownScrollDisposer: (() => void) | null = null;
  private markdownPreviewTimer: number | null = null;
  private markdownPreviewSequence = 0;
  private markdownPreviewPending: { tabId: string; content: string; request: number } | null = null;
  private activeMarkdownMode: TextTabState["markdownMode"] | null = null;
  private measureFrame: number | null = null;

  constructor(private readonly root: HTMLElement) {}

  retain(tabIds: readonly string[]): void {
    this.textEditor.retain(tabIds);
  }

  capture(
    session: EditorSession,
    accept: (tabId: string, content: string) => void,
    onlyTabId?: string,
  ): void {
    const tabId = this.mountedTextTabId;
    if (!tabId || (onlyTabId && onlyTabId !== tabId) || !textTab(session, tabId)) return;
    this.textEditor.flushChanges();
    accept(tabId, this.textEditor.content());
  }

  disposeTextTab(tabId: string): void {
    this.textEditor.dispose(tabId);
  }

  openFindReplace(): void {
    this.textEditor.openFindReplace();
  }

  selectRange(fromUtf16: number, toUtf16: number): boolean {
    return this.textEditor.selectRange(fromUtf16, toUtf16);
  }

  navigateDiffChange(direction: 1 | -1): boolean {
    return this.diffEditor.navigateChange(direction);
  }

  setReadOnly(readOnly: boolean): void {
    this.textEditor.setReadOnly(readOnly);
  }

  setPreferences(preferences: AppPreferences): void {
    this.textEditor.setPreferences(preferences);
    this.diffEditor.setPreferences(preferences);
  }

  setDiffPresentation(presentation: DiffPresentation): void {
    this.diffEditor.setPresentation(presentation);
  }

  requestMeasure(): void {
    if (this.measureFrame !== null) return;
    this.measureFrame = window.requestAnimationFrame(() => {
      this.measureFrame = null;
      this.diffEditor.requestMeasure();
      this.textEditor.requestMeasure();
    });
  }

  showHtml(key: string, html: string, beforeTransition: () => void): void {
    if (this.mountedEditorKey === key) return;
    beforeTransition();
    this.disposeMarkdownSurface();
    this.textEditor.detach();
    this.mountedTextTabId = null;
    this.diffEditor.destroy();
    const body = this.query("#content-body");
    this.resetBodyClasses(body);
    body.innerHTML = html;
    this.mountedEditorKey = key;
  }

  renderProjectImage(
    document: ProjectImageDocument,
    imageState: ImageSurfaceState | null,
    beforeTransition: () => void,
    retry: () => void,
  ): void {
    const key = editorDocumentKey(document);
    const surface = imageState?.key === key ? imageState : null;
    if (!surface || surface.status === "loading") {
      this.showHtml(editorDocumentContentKey(document, "image-loading"), loadingBlock("Loading image preview…"), beforeTransition);
      return;
    }
    if (surface.status === "error") {
      this.showHtml(
        editorDocumentContentKey(document, `image-error:${surface.error}`),
        retryState("Could not preview image", surface.error, "retry-project-image", "folder"),
        beforeTransition,
      );
      this.query("#retry-project-image").addEventListener("click", retry);
      return;
    }
    if (!surface.image) return;
    this.showHtml(
      editorDocumentContentKey(document, `image:${surface.version}`),
      `<section class="image-preview-surface" aria-label="Image preview">${imagePreviewCard(surface.image, "Preview")}</section>`,
      beforeTransition,
    );
    this.query("#content-body").classList.add("image-surface");
  }

  renderImageDiff(
    document: DiffDocument,
    imageState: ImageSurfaceState | null,
    beforeTransition: () => void,
    retry: () => void,
  ): void {
    const key = editorDocumentKey(document);
    const surface = imageState?.key === key ? imageState : null;
    if (!surface || surface.status === "loading") {
      this.showHtml(editorDocumentContentKey(document, "image-diff-loading"), loadingBlock("Loading image Diff…"), beforeTransition);
      return;
    }
    if (surface.status === "error") {
      this.showHtml(
        editorDocumentContentKey(document, `image-diff-error:${surface.error}`),
        retryState("Could not preview image Diff", surface.error, "retry-image-diff", "changes"),
        beforeTransition,
      );
      this.query("#retry-image-diff").addEventListener("click", retry);
      return;
    }
    if (!surface.diff) return;
    const before = surface.diff.before
      ? imagePreviewCard(surface.diff.before, "Before")
      : emptyImageSide("Before", "File did not exist");
    const after = surface.diff.after
      ? imagePreviewCard(surface.diff.after, "After")
      : emptyImageSide("After", "File was removed");
    this.showHtml(
      editorDocumentContentKey(document, `image-diff:${surface.version}`),
      `<section class="image-diff-surface" aria-label="Image Diff">${before}${after}</section>`,
      beforeTransition,
    );
    this.query("#content-body").classList.add("image-surface");
  }

  mountDiff(
    key: string,
    patch: string,
    path: string,
    preferences: AppPreferences,
    presentation: DiffPresentation,
    beforeTransition: () => void,
  ): void {
    if (this.mountedEditorKey === key) {
      this.diffEditor.requestMeasure();
      return;
    }
    beforeTransition();
    this.disposeMarkdownSurface();
    this.textEditor.detach();
    this.mountedTextTabId = null;
    this.diffEditor.destroy();
    const body = this.query("#content-body");
    body.innerHTML = "";
    this.resetBodyClasses(body);
    body.classList.add("diff-surface");
    this.diffEditor.mount(body, patch, path, preferences, presentation);
    this.mountedEditorKey = key;
  }

  mountText(
    key: string,
    tab: TextTabState,
    preferences: AppPreferences,
    beforeTransition: () => void,
    onContentChange: (tabId: string, content: string) => void,
  ): void {
    if (this.mountedEditorKey === key && this.mountedTextTabId === tab.id) {
      this.textEditor.requestMeasure();
      return;
    }
    const body = this.query("#content-body");
    const reuseTextSurface = this.textEditor.isMountedIn(body);
    beforeTransition();
    this.disposeMarkdownSurface();
    this.diffEditor.destroy();
    if (!reuseTextSurface) {
      this.textEditor.detach();
      body.innerHTML = "";
    }
    this.resetBodyClasses(body);
    body.classList.add("text-surface");
    this.mountedTextTabId = tab.id;
    this.activeMarkdownMode = null;
    this.mountTextEditorSurface(body, tab, preferences, onContentChange);
    this.mountedEditorKey = key;
  }

  mountMarkdown(
    key: string,
    tab: TextTabState,
    preferences: AppPreferences,
    beforeTransition: () => void,
    onContentChange: (tabId: string, content: string) => void,
  ): void {
    if (this.mountedEditorKey === key) {
      this.textEditor.requestMeasure();
      return;
    }
    beforeTransition();
    this.disposeMarkdownSurface();
    this.diffEditor.destroy();
    this.textEditor.detach();
    const body = this.query("#content-body");
    body.innerHTML = "";
    this.resetBodyClasses(body);
    body.classList.add("text-surface", "markdown-surface");
    this.activeMarkdownMode = tab.markdownMode;

    if (tab.markdownMode === "source") {
      body.classList.add("markdown-source-surface");
      this.mountedTextTabId = tab.id;
      this.mountTextEditorSurface(body, tab, preferences, onContentChange);
    } else if (tab.markdownMode === "split") {
      body.classList.add("markdown-split-surface");
      body.innerHTML = `<div class="markdown-split-layout" id="markdown-split-layout" style="--markdown-source-width: ${this.markdownSourcePercent}%">
        <div class="markdown-source-pane" id="markdown-source-pane" aria-label="Markdown source editor"></div>
        <div class="workbench-splitter vertical markdown-splitter" id="markdown-splitter" aria-label="Resize Markdown source and preview"></div>
        <section class="markdown-preview-pane" id="markdown-preview" aria-label="Markdown preview">${markdownPreviewLoadingBlock()}</section>
      </div>`;
      this.mountedTextTabId = tab.id;
      this.mountTextEditorSurface(this.query("#markdown-source-pane"), tab, preferences, onContentChange);
      const layout = this.query("#markdown-split-layout");
      this.markdownSplitterDisposer = attachSplitter(this.query("#markdown-splitter"), {
        orientation: "vertical",
        getValue: () => this.query("#markdown-source-pane").getBoundingClientRect().width,
        getRange: () => markdownSplitRange(layout.clientWidth),
        onChange: (value) => {
          if (layout.clientWidth <= 0) return;
          this.markdownSourcePercent = (value / layout.clientWidth) * 100;
          layout.style.setProperty("--markdown-source-width", `${this.markdownSourcePercent}%`);
          this.requestMeasure();
        },
        onReset: () => {
          this.markdownSourcePercent = 50;
          layout.style.setProperty("--markdown-source-width", "50%");
          this.requestMeasure();
        },
      });
      this.queueMarkdownPreview(tab.id, tab.content, true);
    } else {
      body.classList.add("markdown-preview-surface");
      this.mountedTextTabId = null;
      body.innerHTML = `<section class="markdown-preview-pane full" id="markdown-preview" aria-label="Markdown preview">${markdownPreviewLoadingBlock()}</section>`;
      this.queueMarkdownPreview(tab.id, tab.content, true);
    }
    this.mountedEditorKey = key;
  }

  destroy(): void {
    this.disposeMarkdownSurface();
    this.textEditor.destroy();
    this.diffEditor.destroy();
    if (this.measureFrame !== null) window.cancelAnimationFrame(this.measureFrame);
    this.measureFrame = null;
    this.mountedEditorKey = null;
    this.mountedTextTabId = null;
  }

  private mountTextEditorSurface(
    parent: HTMLElement,
    tab: TextTabState,
    preferences: AppPreferences,
    onContentChange: (tabId: string, content: string) => void,
  ): void {
    this.textEditor.mount(parent, tab.id, tab.loadEpoch, tab.content, tab.document.path, preferences, (content) => {
      if (this.mountedTextTabId !== tab.id) return;
      if (tab.markdownMode === "split") this.queueMarkdownPreview(tab.id, content);
      onContentChange(tab.id, content);
    });
  }

  private queueMarkdownPreview(tabId: string, content: string, immediate = false): void {
    const request = ++this.markdownPreviewSequence;
    this.markdownPreviewPending = { tabId, content, request };
    if (immediate) {
      if (this.markdownPreviewTimer !== null) window.clearTimeout(this.markdownPreviewTimer);
      this.markdownPreviewTimer = null;
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

  private async updateMarkdownPreview(request: { tabId: string; content: string; request: number }): Promise<void> {
    try {
      const { renderMarkdownPreview } = await import("../../workbench/markdown-preview.ts");
      const result = await renderMarkdownPreview(request.content);
      if (request.request !== this.markdownPreviewSequence) return;
      const preview = this.root.querySelector<HTMLElement>("#markdown-preview");
      if (!preview || this.activeMarkdownMode === "source") return;
      preview.innerHTML = result.status === "ready"
        ? `<article class="markdown-rendered">${result.html}</article>`
        : `<div class="markdown-preview-message" role="status"><strong>Preview paused for this large file</strong><span>The document is ${(result.byteLength / (1024 * 1024)).toFixed(1)} MiB. Live preview is limited to ${MARKDOWN_PREVIEW_MAX_BYTES / (1024 * 1024)} MiB; source editing and saving remain available.</span></div>`;
      this.attachMarkdownScrollSync();
    } catch (error) {
      if (request.request !== this.markdownPreviewSequence) return;
      const preview = this.root.querySelector<HTMLElement>("#markdown-preview");
      if (!preview) return;
      preview.innerHTML = `<div class="markdown-preview-message error" role="alert"><strong>Markdown preview failed</strong><span>${escapeHtml(errorMessage(error))}</span></div>`;
    }
  }

  private attachMarkdownScrollSync(): void {
    this.markdownScrollDisposer?.();
    this.markdownScrollDisposer = null;
    const preview = this.root.querySelector<HTMLElement>("#markdown-preview");
    if (!preview || this.activeMarkdownMode !== "split") return;
    preview.dataset.scrollSync = "proportional";
    this.markdownScrollDisposer = this.textEditor.linkVerticalScroll(preview);
  }

  private disposeMarkdownSurface(): void {
    this.markdownScrollDisposer?.();
    this.markdownScrollDisposer = null;
    this.markdownSplitterDisposer?.();
    this.markdownSplitterDisposer = null;
    if (this.markdownPreviewTimer !== null) window.clearTimeout(this.markdownPreviewTimer);
    this.markdownPreviewTimer = null;
    this.markdownPreviewPending = null;
    this.markdownPreviewSequence += 1;
    this.activeMarkdownMode = null;
  }

  private resetBodyClasses(body: HTMLElement): void {
    body.classList.remove("diff-surface", "text-surface", "markdown-surface", "markdown-source-surface", "markdown-split-surface", "markdown-preview-surface", "image-surface");
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing editor surface element: ${selector}`);
    return element;
  }
}

function markdownSplitRange(width: number): { minimum: number; maximum: number } {
  const usableWidth = Math.max(0, width - 5);
  const minimum = Math.min(220, usableWidth / 2);
  return { minimum, maximum: Math.max(minimum, usableWidth - minimum) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
