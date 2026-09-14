import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import type { ImagePreview } from "../../models.ts";
import { editorDocumentKey, type EditorDocument } from "../../workbench/editor-document.ts";
import {
  isTextTabDirty,
  type EditorSession,
  type MarkdownEditorMode,
  type TextTabState,
} from "../../workbench/editor-session.ts";
import type { AppPreferences } from "../../workbench/preferences.ts";
import type { EditorCopy } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";

export interface EditorTabsViewModel {
  readonly session: EditorSession;
  readonly document: EditorDocument;
  readonly statusClass: (workspacePath: string) => string;
  readonly copy?: EditorCopy;
}

export interface EditorTabMenuViewModel {
  readonly session: EditorSession;
  readonly open: boolean;
  readonly statusClass: (workspacePath: string) => string;
  readonly copy?: EditorCopy;
}

export interface DiffControlsViewModel {
  readonly imageDiff: boolean;
  readonly textReady: boolean;
  readonly previousFile: string | null;
  readonly nextFile: string | null;
  readonly canOpenSource: boolean;
  readonly expanded: boolean;
  readonly preferences: Pick<AppPreferences, "diffLayout" | "showWhitespace">;
  readonly copy?: EditorCopy;
}

export function renderEditorTabs(model: EditorTabsViewModel): string {
  const copy = model.copy ?? EN_US.editor;
  const textTabs = model.session.textTabs.map((tab, index) => {
    const active = model.document.kind === "project-file" && editorDocumentKey(model.document) === tab.id;
    const dirty = isTextTabDirty(tab);
    const state = tab.conflict ? copy.conflict : tab.saveRequest ? copy.saving : dirty ? copy.unsaved : copy.saved;
    return `<div class="editor-tab ${model.statusClass(tab.document.workspacePath)} ${active ? "active" : ""} ${dirty ? "dirty" : ""}" role="tab" aria-selected="${active}" data-editor-tab="${index}" title="${escapeAttribute(`${tab.document.workspacePath} · ${state}`)}">
      <button class="editor-tab-target" type="button" data-editor-tab-index="${index}">
        <span class="editor-tab-file-icon">${fileTypeIcon(tab.document.workspacePath)}</span>
        <span class="editor-tab-label">${escapeHtml(basename(tab.document.workspacePath))}</span>
        ${dirty ? `<span class="editor-dirty-dot" aria-label="${escapeAttribute(copy.unsaved)}"></span>` : ""}
      </button>
      <button class="editor-tab-close" type="button" data-close-editor-tab-index="${index}" aria-label="${escapeAttribute(copy.closeFile(basename(tab.document.workspacePath)))}" title="${escapeAttribute(copy.close)}">${icon("close", 12)}</button>
    </div>`;
  }).join("");
  const preview = model.session.preview;
  const previewPath = preview?.kind === "working-diff" ? preview.selection.path : preview?.path;
  const previewLabel = preview?.kind === "project-image" ? copy.preview : copy.diff;
  const previewTab = preview
    ? `<div class="editor-tab preview ${previewStatusClass(preview, model.statusClass)} ${model.session.active.kind === "preview" ? "active" : ""}" role="tab" aria-selected="${model.session.active.kind === "preview"}">
        <button class="editor-tab-target" type="button" data-editor-preview><span class="editor-tab-file-icon">${preview.kind === "project-image" ? fileTypeIcon(preview.path) : icon("changes", 14)}</span>${escapeHtml(basename(previewPath ?? previewLabel))}<small>${previewLabel}</small></button>
        <button class="editor-tab-close" type="button" data-close-editor-preview aria-label="${escapeAttribute(copy.closePreview(previewLabel))}" title="${escapeAttribute(copy.close)}">${icon("close", 12)}</button>
      </div>`
    : "";
  return textTabs || previewTab ? `${textTabs}${previewTab}` : `<span class="editor-tab active">${escapeHtml(copy.welcome)}</span>`;
}

