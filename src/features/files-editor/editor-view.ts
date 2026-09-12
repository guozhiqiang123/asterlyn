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

export interface EditorTabsViewModel {
  readonly session: EditorSession;
  readonly document: EditorDocument;
  readonly statusClass: (workspacePath: string) => string;
}

export interface EditorTabMenuViewModel {
  readonly session: EditorSession;
  readonly open: boolean;
  readonly statusClass: (workspacePath: string) => string;
}

export interface DiffControlsViewModel {
  readonly imageDiff: boolean;
  readonly textReady: boolean;
  readonly previousFile: string | null;
  readonly nextFile: string | null;
  readonly canOpenSource: boolean;
  readonly expanded: boolean;
  readonly preferences: Pick<AppPreferences, "diffLayout" | "showWhitespace">;
}

export function renderEditorTabs(model: EditorTabsViewModel): string {
  const textTabs = model.session.textTabs.map((tab, index) => {
    const active = model.document.kind === "project-file" && editorDocumentKey(model.document) === tab.id;
    const dirty = isTextTabDirty(tab);
    const state = tab.conflict ? "Conflict" : tab.saveRequest ? "Saving" : dirty ? "Unsaved" : "Saved";
    return `<div class="editor-tab ${model.statusClass(tab.document.workspacePath)} ${active ? "active" : ""} ${dirty ? "dirty" : ""}" role="tab" aria-selected="${active}" data-editor-tab="${index}" title="${escapeAttribute(`${tab.document.workspacePath} · ${state}`)}">
      <button class="editor-tab-target" type="button" data-editor-tab-index="${index}">
        <span class="editor-tab-file-icon">${fileTypeIcon(tab.document.workspacePath)}</span>
        <span class="editor-tab-label">${escapeHtml(basename(tab.document.workspacePath))}</span>
        ${dirty ? '<span class="editor-dirty-dot" aria-label="Unsaved"></span>' : ""}
      </button>
      <button class="editor-tab-close" type="button" data-close-editor-tab-index="${index}" aria-label="Close ${escapeAttribute(basename(tab.document.workspacePath))}" title="Close">${icon("close", 12)}</button>
    </div>`;
  }).join("");
  const preview = model.session.preview;
  const previewPath = preview?.kind === "working-diff" ? preview.selection.path : preview?.path;
  const previewLabel = preview?.kind === "project-image" ? "Preview" : "Diff";
  const previewTab = preview
    ? `<div class="editor-tab preview ${previewStatusClass(preview, model.statusClass)} ${model.session.active.kind === "preview" ? "active" : ""}" role="tab" aria-selected="${model.session.active.kind === "preview"}">
        <button class="editor-tab-target" type="button" data-editor-preview><span class="editor-tab-file-icon">${preview.kind === "project-image" ? fileTypeIcon(preview.path) : icon("changes", 14)}</span>${escapeHtml(basename(previewPath ?? previewLabel))}<small>${previewLabel}</small></button>
        <button class="editor-tab-close" type="button" data-close-editor-preview aria-label="Close ${previewLabel} preview" title="Close">${icon("close", 12)}</button>
      </div>`
    : "";
  return textTabs || previewTab ? `${textTabs}${previewTab}` : '<span class="editor-tab active">Welcome</span>';
}

export function renderEditorTabMenu(model: EditorTabMenuViewModel): string {
  if (!model.open) return "";
  const textItems = model.session.textTabs.map((tab, index) => {
    const active = model.session.active.kind === "text" && model.session.active.id === tab.id;
    const dirty = isTextTabDirty(tab);
    return `<button class="editor-tab-menu-item ${model.statusClass(tab.document.workspacePath)} ${active ? "active" : ""}" type="button" role="menuitem" data-editor-menu-tab-index="${index}" title="${escapeAttribute(tab.document.workspacePath)}"><span class="editor-tab-menu-glyph">${fileTypeIcon(tab.document.workspacePath)}</span><span class="editor-tab-menu-copy"><strong>${escapeHtml(basename(tab.document.workspacePath))}</strong><small>${escapeHtml(tab.document.workspacePath)}</small></span>${dirty ? '<span class="editor-dirty-dot" aria-label="Unsaved"></span>' : ""}${active ? icon("check", 14) : ""}</button>`;
  }).join("");
  const preview = model.session.preview;
  const previewPath = preview?.kind === "working-diff" ? preview.selection.path : preview?.path;
  const previewLabel = preview?.kind === "project-image" ? "Image preview" : "Diff preview";
  const previewItem = preview
    ? `<button class="editor-tab-menu-item ${previewStatusClass(preview, model.statusClass)} ${model.session.active.kind === "preview" ? "active" : ""}" type="button" role="menuitem" data-editor-menu-preview title="${escapeAttribute(previewPath ?? previewLabel)}"><span class="editor-tab-menu-glyph">${preview.kind === "project-image" ? fileTypeIcon(preview.path) : icon("changes", 14)}</span><span class="editor-tab-menu-copy"><strong>${escapeHtml(basename(previewPath ?? previewLabel))}</strong><small>${previewLabel}</small></span>${model.session.active.kind === "preview" ? icon("check", 14) : ""}</button>`
    : "";
  return `${textItems}${previewItem}`;
}

