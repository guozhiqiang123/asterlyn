import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import type { StashCopy } from "../../localization/stash-copy.ts";
import { DEFAULT_LOCALIZATION, type Localization } from "../../localization/localization.ts";
import type { ChangeKind, CommitFileChange, StashEntry } from "../../models.ts";
import { compactDirectoryChain } from "../../presentation/compact-file-tree.ts";
import { sortFilesByName } from "../../presentation/file-name-order.ts";
import { buildCommitFileTree, type CommitFileTreeNode } from "../../presentation/git-presentation.ts";
import { stashDomKey, stashKey, type StashState } from "./stash-controller.ts";

export function renderStashList(state: StashState, copy: StashCopy, locale: string): string {
  if (state.loading && state.entries.length === 0) return message(copy.loading, true);
  if (state.error) return message(state.error, false, "retry-stash-catalog", copy.retry);
  if (state.entries.length === 0) return message(copy.empty, false);
  const warning = state.truncatedRepositoryIds.length > 0
    ? `<div class="stash-warning">${escapeHtml(copy.truncated)}</div>`
    : "";
  return `<div class="stash-list" role="listbox" aria-label="${escapeAttribute(copy.listAria)}">${state.entries.map((entry) => stashRow(entry, state.selectedKey === stashKey(entry), locale)).join("")}</div>${warning}`;
}

export function renderStashDetails(
  state: StashState,
  copy: StashCopy,
  localization: Localization = DEFAULT_LOCALIZATION,
): string {
  const entry = state.entries.find((candidate) => stashKey(candidate) === state.selectedKey) ?? null;
  if (!entry) return message(copy.selectStash, false);
  if (state.detailsLoading && !state.details) return message(copy.loadingFiles, true);
  if (state.detailsError) return message(state.detailsError, false, "retry-stash-details", copy.retry);
  const files = state.details?.files ?? [];
  const history = localization.catalog.history;
  const nextView = state.fileView === "tree" ? history.flatList : history.directoryTree;
  return `<div class="stash-detail">
    <div class="stash-detail-summary"><span>${icon("stash", 15)}</span><strong>${escapeHtml(entry.subject)}</strong><code>${escapeHtml(entry.reference)}</code></div>
    <div class="commit-files-toolbar"><span class="commit-files-label">${icon("folder", 13)}<span>${escapeHtml(history.files)}</span><b>${localization.number.format(files.length)}</b></span><button class="compact-icon-button" id="stash-file-view-toggle" type="button" aria-label="${escapeAttribute(history.showChangedFilesAs(nextView))}" aria-pressed="${state.fileView === "tree"}" title="${escapeAttribute(history.showChangedFilesAs(nextView))}">${icon("eye", 14)}</button><button class="compact-icon-button" id="stash-file-expand-all" type="button" aria-label="${escapeAttribute(history.expandChangedFolders)}" title="${escapeAttribute(history.expandChangedFolders)}" ${state.fileView === "flat" || files.length === 0 ? "disabled" : ""}>${icon("expand", 14)}</button><button class="compact-icon-button" id="stash-file-collapse-all" type="button" aria-label="${escapeAttribute(history.collapseChangedFolders)}" title="${escapeAttribute(history.collapseChangedFolders)}" ${state.fileView === "flat" || files.length === 0 ? "disabled" : ""}>${icon("collapse", 14)}</button></div>
    <div class="stash-files commit-file-list compact-file-tree ${state.fileView}" id="stash-file-list" role="listbox" aria-label="${escapeAttribute(copy.filesAria)}">${stashFileRows(state, entry, localization)}</div>
    <div class="stash-actions"><button class="primary-button" type="button" data-stash-action="apply">${escapeHtml(copy.apply)}</button><button class="secondary-button" type="button" data-stash-action="pop">${escapeHtml(copy.pop)}</button></div>
  </div>`;
}

function stashRow(entry: StashEntry, selected: boolean, locale: string): string {
  const date = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(entry.authoredAt * 1000));
  return `<button class="stash-row ${selected ? "selected" : ""}" type="button" role="option" aria-selected="${selected}" data-stash-key="${escapeAttribute(stashDomKey(entry))}" title="${escapeAttribute(`${entry.reference} · ${entry.subject}`)}"><span>${icon("stash", 15)}</span><strong>${escapeHtml(entry.subject)}</strong><time>${escapeHtml(date)}</time><code>${escapeHtml(entry.reference)}</code></button>`;
}

