import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import type { ChangeKind } from "../../models.ts";
import type { ProjectFilesState } from "./project-files-controller.ts";
import { findProjectTreeNode, type ProjectTreeNode } from "../../workbench/project-tree.ts";

export const PROJECT_TREE_MOUNT_LIMIT = 200;
export const PROJECT_TREE_ROW_HEIGHT = 27;
const PROJECT_TREE_OVERSCAN = 32;

export interface ProjectTreeRow {
  node: ProjectTreeNode;
  depth: number;
}

export interface ProjectTreeRenderWindow {
  start: number;
  end: number;
}

export function renderProjectToolbar(
  state: ProjectFilesState,
  tree: ProjectTreeNode[],
  activePath: string | null,
): string {
  const canLocate = Boolean(activePath && findProjectTreeNode(tree, activePath));
  const canChangeSubtree = state.selection?.kind === "directory";
  return `
    <button class="compact-icon-button" id="locate-project-file" type="button" aria-label="Locate current file in project" title="Locate current file" ${canLocate ? "" : "disabled"}>${icon("locate", 14)}</button>
    <button class="compact-icon-button" id="expand-project-folder" type="button" aria-label="Expand selected folder" title="Expand selected folder" ${canChangeSubtree ? "" : "disabled"}>${icon("expand", 14)}</button>
    <button class="compact-icon-button" id="collapse-project-folder" type="button" aria-label="Collapse selected folder" title="Collapse selected folder" ${canChangeSubtree ? "" : "disabled"}>${icon("collapse", 14)}</button>`;
}

export function renderProjectNavigation(
  state: ProjectFilesState,
  tree: ProjectTreeNode[],
  scrollTop: number,
  clientHeight: number,
): string {
  if (tree.length === 0 && state.loading) {
    return '<div class="loading-block"><span class="spinner"></span><span>Loading project files…</span></div>';
  }
  if (tree.length === 0 && state.error) {
    return `<div class="empty-state"><span class="empty-icon">${icon("folder", 24)}</span><strong>Could not list project files</strong><p>${escapeHtml(state.error)}</p><button class="secondary-button retry-button" id="retry-project-files" type="button">Try again</button></div>`;
  }
  const rows = projectTreeRows(tree, state.expandedDirectories);
  const window = projectTreeRenderWindow(rows.length, scrollTop, clientHeight);
  const visible = window ? rows.slice(window.start, window.end) : rows;
  const topSpacer = window && window.start > 0
    ? `<div class="project-virtual-spacer" aria-hidden="true" style="height:${window.start * PROJECT_TREE_ROW_HEIGHT}px"></div>`
    : "";
  const bottomCount = window ? rows.length - window.end : 0;
  const bottomSpacer = bottomCount > 0
    ? `<div class="project-virtual-spacer" aria-hidden="true" style="height:${bottomCount * PROJECT_TREE_ROW_HEIGHT}px"></div>`
    : "";
  const notices = [
    state.loading
      ? '<div class="project-tree-notice"><span class="spinner"></span><span>Refreshing files…</span></div>'
      : "",
    state.truncated
      ? '<div class="project-tree-notice warning"><span>!</span><span>Showing a bounded project catalog; some paths were omitted.</span></div>'
      : "",
    state.error
      ? `<div class="project-tree-notice warning"><span>!</span><span>${escapeHtml(state.error)}</span></div>`
      : "",
  ].join("");
  return `<div class="project-tree virtual-tree" role="tree" aria-label="Project files" aria-rowcount="${rows.length}">${topSpacer}${visible.map((row, offset) => renderProjectRow(state, row, (window?.start ?? 0) + offset, rows.length)).join("")}${bottomSpacer}</div>${notices}`;
}

export function projectTreeRows(
  nodes: ProjectTreeNode[],
  expandedDirectories: ReadonlySet<string>,
): ProjectTreeRow[] {
  const rows: ProjectTreeRow[] = [];
  const visit = (node: ProjectTreeNode, depth: number): void => {
    rows.push({ node, depth });
    if (node.kind === "directory" && expandedDirectories.has(node.path)) {
      for (const child of node.children) visit(child, depth + 1);
    }
  };
  for (const node of nodes) visit(node, 0);
  return rows;
}

export function projectTreeRenderWindow(
  rowCount: number,
  scrollTop: number,
  clientHeight: number,
): ProjectTreeRenderWindow | null {
  if (rowCount <= PROJECT_TREE_MOUNT_LIMIT) return null;
  const visible = Math.max(1, Math.ceil(Math.max(0, clientHeight) / PROJECT_TREE_ROW_HEIGHT));
  const size = Math.min(PROJECT_TREE_MOUNT_LIMIT, Math.max(72, visible + PROJECT_TREE_OVERSCAN * 2));
  const anchor = Math.max(0, Math.floor(Math.max(0, scrollTop) / PROJECT_TREE_ROW_HEIGHT));
  const start = Math.min(
    Math.max(0, Math.floor(Math.max(0, anchor - PROJECT_TREE_OVERSCAN) / 24) * 24),
    Math.max(0, rowCount - size),
  );
  return { start, end: Math.min(rowCount, start + size) };
}

function renderProjectRow(
  state: ProjectFilesState,
  row: ProjectTreeRow,
  index: number,
  rowCount: number,
): string {
  const { node, depth } = row;
  const selected = state.selection?.path === node.path && state.selection.kind === node.kind;
  const statusClass = `file-status-${node.status}`;
  const common = `role="treeitem" style="--tree-depth:${depth}" data-project-node="${escapeAttribute(node.path)}" data-project-status="${node.status}" aria-selected="${selected}" aria-posinset="${index + 1}" aria-setsize="${rowCount}" title="${escapeAttribute(`${node.path} · ${changeLabel(node.status)}`)}"`;
  if (node.kind === "directory") {
    const expanded = state.expandedDirectories.has(node.path);
    return `<div class="project-directory virtual ${statusClass}"><div class="project-directory-row project-node-row ${selected ? "selected" : ""}" tabindex="0" ${common} data-project-directory="${escapeAttribute(node.path)}" aria-expanded="${expanded}"><button class="project-tree-toggle" type="button" data-project-directory-toggle="${escapeAttribute(node.path)}" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeAttribute(node.path)}"><span class="tree-chevron ${expanded ? "expanded" : ""}">${icon("chevron", 12)}</span></button>${icon("folder", 15)}<span class="project-node-label">${escapeHtml(node.name)}</span></div></div>`;
  }
  return `<button class="project-file-row project-node-row ${statusClass} ${selected ? "selected" : ""}" type="button" ${common} data-project-file="${escapeAttribute(node.path)}"><span class="project-file-glyph">${fileTypeIcon(node.name)}</span><span class="project-node-label">${escapeHtml(node.name)}</span></button>`;
}

function changeLabel(kind: ChangeKind): string {
  const labels: Record<ChangeKind, string> = {
    unmodified: "Unmodified",
    added: "Added",
    modified: "Modified",
    deleted: "Deleted",
    renamed: "Renamed",
    copied: "Copied",
    typeChanged: "Type changed",
    unmerged: "Unmerged",
    untracked: "Untracked",
    ignored: "Ignored",
    unknown: "Unknown",
  };
  return labels[kind];
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