export function renderEditorTabMenu(model: EditorTabMenuViewModel): string {
  if (!model.open) return "";
  const copy = model.copy ?? EN_US.editor;
  const textItems = model.session.textTabs.map((tab, index) => {
    const active = model.session.active.kind === "text" && model.session.active.id === tab.id;
    const dirty = isTextTabDirty(tab);
    return `<button class="editor-tab-menu-item ${model.statusClass(tab.document.workspacePath)} ${active ? "active" : ""}" type="button" role="menuitem" data-editor-menu-tab-index="${index}" title="${escapeAttribute(tab.document.workspacePath)}"><span class="editor-tab-menu-glyph">${fileTypeIcon(tab.document.workspacePath)}</span><span class="editor-tab-menu-copy"><strong>${escapeHtml(basename(tab.document.workspacePath))}</strong><small>${escapeHtml(tab.document.workspacePath)}</small></span>${dirty ? `<span class="editor-dirty-dot" aria-label="${escapeAttribute(copy.unsaved)}"></span>` : ""}${active ? icon("check", 14) : ""}</button>`;
  }).join("");
  const preview = model.session.preview;
  const previewPath = preview?.kind === "working-diff" ? preview.selection.path : preview?.path;
  const previewLabel = preview?.kind === "project-image" ? copy.imagePreview : copy.diffPreview;
  const previewItem = preview
    ? `<button class="editor-tab-menu-item ${previewStatusClass(preview, model.statusClass)} ${model.session.active.kind === "preview" ? "active" : ""}" type="button" role="menuitem" data-editor-menu-preview title="${escapeAttribute(previewPath ?? previewLabel)}"><span class="editor-tab-menu-glyph">${preview.kind === "project-image" ? fileTypeIcon(preview.path) : icon("changes", 14)}</span><span class="editor-tab-menu-copy"><strong>${escapeHtml(basename(previewPath ?? previewLabel))}</strong><small>${previewLabel}</small></span>${model.session.active.kind === "preview" ? icon("check", 14) : ""}</button>`
    : "";
  return `${textItems}${previewItem}`;
}

export function renderMarkdownModeControls(tab: TextTabState | null, copy: EditorCopy = EN_US.editor): string {
  if (!tab) return "";
  const modes: Array<[MarkdownEditorMode, string, string]> = [
    ["source", copy.source, copy.sourceTitle],
    ["split", copy.split, copy.splitTitle],
    ["preview", copy.renderedPreview, copy.previewTitle],
  ];
  return `<div class="markdown-mode-controls" role="group" aria-label="${escapeAttribute(copy.markdownMode)}">${modes.map(([mode, label, title]) => `<button type="button" data-markdown-mode="${mode}" aria-pressed="${tab.markdownMode === mode}" title="${escapeAttribute(title)}">${escapeHtml(label)}</button>`).join("")}</div>`;
}