function stashFileRows(state: StashState, entry: StashEntry, localization: Localization): string {
  const files = state.details?.files ?? [];
  if (files.length === 0) return `<div class="stash-empty-files">${escapeHtml(localization.catalog.stash.noFiles)}</div>`;
  if (state.fileView === "flat") {
    return sortFilesByName(files)
      .map((file) => stashFileRow(file, file.path === state.selectedFile, null, localization)).join("");
  }
  const expanded = !state.collapsedDirectories.has(".");
  const rootName = entry.repositoryId === "." ? basename(state.root ?? entry.repositoryId) : basename(entry.repositoryId);
  const count = localization.catalog.history.fileCount(files.length);
  return `<div class="commit-file-tree compact-file-tree" role="tree" aria-label="${escapeAttribute(localization.catalog.history.changedFilesByDirectory)}"><details class="commit-file-directory commit-file-root" data-stash-file-directory="." data-stash-file-rendered-expanded="${expanded}" ${expanded ? "open" : ""}><summary style="--tree-depth:0"><span class="tree-chevron">${icon("chevron", 12)}</span>${icon("folder", 15)}<span>${escapeHtml(rootName)}</span><small class="compact-file-tree-count">${escapeHtml(count)}</small></summary><div role="group">${expanded ? buildCommitFileTree(files).map((node) => stashFileTreeNode(node, 1, state, localization)).join("") : ""}</div></details></div>`;
}

function stashFileTreeNode(node: CommitFileTreeNode, depth: number, state: StashState, localization: Localization): string {
  if (node.kind === "directory") {
    const chain = compactDirectoryChain(node);
    const expanded = !state.collapsedDirectories.has(chain.terminal.path);
    const count = localization.catalog.history.fileCount(chain.fileCount);
    return `<details class="commit-file-directory" data-stash-file-directory="${escapeAttribute(chain.terminal.path)}" data-stash-file-rendered-expanded="${expanded}" ${expanded ? "open" : ""}><summary style="--tree-depth:${depth}" title="${escapeAttribute(chain.terminal.path)}"><span class="tree-chevron">${icon("chevron", 12)}</span>${icon("folder", 15)}<span>${escapeHtml(chain.label)}</span><small class="compact-file-tree-count">${escapeHtml(count)}</small></summary><div role="group">${expanded ? chain.terminal.children.map((child) => stashFileTreeNode(child, depth + 1, state, localization)).join("") : ""}</div></details>`;
  }
  return stashFileRow(node.file!, node.file!.path === state.selectedFile, depth, localization);
}

function stashFileRow(file: CommitFileChange, selected: boolean, depth: number | null, localization: Localization): string {
  const previous = file.originalPath ? `<span class="commit-file-origin">${escapeHtml(file.originalPath)} →</span>` : "";
  const tree = depth !== null;
  const directory = dirname(file.path);
  return `<button class="commit-file-row file-status-${file.status} ${tree ? "tree-row" : "flat-row"} ${selected ? "selected" : ""}" type="button" role="option" ${tree ? `style="--tree-depth:${depth}"` : ""} aria-selected="${selected}" data-stash-file="${escapeAttribute(file.path)}" title="${escapeAttribute(file.path)}"><span class="change-status status-${file.status}" title="${escapeAttribute(localization.catalog.changes.changeLabels[file.status])}">${changeCode(file.status)}</span><span class="commit-file-glyph">${fileTypeIcon(file.path)}</span><span class="change-path">${previous}<span class="file-name">${escapeHtml(basename(file.path))}</span>${tree ? "" : `<span class="file-directory">${escapeHtml(directory)}</span>`}</span></button>`;
}

export function stashFileDirectoryPaths(nodes: readonly CommitFileTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    const chain = compactDirectoryChain(node);
    paths.push(chain.terminal.path, ...stashFileDirectoryPaths(chain.terminal.children));
  }
  return paths;
}

function message(text: string, loading: boolean, actionId?: string, actionLabel?: string): string {
  return `<div class="stash-message">${loading ? '<span class="spinner"></span>' : icon("stash", 24)}<span>${escapeHtml(text)}</span>${actionId ? `<button class="secondary-button" id="${actionId}" type="button">${escapeHtml(actionLabel ?? "")}</button>` : ""}</div>`;
}

function changeCode(status: ChangeKind): string {
  return ({ unmodified: "·", added: "A", modified: "M", deleted: "D", renamed: "R", copied: "C", typeChanged: "T", unmerged: "U", untracked: "?", ignored: "!", unknown: "·" })[status];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

const escapeAttribute = escapeHtml;

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function dirname(path: string): string {
  const parts = path.split("/").filter(Boolean); parts.pop(); return parts.join("/");
}
