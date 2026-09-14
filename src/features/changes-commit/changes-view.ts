import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import type { FileChange, RepositorySnapshot } from "../../models.ts";
import {
  buildChangeFileTree,
  changeGroup,
  descendantChangePaths,
  effectiveChangeKind,
  type ChangeFileTreeNode,
  type ChangeGroupId,
} from "../../workbench/change-presentation.ts";
import type { ChangesCommitState } from "./changes-commit-controller.ts";
import type { ChangesCopy } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";

export const CHANGE_TREE_MOUNT_LIMIT = 200;
export const CHANGE_TREE_ROW_HEIGHT = 28;
const CHANGE_TREE_OVERSCAN = 32;

export type ChangeViewRow =
  | {
      kind: "group";
      group: ChangeGroupId;
      title: string;
      changes: FileChange[];
      collapsed: boolean;
    }
  | {
      kind: "directory";
      group: ChangeGroupId;
      node: ChangeFileTreeNode;
      depth: number;
      key: string;
      paths: string[];
      collapsed: boolean;
    }
  | {
      kind: "file";
      group: ChangeGroupId;
      change: FileChange;
      depth: number | null;
    };

export interface ChangeTreeRenderWindow {
  start: number;
  end: number;
}

export function renderChangeNavigation(
  snapshot: RepositorySnapshot,
  state: ChangesCommitState,
  scrollTop = 0,
  clientHeight = 0,
  copy: ChangesCopy = EN_US.changes,
): string {
  return `<div class="changes-navigation">
    ${renderChangeToolbar(snapshot, state, copy)}
    <div class="change-results" id="change-results">
      ${renderChangeResults(snapshot, state, scrollTop, clientHeight, copy)}
    </div>
  </div>`;
}

export function changeViewRows(
  snapshot: RepositorySnapshot,
  state: ChangesCommitState,
  copy: ChangesCopy = EN_US.changes,
): ChangeViewRow[] {
  const rows: ChangeViewRow[] = [];
  appendGroupRows(rows, copy.groups.changes, "changes", snapshot.changes, state);
  appendGroupRows(rows, copy.groups.unversioned, "unversioned", snapshot.changes, state);
  return rows;
}

export function changeDisclosureKeys(snapshot: RepositorySnapshot): string[] {
  const keys: string[] = [];
  for (const group of ["changes", "unversioned"] as const) {
    const changes = snapshot.changes.filter((change) => changeGroup(change) === group);
    if (changes.length === 0) continue;
    keys.push(`group:${group}`);
    const visit = (node: ChangeFileTreeNode): void => {
      if (node.kind !== "directory") return;
      keys.push(`directory:${group}:${node.path}`);
      for (const child of node.children) visit(child);
    };
    for (const node of buildChangeFileTree(changes)) visit(node);
  }
  return keys;
}

export function changeTreeRenderWindow(
  rowCount: number,
  scrollTop: number,
  clientHeight: number,
): ChangeTreeRenderWindow | null {
  if (rowCount <= CHANGE_TREE_MOUNT_LIMIT) return null;
  const visible = Math.max(
    1,
    Math.ceil(Math.max(0, clientHeight) / CHANGE_TREE_ROW_HEIGHT),
  );
  const size = Math.min(
    CHANGE_TREE_MOUNT_LIMIT,
    Math.max(72, visible + CHANGE_TREE_OVERSCAN * 2),
  );
  const anchor = Math.max(
    0,
    Math.floor(Math.max(0, scrollTop) / CHANGE_TREE_ROW_HEIGHT),
  );
  const start = Math.min(
    Math.max(0, Math.floor(Math.max(0, anchor - CHANGE_TREE_OVERSCAN) / 24) * 24),
    Math.max(0, rowCount - size),
  );
  return { start, end: Math.min(rowCount, start + size) };
}

