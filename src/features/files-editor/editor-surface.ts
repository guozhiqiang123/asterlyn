import type { DiffPresentation } from "../../diff-presentation.ts";
import type { ImageDiffPreview, ImagePreview } from "../../models.ts";
import { attachSplitter } from "../../presentation/splitter.ts";
import { editorDocumentContentKey, editorDocumentKey, type EditorDocument, type ProjectImageDocument } from "../../editor-document.ts";
import {
  textTab,
  type EditorSession,
  type TextTabState,
} from "./editor-session.ts";
import type { EditorRuntimeTabRemap } from "../../editor-path-mutation.ts";
import type { AppPreferences } from "../../preferences.ts";
import type { EffectiveTheme } from "../../presentation/presentation-environment.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import { MARKDOWN_PREVIEW_MAX_BYTES } from "./markdown-format.ts";
import type {
  DiffGitBlameSources,
  GitBlameAvailability,
  GitBlameRuntime,
} from "./editor-gutter.ts";
import { LazyDiffEditor, LazyTextEditor } from "./lazy-editor-runtime.ts";
import {
  emptyImageSide,
  imagePreviewCard,
  loadingBlock,
  markdownPreviewLoadingBlock,
  retryState,
} from "./editor-view.ts";
import type { EditorCopy } from "../../localization/catalog.ts";

export type ImageSurfaceState =
  | { key: string; version: number; status: "loading"; error: null; image: null; diff: null }
  | { key: string; version: number; status: "ready"; error: null; image: ImagePreview | null; diff: ImageDiffPreview | null }
  | { key: string; version: number; status: "error"; error: string; image: null; diff: null };

type DiffDocument = Extract<
  EditorDocument,
  { kind: "working-diff" | "commit-diff" | "commit-comparison-diff" }
>;

export class EditorSurface {
  private readonly diffEditor: LazyDiffEditor;
  private readonly textEditor: LazyTextEditor;
  private mountedEditorKey: string | null = null;
  private mountedTextTabId: string | null = null;
  private mountedTextLoadEpoch: number | null = null;
  private markdownSourcePercent = 50;
  private markdownSplitterDisposer: (() => void) | null = null;
  private markdownScrollDisposer: (() => void) | null = null;
  private markdownPreviewTimer: number | null = null;
  private markdownPreviewSequence = 0;
  private markdownPreviewPending: { tabId: string; content: string; request: number } | null = null;
  private activeMarkdownMode: TextTabState["markdownMode"] | null = null;
  private measureFrame: number | null = null;

  private readonly root: HTMLElement;
  private copy: EditorCopy;
  constructor(
    root: HTMLElement,
    copy: EditorCopy,
    blameRuntime: GitBlameRuntime,
    contextMenu: ContextMenuPort,
  ) {
    this.root = root;
    this.copy = copy;
    this.diffEditor = new LazyDiffEditor(
      blameRuntime,
      copy,
      contextMenu,
      "editor.surface.diff-blame",
    );
    this.textEditor = new LazyTextEditor(
      blameRuntime,
      copy,
      contextMenu,
      "editor.surface.text-blame",
    );
  }

  setCopy(copy: EditorCopy): void {
    const previous = this.copy;
    this.copy = copy;
    this.diffEditor.setBlameCopy(copy);
    this.textEditor.setBlameCopy(copy);
    this.localizeMountedSurface(previous);
  }

  retain(tabIds: readonly string[]): void {
    this.textEditor.retain(tabIds);
  }

  applyTextPathMutation(
    remaps: readonly EditorRuntimeTabRemap[],
    disposedTabIds: readonly string[],
  ): boolean {
    if (!this.textEditor.remap(remaps)) return false;
    for (const tabId of disposedTabIds) this.textEditor.dispose(tabId);
    return true;
  }

