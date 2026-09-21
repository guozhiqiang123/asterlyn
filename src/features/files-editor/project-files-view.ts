import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import type { ProjectFilesState } from "./project-files-controller.ts";
import { findProjectTreeNode, type ProjectTreeNode } from "../../presentation/project-tree.ts";
import type { ProjectFilesCopy } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";
import type {
  ProjectFilesInlineEdit,
  ProjectFilesOperationState,
} from "./project-files-operation-controller.ts";
import {
  COMPACT_FILE_TREE_ROW_HEIGHT,
  compactDirectoryChain,
} from "../../presentation/compact-file-tree.ts";

export const PROJECT_TREE_MOUNT_LIMIT = 200;
export const PROJECT_TREE_ROW_HEIGHT = COMPACT_FILE_TREE_ROW_HEIGHT;
const PROJECT_TREE_OVERSCAN = 32;

export interface ProjectTreeRow {
  node: ProjectTreeNode;
  depth: number;
  positionInSet: number;
  setSize: number;
  label: string;
  directoryPaths: readonly string[];
  fileCount: number;
}

export interface ProjectTreeRenderWindow {
  start: number;
  end: number;
}

export function renderProjectToolbar(
  state: ProjectFilesState,
  tree: ProjectTreeNode[],
  activePath: string | null,
  copy: ProjectFilesCopy = EN_US.projectFiles,
): string {
  const canLocate = Boolean(activePath && findProjectTreeNode(tree, activePath));
  const canChangeSubtree = state.selection?.kind === "directory";
  return `
    <button class="compact-icon-button" id="locate-project-file" type="button" aria-label="${escapeAttribute(copy.locateCurrentFile)}" title="${escapeAttribute(copy.locateCurrentFile)}" ${canLocate ? "" : "disabled"}>${icon("locate", 14)}</button>
    <button class="compact-icon-button" id="expand-project-folder" type="button" aria-label="${escapeAttribute(copy.expandSelectedFolder)}" title="${escapeAttribute(copy.expandSelectedFolder)}" ${canChangeSubtree ? "" : "disabled"}>${icon("expand", 14)}</button>
    <button class="compact-icon-button" id="collapse-project-folder" type="button" aria-label="${escapeAttribute(copy.collapseSelectedFolder)}" title="${escapeAttribute(copy.collapseSelectedFolder)}" ${canChangeSubtree ? "" : "disabled"}>${icon("collapse", 14)}</button>`;
}