function renderChangeToolbar(
  snapshot: RepositorySnapshot,
  state: ChangesCommitState,
  copy: ChangesCopy,
): string {
  const selected = state.selectedChange
    ? snapshot.changes.find((change) => change.path === state.selectedChange?.path) ?? null
    : null;
  const revertUnsupported = !changeSupportsRestore(snapshot, selected);
  const nextView = state.fileView === "tree" ? copy.flatList : copy.directoryTree;
  return `<div class="change-toolbar" role="toolbar" aria-label="${escapeAttribute(copy.commitFileActions)}">
    <button class="compact-icon-button" type="button" data-change-action="refresh" title="${escapeAttribute(copy.refreshChanges)}" aria-label="${escapeAttribute(copy.refreshChanges)}">${icon("refresh", 15)}</button>
    <button class="compact-icon-button" type="button" data-change-action="revert" title="${escapeAttribute(revertUnsupported ? copy.selectTrackedToRestore : copy.restoreToHead)}" aria-label="${escapeAttribute(copy.restoreChanges)}" ${revertUnsupported ? "disabled" : ""}>${icon("revert", 15)}</button>
    <button class="compact-icon-button" type="button" data-change-action="diff" title="${escapeAttribute(copy.openSelectedDiff)}" aria-label="${escapeAttribute(copy.openSelectedDiff)}" ${selected ? "" : "disabled"}>${icon("diff", 15)}</button>
    <span class="toolbar-separator" aria-hidden="true"></span>
    <button class="compact-icon-button ${state.fileView === "tree" ? "active" : ""}" type="button" data-change-action="view" title="${escapeAttribute(copy.showAs(nextView))}" aria-label="${escapeAttribute(copy.showAs(nextView))}" aria-pressed="${state.fileView === "tree"}">${icon("eye", 15)}</button>
    <button class="compact-icon-button" type="button" data-change-action="expand" title="${escapeAttribute(copy.expandAll)}" aria-label="${escapeAttribute(copy.expandAll)}" ${state.fileView === "flat" ? "disabled" : ""}>${icon("expand", 15)}</button>
    <button class="compact-icon-button" type="button" data-change-action="collapse" title="${escapeAttribute(copy.collapseAll)}" aria-label="${escapeAttribute(copy.collapseAll)}" ${state.fileView === "flat" ? "disabled" : ""}>${icon("collapse", 15)}</button>
  </div>`;
}

export function changeSupportsRestore(
  snapshot: RepositorySnapshot,
  selected: FileChange | null,
): boolean {
  return Boolean(
    selected &&
    !snapshot.branch.unborn &&
    !selected.conflicted &&
    !selected.submodule &&
    selected.worktreeStatus !== "untracked" &&
    selected.indexStatus !== "copied",
  );
}

function renderChangeResults(
  snapshot: RepositorySnapshot,
  state: ChangesCommitState,
  scrollTop: number,
  clientHeight: number,
  copy: ChangesCopy,
): string {
  if (snapshot.changes.length === 0) {
    if (snapshot.untrackedState === "pending") {
      return `<div class="change-no-results"><span class="spinner"></span><strong>${escapeHtml(copy.checkingUntracked)}</strong><span>${escapeHtml(copy.trackedReady)}</span></div>`;
    }
    if (snapshot.untrackedState === "failed") {
      return `<div class="change-no-results"><strong>${escapeHtml(copy.untrackedFailed)}</strong><span>${escapeHtml(copy.refreshToRetry)}</span></div>`;
    }
    return `<div class="change-no-results"><span class="empty-icon">${icon("check", 22)}</span><strong>${escapeHtml(copy.workingTreeClean)}</strong><span>${escapeHtml(copy.noLocalChanges)}</span></div>`;
  }
  const rows = changeViewRows(snapshot, state, copy);
  const window = changeTreeRenderWindow(rows.length, scrollTop, clientHeight);
  const visible = window ? rows.slice(window.start, window.end) : rows;
  const topSpacer = window && window.start > 0
    ? `<div class="change-virtual-spacer" aria-hidden="true" style="height:${window.start * CHANGE_TREE_ROW_HEIGHT}px"></div>`
    : "";
  const bottomCount = window ? rows.length - window.end : 0;
  const bottomSpacer = bottomCount > 0
    ? `<div class="change-virtual-spacer" aria-hidden="true" style="height:${bottomCount * CHANGE_TREE_ROW_HEIGHT}px"></div>`
    : "";
  return `<div class="change-list virtual-tree" role="tree" aria-label="${escapeAttribute(copy.changedFiles)}" aria-rowcount="${rows.length}">${topSpacer}${visible.map((row, offset) => renderChangeRow(state, row, (window?.start ?? 0) + offset, rows.length, copy)).join("")}${bottomSpacer}</div>${untrackedScanNotice(snapshot, copy)}`;
}

function appendGroupRows(
  rows: ChangeViewRow[],
  title: string,
  group: ChangeGroupId,
  allChanges: FileChange[],
  state: ChangesCommitState,
): void {
  const changes = allChanges.filter((change) => changeGroup(change) === group);
  if (changes.length === 0) return;
  const collapsed = state.collapsedDirectories.has(`group:${group}`);
  rows.push({ kind: "group", group, title, changes, collapsed });
  if (collapsed) return;
  if (state.fileView === "flat") {
    for (const change of [...changes].sort((left, right) => left.path.localeCompare(right.path))) {
      rows.push({ kind: "file", group, change, depth: null });
    }
    return;
  }
  const visit = (node: ChangeFileTreeNode, depth: number): void => {
    if (node.kind === "file") {
      rows.push({ kind: "file", group, change: node.change!, depth });
      return;
    }
    const key = `directory:${group}:${node.path}`;
    const collapsedDirectory = state.collapsedDirectories.has(key);
    rows.push({
      kind: "directory",
      group,
      node,
      depth,
      key,
      paths: descendantChangePaths(node),
      collapsed: collapsedDirectory,
    });
    if (!collapsedDirectory) for (const child of node.children) visit(child, depth + 1);
  };
  for (const node of buildChangeFileTree(changes)) visit(node, 1);
}