export function renderMarkdownModeControls(tab: TextTabState | null): string {
  if (!tab) return "";
  const modes: Array<[MarkdownEditorMode, string, string]> = [
    ["source", "Source", "Edit Markdown source"],
    ["split", "Split", "Edit source with live preview"],
    ["preview", "Preview", "Rendered preview (read-only)"],
  ];
  return `<div class="markdown-mode-controls" role="group" aria-label="Markdown editor mode">${modes.map(([mode, label, title]) => `<button type="button" data-markdown-mode="${mode}" aria-pressed="${tab.markdownMode === mode}" title="${title}">${label}</button>`).join("")}</div>`;
}

export function renderDiffControls(model: DiffControlsViewModel): string {
  return `<div class="diff-toolbar" aria-label="Diff navigation and presentation">
    <div class="diff-navigation-controls" role="group" aria-label="Diff navigation">
      <button class="compact-icon-button" type="button" data-diff-action="previous-change" aria-label="Previous change in file" title="Previous change in file" ${model.textReady ? "" : "disabled"}>${icon("up", 15)}</button>
      <button class="compact-icon-button" type="button" data-diff-action="next-change" aria-label="Next change in file" title="Next change in file" ${model.textReady ? "" : "disabled"}>${icon("down", 15)}</button>
      <span class="diff-control-separator" aria-hidden="true"></span>
      <button class="compact-icon-button" type="button" data-diff-action="previous-file" aria-label="Previous changed file" title="Previous changed file" ${model.previousFile ? "" : "disabled"}>${icon("back", 15)}</button>
      <button class="compact-icon-button" type="button" data-diff-action="next-file" aria-label="Next changed file" title="Next changed file" ${model.nextFile ? "" : "disabled"}>${icon("forward", 15)}</button>
      <button class="compact-icon-button" type="button" data-diff-action="open-source" aria-label="Open file and reveal in Project" title="Open file and reveal in Project" ${model.canOpenSource ? "" : "disabled"}>${icon("locate", 15)}</button>
      <button class="compact-icon-button ${model.expanded ? "active" : ""}" type="button" data-diff-action="toggle-unchanged" aria-label="${model.expanded ? "Collapse" : "Expand"} unchanged lines" title="${model.expanded ? "Collapse" : "Expand"} unchanged lines" aria-pressed="${model.expanded}" ${model.textReady ? "" : "disabled"}>${icon(model.expanded ? "collapse" : "expand", 15)}</button>
    </div>
    ${model.imageDiff ? "" : `<div class="diff-controls" role="group" aria-label="Diff presentation">
      <button type="button" data-diff-layout="unified" aria-pressed="${model.preferences.diffLayout === "unified"}" title="Unified diff">Unified</button>
      <button type="button" data-diff-layout="split" aria-pressed="${model.preferences.diffLayout === "split"}" title="Side-by-side diff">Split</button>
      <button type="button" data-diff-whitespace aria-pressed="${model.preferences.showWhitespace}" title="Show whitespace characters">Whitespace</button>
    </div>`}
  </div>`;
}

export function contentHeading(title: string, subtitle: string): string {
  return `<div class="content-title-group"><span class="content-kicker">${escapeHtml(subtitle)}</span><h2>${escapeHtml(title)}</h2></div>`;
}

export function imagePreviewCard(image: ImagePreview, label: string): string {
  return `<figure class="image-preview-card"><figcaption><strong>${escapeHtml(label)}</strong><span>${image.width} × ${image.height} · ${formatBytes(image.byteLength)}</span></figcaption><div class="image-preview-canvas"><img src="${escapeAttribute(image.dataUrl)}" alt="${escapeAttribute(`${label} image for ${image.path}`)}" draggable="false" /></div></figure>`;
}

export function emptyImageSide(label: string, message: string): string {
  return `<section class="image-preview-card empty"><header><strong>${escapeHtml(label)}</strong></header><div class="image-preview-empty">${escapeHtml(message)}</div></section>`;
}

export function markdownPreviewLoadingBlock(): string {
  return '<div class="markdown-preview-message" role="status"><strong>Rendering Markdown…</strong><span>The editor remains available while the preview engine loads.</span></div>';
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
): string {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName, 24)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p><button class="secondary-button retry-button" id="${retryId}" type="button">Try again</button></div>`;
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