export function renderProjectNavigation(
  state: ProjectFilesState,
  tree: ProjectTreeNode[],
  scrollTop: number,
  clientHeight: number,
  copy: ProjectFilesCopy = EN_US.projectFiles,
  operations: ProjectFilesOperationState | null = null,
  cutPath: string | null = null,
): string {
  if (tree.length === 0 && state.loading) {
    return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(copy.loadingProjectFiles)}</span></div>`;
  }
  if (tree.length === 0 && state.error) {
    return `<div class="empty-state"><span class="empty-icon">${icon("folder", 24)}</span><strong>${escapeHtml(copy.listFailed)}</strong><p>${escapeHtml(state.error)}</p><button class="secondary-button retry-button" id="retry-project-files" type="button">${escapeHtml(copy.tryAgain)}</button></div>`;
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
      ? `<div class="project-tree-notice"><span class="spinner"></span><span>${escapeHtml(copy.refreshingFiles)}</span></div>`
      : "",
    state.truncated
      ? `<div class="project-tree-notice warning"><span>!</span><span>${escapeHtml(copy.boundedCatalog)}</span></div>`
      : "",
    state.error
      ? `<div class="project-tree-notice warning"><span>!</span><span>${escapeHtml(state.error)}</span></div>`
      : "",
  ].join("");
  return `<div class="project-tree compact-file-tree virtual-tree" role="tree" aria-label="${escapeAttribute(copy.projectFiles)}" aria-rowcount="${rows.length}">${topSpacer}${visible.map((row) => renderProjectRowWithOperations(state, row, copy, operations?.inlineEdit ?? null, cutPath)).join("")}${bottomSpacer}</div>${notices}`;
}

export function projectTreeRows(
  nodes: ProjectTreeNode[],
  expandedDirectories: ReadonlySet<string>,
): ProjectTreeRow[] {
  const rows: ProjectTreeRow[] = [];
  const visit = (node: ProjectTreeNode, depth: number, positionInSet: number, setSize: number): void => {
    if (node.kind === "directory") {
      const chain = compactDirectoryChain(node);
      rows.push({
        node: chain.terminal,
        depth,
        positionInSet,
        setSize,
        label: chain.label,
        directoryPaths: chain.paths,
        fileCount: chain.fileCount,
      });
      if (expandedDirectories.has(chain.terminal.path)) {
        chain.terminal.children.forEach((child, index) =>
          visit(child, depth + 1, index + 1, chain.terminal.children.length)
        );
      }
      return;
    }
    rows.push({
      node,
      depth,
      positionInSet,
      setSize,
      label: node.name,
      directoryPaths: [],
      fileCount: 1,
    });
  };
  nodes.forEach((node, index) => visit(node, 0, index + 1, nodes.length));
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
  copy: ProjectFilesCopy,
): string {
  const { node, depth } = row;
  const selected = state.selection?.kind === node.kind && (
    state.selection.path === node.path || row.directoryPaths.includes(state.selection.path)
  );
  const statusClass = `file-status-${node.status}`;
  const common = `role="treeitem" style="--tree-depth:${depth}" data-project-node="${escapeAttribute(node.path)}" data-project-kind="${node.kind}" data-project-status="${node.status}" aria-selected="${selected}" aria-level="${depth + 1}" aria-posinset="${row.positionInSet}" aria-setsize="${row.setSize}" title="${escapeAttribute(`${node.path} · ${copy.changeLabels[node.status]}`)}"`;
  if (node.kind === "directory") {
    const expanded = state.expandedDirectories.has(node.path);
    return `<div class="project-directory virtual ${statusClass}"><div class="project-directory-row project-node-row ${selected ? "selected" : ""}" tabindex="0" ${common} data-project-directory="${escapeAttribute(node.path)}" data-project-directory-paths="${escapeAttribute(JSON.stringify(row.directoryPaths))}" aria-expanded="${expanded}"><button class="project-tree-toggle" type="button" data-project-directory-toggle="${escapeAttribute(node.path)}" aria-label="${escapeAttribute(expanded ? copy.collapsePath(node.path) : copy.expandPath(node.path))}"><span class="tree-chevron ${expanded ? "expanded" : ""}">${icon("chevron", 12)}</span></button>${icon("folder", 15)}<span class="project-node-label">${escapeHtml(row.label)}</span><small class="compact-file-tree-count">${escapeHtml(copy.directoryFileCount(row.fileCount))}</small></div></div>`;
  }
  return `<button class="project-file-row project-node-row ${statusClass} ${selected ? "selected" : ""}" type="button" ${common} data-project-file="${escapeAttribute(node.path)}"><span class="project-file-glyph">${fileTypeIcon(node.name)}</span><span class="project-node-label">${escapeHtml(row.label)}</span></button>`;
}

export function projectTreeRowRepresentsPath(row: ProjectTreeRow, path: string): boolean {
  return row.node.path === path || row.directoryPaths.includes(path);
}

export function projectTreeElementRepresentsPath(element: HTMLElement, path: string): boolean {
  if (element.dataset.projectNode === path) return true;
  const serialized = element.dataset.projectDirectoryPaths;
  if (!serialized) return false;
  try {
    const paths: unknown = JSON.parse(serialized);
    return Array.isArray(paths) && paths.includes(path);
  } catch {
    return false;
  }
}

function renderProjectRowWithOperations(
  state: ProjectFilesState,
  row: ProjectTreeRow,
  copy: ProjectFilesCopy,
  edit: ProjectFilesInlineEdit | null,
  cutPath: string | null,
): string {
  if (edit?.kind === "rename" && edit.anchorPath === row.node.path) {
    return renderProjectEntryEdit(edit, row.depth, copy);
  }
  const cut = cutPath && isAtOrBelow(row.node.path, cutPath) ? " project-node-cut" : "";
  const rendered = renderProjectRow(state, row, copy).replace(
    /class="([^"]*project-node-row[^"]*)"/u,
    `class="$1${cut}"`,
  );
  return edit?.kind === "create" && edit.anchorPath === row.node.path
    ? `${rendered}${renderProjectEntryEdit(edit, row.depth + (row.node.kind === "directory" ? 1 : 0), copy)}`
    : rendered;
}

function renderProjectEntryEdit(
  edit: ProjectFilesInlineEdit,
  depth: number,
  copy: ProjectFilesCopy,
): string {
  const labels = copy.contextMenu;
  const title = edit.kind === "create" ? labels.newFile : labels.rename;
  return `<form class="project-entry-edit ${edit.error ? "invalid" : ""}" data-project-entry-edit="${edit.kind}" style="--tree-depth:${depth}" aria-label="${escapeAttribute(title)}">
    <span class="project-entry-edit-glyph">${edit.busy ? '<span class="spinner"></span>' : icon(edit.sourceKind === "directory" ? "folder" : "file", 14)}</span>
    <input id="project-entry-name" name="name" type="text" value="${escapeAttribute(edit.value)}" aria-label="${escapeAttribute(labels.nameLabel)}" aria-invalid="${Boolean(edit.error)}" ${edit.busy ? "disabled" : ""} autocomplete="off" spellcheck="false" />
    ${edit.error ? `<small role="alert">${escapeHtml(edit.error)}</small>` : ""}
  </form>`;
}

function isAtOrBelow(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
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