function renderChangeRow(
  state: ChangesCommitState,
  row: ChangeViewRow,
  index: number,
  rowCount: number,
  copy: ChangesCopy,
): string {
  const position = `aria-posinset="${index + 1}" aria-setsize="${rowCount}"`;
  if (row.kind === "group") {
    return `<div class="change-group virtual" role="treeitem" ${position} aria-expanded="${!row.collapsed}">
      <div class="group-header">
        <input class="change-checkbox" type="checkbox" data-include-group="${row.group}" aria-label="${escapeAttribute(copy.includeAll(row.title))}" />
        <button class="change-tree-toggle" type="button" data-change-disclosure="group:${row.group}" aria-label="${escapeAttribute(row.collapsed ? copy.expand(row.title) : copy.collapse(row.title))}"><span class="tree-chevron ${row.collapsed ? "" : "expanded"}">${icon("chevron", 11)}</span></button>
        <span class="group-title">${escapeHtml(row.title)}<b>${escapeHtml(copy.fileCount(row.changes.length))}</b></span>
      </div>
    </div>`;
  }
  if (row.kind === "directory") {
    return `<div class="change-directory virtual" role="treeitem" ${position} aria-expanded="${!row.collapsed}">
      <div class="change-directory-row" style="--tree-depth:${row.depth}">
        <input class="change-checkbox" type="checkbox" data-include-directory="${escapeAttribute(row.node.path)}" data-include-directory-group="${row.group}" aria-label="${escapeAttribute(copy.include(row.node.path))}" />
        <button class="change-tree-toggle" type="button" data-change-disclosure="${escapeAttribute(row.key)}" aria-label="${escapeAttribute(row.collapsed ? copy.expand(row.node.path) : copy.collapse(row.node.path))}"><span class="tree-chevron ${row.collapsed ? "" : "expanded"}">${icon("chevron", 11)}</span></button>
        ${icon("folder", 14)}<span>${escapeHtml(row.node.name)}</span><small>${row.paths.length}</small>
      </div>
    </div>`;
  }
  const kind = effectiveChangeKind(row.change);
  const primary = state.selectedChange?.path === row.change.path;
  const included = !state.excludedPaths.has(row.change.path);
  return `<div class="change-row file-status-${kind} ${included ? "" : "excluded"} ${primary ? "primary" : ""}" role="treeitem" tabindex="0" ${position} style="--tree-depth:${row.depth ?? 1}" data-change-path="${escapeAttribute(row.change.path)}" aria-selected="${primary}" aria-label="${escapeAttribute(copy.selectedDiff(row.change.path, primary))}">
    <input class="change-checkbox" type="checkbox" data-include-path="${escapeAttribute(row.change.path)}" aria-label="${escapeAttribute(copy.includeInCommit(row.change.path))}" ${included ? "checked" : ""} />
    <span class="change-status status-${kind}" title="${escapeAttribute(copy.changeLabels[kind])}">${changeCode(kind)}</span>
    <span class="commit-file-glyph">${fileTypeIcon(row.change.path)}</span>
    <span class="change-path">
      ${row.change.originalPath ? `<span class="commit-file-origin">${escapeHtml(row.change.originalPath)} →</span>` : ""}
      <span class="file-name">${escapeHtml(baseName(row.change.path))}</span>
      ${row.depth === null ? `<span class="file-directory">${escapeHtml(directoryName(row.change.path))}</span>` : ""}
    </span>
    ${row.change.conflicted ? `<button class="conflict-pill conflict-resolve-button" type="button" data-resolve-conflict="${escapeAttribute(row.change.path)}" aria-label="${escapeAttribute(copy.resolveConflict(row.change.path))}">${escapeHtml(copy.resolve)}</button>` : ""}
  </div>`;
}

function untrackedScanNotice(snapshot: RepositorySnapshot, copy: ChangesCopy): string {
  if (snapshot.untrackedState === "complete") return "";
  const failed = snapshot.untrackedState === "failed";
  return `<div class="untracked-scan ${failed ? "failed" : ""}">${failed ? '<span class="scan-alert">!</span>' : '<span class="spinner"></span>'}<span>${escapeHtml(failed ? copy.untrackedScanFailed : copy.scanningUntracked)}</span></div>`;
}

function changeCode(kind: ReturnType<typeof effectiveChangeKind>): string {
  const codes = {
    unmodified: "·",
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    copied: "C",
    typeChanged: "T",
    unmerged: "!",
    untracked: "?",
    ignored: "I",
    unknown: "·",
  } as const;
  return codes[kind];
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function directoryName(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || ".";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