export function renderDiffControls(model: DiffControlsViewModel): string {
  const copy = model.copy ?? EN_US.editor;
  return `<div class="diff-toolbar" aria-label="${escapeAttribute(copy.diffToolbar)}">
    <div class="diff-navigation-controls" role="group" aria-label="${escapeAttribute(copy.diffNavigation)}">
      <button class="compact-icon-button" type="button" data-diff-action="previous-change" aria-label="${escapeAttribute(copy.previousChange)}" title="${escapeAttribute(copy.previousChange)}" ${model.textReady ? "" : "disabled"}>${icon("up", 15)}</button>
      <button class="compact-icon-button" type="button" data-diff-action="next-change" aria-label="${escapeAttribute(copy.nextChange)}" title="${escapeAttribute(copy.nextChange)}" ${model.textReady ? "" : "disabled"}>${icon("down", 15)}</button>
      <span class="diff-control-separator" aria-hidden="true"></span>
      <button class="compact-icon-button" type="button" data-diff-action="previous-file" aria-label="${escapeAttribute(copy.previousFile)}" title="${escapeAttribute(copy.previousFile)}" ${model.previousFile ? "" : "disabled"}>${icon("back", 15)}</button>
      <button class="compact-icon-button" type="button" data-diff-action="next-file" aria-label="${escapeAttribute(copy.nextFile)}" title="${escapeAttribute(copy.nextFile)}" ${model.nextFile ? "" : "disabled"}>${icon("forward", 15)}</button>
      <button class="compact-icon-button" type="button" data-diff-action="open-source" aria-label="${escapeAttribute(copy.openSource)}" title="${escapeAttribute(copy.openSource)}" ${model.canOpenSource ? "" : "disabled"}>${icon("locate", 15)}</button>
      <button class="compact-icon-button ${model.expanded ? "active" : ""}" type="button" data-diff-action="toggle-unchanged" aria-label="${escapeAttribute(model.expanded ? copy.collapseUnchanged : copy.expandUnchanged)}" title="${escapeAttribute(model.expanded ? copy.collapseUnchanged : copy.expandUnchanged)}" aria-pressed="${model.expanded}" ${model.textReady ? "" : "disabled"}>${icon(model.expanded ? "collapse" : "expand", 15)}</button>
    </div>
    ${model.imageDiff ? "" : `<div class="diff-controls" role="group" aria-label="${escapeAttribute(copy.diffPresentation)}">
      <button type="button" data-diff-layout="unified" aria-pressed="${model.preferences.diffLayout === "unified"}" title="${escapeAttribute(copy.unifiedTitle)}">${escapeHtml(copy.unified)}</button>
      <button type="button" data-diff-layout="split" aria-pressed="${model.preferences.diffLayout === "split"}" title="${escapeAttribute(copy.sideBySideTitle)}">${escapeHtml(copy.sideBySide)}</button>
      <button type="button" data-diff-whitespace aria-pressed="${model.preferences.showWhitespace}" title="${escapeAttribute(copy.whitespaceTitle)}">${escapeHtml(copy.whitespace)}</button>
    </div>`}
  </div>`;
}

export function contentHeading(title: string, subtitle: string): string {
  return `<div class="content-title-group"><h2>${escapeHtml(title)}</h2><small>${escapeHtml(subtitle)}</small></div>`;
}

export function imagePreviewCard(image: ImagePreview, label: string, copy: EditorCopy = EN_US.editor): string {
  return `<figure class="image-preview-card" data-image-label="${escapeAttribute(label)}" data-image-path="${escapeAttribute(image.path)}"><figcaption><strong>${escapeHtml(label)}</strong><span>${image.width} × ${image.height} · ${formatBytes(image.byteLength)}</span></figcaption><div class="image-preview-canvas"><img src="${escapeAttribute(image.dataUrl)}" alt="${escapeAttribute(copy.imageAlt(label, image.path))}" draggable="false" /></div></figure>`;
}

export function emptyImageSide(label: string, message: string): string {
  return `<section class="image-preview-card empty"><header><strong>${escapeHtml(label)}</strong></header><div class="image-preview-empty">${escapeHtml(message)}</div></section>`;
}

export function markdownPreviewLoadingBlock(copy: EditorCopy = EN_US.editor): string {
  return `<div class="markdown-preview-message" role="status"><strong>${escapeHtml(copy.renderingMarkdown)}</strong><span>${escapeHtml(copy.renderingMarkdownDetail)}</span></div>`;
}

export function emptyState(
  title: string,
  detail: string,
  iconName: "folder" | "history" | "changes" = "folder",
): string {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName, 24)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

export function loadingBlock(label: string): string {
  return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

export function retryState(
  title: string,
  detail: string,
  retryId: string,
  iconName: "folder" | "history" | "changes",
  copy: EditorCopy = EN_US.editor,
): string {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName, 24)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p><button class="secondary-button retry-button" id="${retryId}" type="button">${escapeHtml(copy.tryAgain)}</button></div>`;
}

function previewStatusClass(
  preview: NonNullable<EditorSession["preview"]>,
  statusClass: (workspacePath: string) => string,
): string {
  return preview.kind === "working-diff"
    ? statusClass(preview.selection.path)
    : preview.kind === "project-image"
      ? statusClass(preview.workspacePath)
      : "";
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
  return normalized.split("/").pop() || normalized;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