  capture(
    session: EditorSession,
    accept: (tabId: string, content: string) => void,
    onlyTabId?: string,
  ): void {
    const tabId = this.mountedTextTabId;
    const tab = tabId ? textTab(session, tabId) : null;
    if (!tabId || (onlyTabId && onlyTabId !== tabId) || !tab ||
      tab.status !== "ready" || tab.loadEpoch !== this.mountedTextLoadEpoch) return;
    this.textEditor.flushChanges();
    accept(tabId, this.textEditor.content(tabId));
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

  setTheme(theme: EffectiveTheme): void {
    this.textEditor.setTheme(theme);
    this.diffEditor.setTheme(theme);
  }

  setPhrases(phrases: Readonly<Record<string, string>>): void {
    this.textEditor.setPhrases(phrases);
    this.diffEditor.setPhrases(phrases);
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
      this.showHtml(editorDocumentContentKey(document, "image-loading"), loadingBlock(this.copy.loadingImage), beforeTransition);
      return;
    }
    if (surface.status === "error") {
      this.showHtml(
        editorDocumentContentKey(document, `image-error:${surface.error}`),
        retryState(this.copy.imageFailed, surface.error, "retry-project-image", "folder", this.copy),
        beforeTransition,
      );
      this.query("#retry-project-image").addEventListener("click", retry);
      return;
    }
    if (!surface.image) return;
    this.showHtml(
      editorDocumentContentKey(document, `image:${surface.version}`),
      `<section class="image-preview-surface" aria-label="${escapeHtml(this.copy.imageSurface)}">${imagePreviewCard(surface.image, this.copy.preview, this.copy)}</section>`,
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
      this.showHtml(editorDocumentContentKey(document, "image-diff-loading"), loadingBlock(this.copy.loadingImageDiff), beforeTransition);
      return;
    }
    if (surface.status === "error") {
      this.showHtml(
        editorDocumentContentKey(document, `image-diff-error:${surface.error}`),
        retryState(this.copy.imageDiffFailed, surface.error, "retry-image-diff", "changes", this.copy),
        beforeTransition,
      );
      this.query("#retry-image-diff").addEventListener("click", retry);
      return;
    }
    if (!surface.diff) return;
    const before = surface.diff.before
      ? imagePreviewCard(surface.diff.before, this.copy.before, this.copy)
      : emptyImageSide(this.copy.before, this.copy.fileDidNotExist);
    const after = surface.diff.after
      ? imagePreviewCard(surface.diff.after, this.copy.after, this.copy)
      : emptyImageSide(this.copy.after, this.copy.fileRemoved);
    this.showHtml(
      editorDocumentContentKey(document, `image-diff:${surface.version}`),
      `<section class="image-diff-surface" aria-label="${escapeHtml(this.copy.imageDiff)}">${before}${after}</section>`,
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
    blameSources: DiffGitBlameSources,
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
    this.diffEditor.mount(body, patch, path, preferences, presentation, blameSources);
    this.mountedEditorKey = key;
  }

  mountText(
    key: string,
    tab: TextTabState,
    preferences: AppPreferences,
    blame: GitBlameAvailability,
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
    this.mountTextEditorSurface(body, tab, preferences, blame, onContentChange);
    this.mountedEditorKey = key;
  }

  mountReadOnlyText(
    key: string,
    documentId: string,
    version: number,
    content: string,
    path: string,
    preferences: AppPreferences,
    beforeTransition: () => void,
  ): void {
    if (this.mountedEditorKey === key) {
      this.textEditor.requestMeasure();
      return;
    }
    const body = this.query("#content-body");
    beforeTransition();
    this.disposeMarkdownSurface();
    this.diffEditor.destroy();
    this.textEditor.detach();
    body.innerHTML = "";
    this.resetBodyClasses(body);
    body.classList.add("text-surface");
    this.mountedTextTabId = null;
    this.activeMarkdownMode = null;
    this.textEditor.mount(
      body,
      documentId,
      version,
      content,
      path,
      preferences,
      null,
      this.copy.gitBlameRequiresSavedFile,
      () => undefined,
    );
    this.mountedEditorKey = key;
  }

  renderReadOnlyImage(
    key: string,
    image: ImagePreview,
    label: string,
    beforeTransition: () => void,
  ): void {
    this.showHtml(
      key,
      `<section class="image-preview-surface" aria-label="${escapeHtml(label)}">${imagePreviewCard(image, label, this.copy)}</section>`,
      beforeTransition,
    );
    this.query("#content-body").classList.add("image-surface");
  }

  renderReadOnlyImageDiff(
    key: string,
    diff: ImageDiffPreview,
    beforeTransition: () => void,
  ): void {
    const before = diff.before
      ? imagePreviewCard(diff.before, this.copy.before, this.copy)
      : emptyImageSide(this.copy.before, this.copy.fileDidNotExist);
    const after = diff.after
      ? imagePreviewCard(diff.after, this.copy.after, this.copy)
      : emptyImageSide(this.copy.after, this.copy.fileRemoved);
    this.showHtml(
      key,
      `<section class="image-diff-surface" aria-label="${escapeHtml(this.copy.imageDiff)}">${before}${after}</section>`,
      beforeTransition,
    );
    this.query("#content-body").classList.add("image-surface");
  }

  mountMarkdown(
    key: string,
    tab: TextTabState,
    preferences: AppPreferences,
    blame: GitBlameAvailability,
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
      this.mountTextEditorSurface(body, tab, preferences, blame, onContentChange);
    } else if (tab.markdownMode === "split") {
      body.classList.add("markdown-split-surface");
      body.innerHTML = `<div class="markdown-split-layout" id="markdown-split-layout" style="--markdown-source-width: ${this.markdownSourcePercent}%">
        <div class="markdown-source-pane" id="markdown-source-pane" aria-label="${escapeHtml(this.copy.markdownSource)}"></div>
        <div class="workbench-splitter vertical markdown-splitter" id="markdown-splitter" aria-label="${escapeHtml(this.copy.resizeMarkdown)}"></div>
        <section class="markdown-preview-pane" id="markdown-preview" aria-label="${escapeHtml(this.copy.markdownPreview)}">${markdownPreviewLoadingBlock(this.copy)}</section>
      </div>`;
      this.mountedTextTabId = tab.id;
      this.mountTextEditorSurface(
        this.query("#markdown-source-pane"),
        tab,
        preferences,
        blame,
        onContentChange,
      );
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
      body.innerHTML = `<section class="markdown-preview-pane full" id="markdown-preview" aria-label="${escapeHtml(this.copy.markdownPreview)}">${markdownPreviewLoadingBlock(this.copy)}</section>`;
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
    blame: GitBlameAvailability,
    onContentChange: (tabId: string, content: string) => void,
  ): void {
    this.mountedTextLoadEpoch = tab.loadEpoch;
    this.textEditor.mount(
      parent,
      tab.id,
      tab.loadEpoch,
      tab.content,
      tab.document.path,
      preferences,
      blame.source,
      blame.unavailableReason,
      (content) => {
        if (this.mountedTextTabId !== tab.id || this.mountedTextLoadEpoch !== tab.loadEpoch) return;
        if (tab.markdownMode === "split") this.queueMarkdownPreview(tab.id, content);
        onContentChange(tab.id, content);
      },
    );
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
      const { renderMarkdownPreview } = await import("./markdown-preview.ts");
      const result = await renderMarkdownPreview(request.content, this.copy);
      if (request.request !== this.markdownPreviewSequence) return;
      const preview = this.root.querySelector<HTMLElement>("#markdown-preview");
      if (!preview || this.activeMarkdownMode === "source") return;
      preview.innerHTML = result.status === "ready"
        ? `<article class="markdown-rendered">${result.html}</article>`
        : `<div class="markdown-preview-message" role="status" data-markdown-size="${(result.byteLength / (1024 * 1024)).toFixed(1)}" data-markdown-limit="${MARKDOWN_PREVIEW_MAX_BYTES / (1024 * 1024)}"><strong>${escapeHtml(this.copy.largePreviewPaused)}</strong><span>${escapeHtml(this.copy.largePreviewDetail((result.byteLength / (1024 * 1024)).toFixed(1), MARKDOWN_PREVIEW_MAX_BYTES / (1024 * 1024)))}</span></div>`;
      this.attachMarkdownScrollSync();
    } catch (error) {
      if (request.request !== this.markdownPreviewSequence) return;
      const preview = this.root.querySelector<HTMLElement>("#markdown-preview");
      if (!preview) return;
      preview.innerHTML = `<div class="markdown-preview-message error" role="alert"><strong>${escapeHtml(this.copy.markdownFailed)}</strong><span>${escapeHtml(errorMessage(error))}</span></div>`;
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

  private localizeMountedSurface(previous: EditorCopy): void {
    const label = (selector: string, value: string) =>
      this.root.querySelector<HTMLElement>(selector)?.setAttribute("aria-label", value);
    label(".image-preview-surface", this.copy.imageSurface);
    label(".image-diff-surface", this.copy.imageDiff);
    label("#markdown-source-pane", this.copy.markdownSource);
    label("#markdown-splitter", this.copy.resizeMarkdown);
    label("#markdown-preview", this.copy.markdownPreview);
    const replacements = new Map([
      [previous.preview, this.copy.preview], [previous.before, this.copy.before], [previous.after, this.copy.after],
      [previous.renderingMarkdown, this.copy.renderingMarkdown], [previous.renderingMarkdownDetail, this.copy.renderingMarkdownDetail],
      [previous.largePreviewPaused, this.copy.largePreviewPaused], [previous.markdownFailed, this.copy.markdownFailed],
      [previous.loadingImage, this.copy.loadingImage], [previous.imageFailed, this.copy.imageFailed],
      [previous.loadingImageDiff, this.copy.loadingImageDiff], [previous.imageDiffFailed, this.copy.imageDiffFailed],
      [previous.fileDidNotExist, this.copy.fileDidNotExist], [previous.fileRemoved, this.copy.fileRemoved],
      [previous.workspaceReady, this.copy.workspaceReady], [previous.workspaceReadyDetail, this.copy.workspaceReadyDetail],
      [previous.loadingText, this.copy.loadingText], [previous.openTextFailed, this.copy.openTextFailed],
      [previous.fileLoadFailed, this.copy.fileLoadFailed], [previous.loadingPatch, this.copy.loadingPatch],
      [previous.patchLoadFailed, this.copy.patchLoadFailed], [previous.loadingCommitPatch, this.copy.loadingCommitPatch],
      [previous.tryAgain, this.copy.tryAgain],
    ]);
    this.root.querySelectorAll<HTMLElement>(".image-preview-card strong, .image-preview-empty, .markdown-preview-message strong, .markdown-preview-message span, .loading-block span:last-child, .empty-state strong, .empty-state p, .retry-button").forEach((element) => {
      const replacement = replacements.get(element.textContent ?? "");
      if (replacement) element.textContent = replacement;
    });
    const largePreview = this.root.querySelector<HTMLElement>("[data-markdown-size][data-markdown-limit]");
    if (largePreview) {
      const size = largePreview.dataset.markdownSize;
      const limit = Number(largePreview.dataset.markdownLimit);
      if (size && Number.isFinite(limit)) {
        const detail = largePreview.querySelector("span");
        if (detail) detail.textContent = this.copy.largePreviewDetail(size, limit);
      }
    }
    this.root.querySelectorAll<HTMLElement>(".image-preview-card[data-image-label][data-image-path]").forEach((card) => {
      const previousLabel = card.dataset.imageLabel;
      const path = card.dataset.imagePath;
      if (!previousLabel || !path) return;
      const nextLabel = previousLabel === previous.preview ? this.copy.preview
        : previousLabel === previous.before ? this.copy.before
          : previousLabel === previous.after ? this.copy.after : previousLabel;
      card.dataset.imageLabel = nextLabel;
      const image = card.querySelector<HTMLImageElement>("img");
      if (image) image.alt = this.copy.imageAlt(nextLabel, path);
    });
    this.root.querySelectorAll<HTMLElement>("[data-markdown-image-label]").forEach((placeholder) => {
      const label = placeholder.dataset.markdownImageLabel;
      if (!label) return;
      placeholder.setAttribute("aria-label", this.copy.blockedImage);
      placeholder.textContent = this.copy.imagePlaceholder(label);
    });
    this.root.querySelectorAll<HTMLElement>(".markdown-link").forEach((link) => {
      link.title = this.copy.linkUnavailable;
    });
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
