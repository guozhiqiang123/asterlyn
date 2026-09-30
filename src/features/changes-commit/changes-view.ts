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
} from "./change-presentation.ts";
import type { ChangesCommitState } from "./changes-commit-controller.ts";
import type { ChangesCopy } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";
import {
  COMPACT_FILE_TREE_ROW_HEIGHT,
  compactDirectoryChain,
} from "../../presentation/compact-file-tree.ts";
import { sortFilesByName } from "../../presentation/file-name-order.ts";

export const CHANGE_TREE_MOUNT_LIMIT = 200;
export const CHANGE_TREE_ROW_HEIGHT = COMPACT_FILE_TREE_ROW_HEIGHT;
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
      label: string;
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

export interface ChangeNavigationPatch {
  bindingRoots: HTMLElement[];
  windowStart: number;
}

export function patchCommitComposer(current: HTMLElement, markup: string): boolean {
  const staging = current.ownerDocument.createElement("div");
  staging.innerHTML = markup;
  const next = staging.querySelector<HTMLElement>("#commit-tool");
  const currentForm = current.querySelector<HTMLElement>(":scope > .commit-form");
  const nextForm = next?.querySelector<HTMLElement>(":scope > .commit-form");
  if (!next || !currentForm || !nextForm) {
    if (next) current.replaceWith(next);
    return false;
  }
  const label = next.getAttribute("aria-label");
  if (label) current.setAttribute("aria-label", label);
  const textarea = currentForm.querySelector<HTMLTextAreaElement>("#commit-message");
  const nextTextarea = nextForm.querySelector<HTMLTextAreaElement>("#commit-message");
  if (textarea && nextTextarea) textarea.placeholder = nextTextarea.placeholder;
  const hint = currentForm.querySelector<HTMLElement>(".commit-hint");
  const nextHint = nextForm.querySelector<HTMLElement>(".commit-hint");
  if (hint && nextHint) hint.innerHTML = nextHint.innerHTML;
  const actions = currentForm.querySelector<HTMLElement>(".commit-actions");
  const blocker = currentForm.querySelector<HTMLElement>(".commit-blocker");
  const nextBlocker = nextForm.querySelector<HTMLElement>(".commit-blocker");
  if (!nextBlocker) blocker?.remove();
  else if (blocker) blocker.replaceWith(nextBlocker);
  else actions?.before(nextBlocker);
  for (const id of ["commit-button", "stash-changes-button"]) {
    const button = currentForm.querySelector<HTMLButtonElement>(`#${id}`);
    const candidate = nextForm.querySelector<HTMLButtonElement>(`#${id}`);
    if (!button || !candidate) continue;
    button.disabled = candidate.disabled;
    button.title = candidate.title;
    button.querySelector(".commit-button-label")!.textContent =
      candidate.querySelector(".commit-button-label")!.textContent;
  }
  return true;
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

export function patchChangeNavigation(
  host: HTMLElement,
  bannerMarkup: string,
  snapshot: RepositorySnapshot,
  state: ChangesCommitState,
  scrollTop = 0,
  clientHeight = 0,
  copy: ChangesCopy = EN_US.changes,
): ChangeNavigationPatch | null {
  const staging = host.ownerDocument.createElement("div");
  staging.innerHTML = `${bannerMarkup}${renderChangeNavigation(snapshot, state, scrollTop, clientHeight, copy)}`;
  const currentNavigation = host.querySelector<HTMLElement>(":scope > .changes-navigation");
  const nextNavigation = staging.querySelector<HTMLElement>(":scope > .changes-navigation");
  if (!currentNavigation || !nextNavigation) return null;
  const bindingRoots: HTMLElement[] = [];
  const banner = syncChangeChild(host, currentNavigation, staging, ".git-operation-banner");
  if (banner) bindingRoots.push(banner);
  syncChangeToolbar(currentNavigation, nextNavigation);
  const results = patchChangeResults(currentNavigation, nextNavigation);
  if (results) bindingRoots.push(results);
  const window = changeTreeRenderWindow(changeViewRows(snapshot, state, copy).length, scrollTop, clientHeight);
  return { bindingRoots, windowStart: window?.start ?? 0 };
}

function syncChangeChild(
  host: HTMLElement,
  anchor: HTMLElement,
  staging: HTMLElement,
  selector: string,
): HTMLElement | null {
  const current = host.querySelector<HTMLElement>(`:scope > ${selector}`);
  const next = staging.querySelector<HTMLElement>(`:scope > ${selector}`);
  if (!next) {
    current?.remove();
    return null;
  }
  if (current?.outerHTML === next.outerHTML) return null;
  if (current) current.replaceWith(next);
  else anchor.before(next);
  return next;
}

function syncChangeToolbar(currentNavigation: HTMLElement, nextNavigation: HTMLElement): void {
  const current = currentNavigation.querySelector<HTMLElement>(":scope > .change-toolbar");
  const next = nextNavigation.querySelector<HTMLElement>(":scope > .change-toolbar");
  if (!current || !next) return;
  current.className = next.className;
  for (const button of current.querySelectorAll<HTMLButtonElement>("[data-change-action]")) {
    const action = button.dataset.changeAction;
    const candidate = action
      ? next.querySelector<HTMLButtonElement>(`[data-change-action="${action}"]`)
      : null;
    if (!candidate) continue;
    button.className = candidate.className;
    button.disabled = candidate.disabled;
    for (const attribute of ["aria-label", "aria-pressed", "title"]) {
      const value = candidate.getAttribute(attribute);
      if (value === null) button.removeAttribute(attribute);
      else button.setAttribute(attribute, value);
    }
  }
}

function patchChangeResults(
  currentNavigation: HTMLElement,
  nextNavigation: HTMLElement,
): HTMLElement | null {
  const current = currentNavigation.querySelector<HTMLElement>(":scope > .change-results");
  const next = nextNavigation.querySelector<HTMLElement>(":scope > .change-results");
  if (!current || !next) return null;
  const currentList = current.querySelector<HTMLElement>(":scope > .change-list");
  const nextList = next.querySelector<HTMLElement>(":scope > .change-list");
  if (!currentList || !nextList) {
    if (current.innerHTML === next.innerHTML) return null;
    current.innerHTML = next.innerHTML;
    return current;
  }
  syncChangeChild(current, currentList, next, ".untracked-scan");
  syncChangeScanStatuses(currentList, nextList);
  currentList.className = nextList.className;
  for (const attribute of ["role", "aria-label", "aria-rowcount"]) {
    const value = nextList.getAttribute(attribute);
    if (value === null) currentList.removeAttribute(attribute);
    else currentList.setAttribute(attribute, value);
  }
  if (currentList.innerHTML === nextList.innerHTML) return null;
  currentList.innerHTML = nextList.innerHTML;
  return currentList;
}

function syncChangeScanStatuses(currentList: HTMLElement, nextList: HTMLElement): void {
  for (const current of currentList.querySelectorAll<HTMLElement>("[data-change-scan-status]")) {
    const group = current.dataset.changeScanStatus;
    const next = group
      ? nextList.querySelector<HTMLElement>(`[data-change-scan-status="${group}"]`)
      : null;
    if (next) current.className = next.className;
  }
}

export function changeViewRows(
  snapshot: RepositorySnapshot,
  state: ChangesCommitState,
  copy: ChangesCopy = EN_US.changes,
): ChangeViewRow[] {
  const rows: ChangeViewRow[] = [];
  appendGroupRows(rows, copy.groups.conflicts, "conflicts", snapshot.changes, state);
  appendGroupRows(rows, copy.groups.changes, "changes", snapshot.changes, state);
  appendGroupRows(rows, copy.groups.unversioned, "unversioned", snapshot.changes, state);
  return rows;
}

export function changeDisclosureKeys(snapshot: RepositorySnapshot): string[] {
  const keys: string[] = [];
  for (const group of ["conflicts", "changes", "unversioned"] as const) {
    const changes = snapshot.changes.filter((change) => changeGroup(change) === group);
    if (changes.length === 0) continue;
    keys.push(`group:${group}`);
    const visit = (node: ChangeFileTreeNode): void => {
      if (node.kind !== "directory") return;
      const chain = compactDirectoryChain(node);
      keys.push(`directory:${group}:${chain.terminal.path}`);
      for (const child of chain.terminal.children) visit(child);
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
  const scanNotice = untrackedScanNotice(snapshot, copy);
  if (snapshot.changes.length === 0) {
    if (snapshot.untrackedState === "pending") {
      return scanNotice;
    }
    if (snapshot.untrackedState === "failed") {
      return scanNotice;
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
  const persistentNotice = snapshot.untrackedState === "failed" ? scanNotice : "";
  return `${persistentNotice}<div class="change-list compact-file-tree virtual-tree" role="tree" aria-label="${escapeAttribute(copy.changedFiles)}" aria-rowcount="${rows.length}">${topSpacer}${visible.map((row, offset) => {
    const index = (window?.start ?? 0) + offset;
    return renderChangeRow(
      state,
      row,
      index,
      rows.length,
      copy,
      snapshot.untrackedState === "pending" && index === 0,
    );
  }).join("")}${bottomSpacer}</div>`;
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
    for (const change of sortFilesByName(changes)) {
      rows.push({ kind: "file", group, change, depth: null });
    }
    return;
  }
  const visit = (node: ChangeFileTreeNode, depth: number): void => {
    if (node.kind === "file") {
      rows.push({ kind: "file", group, change: node.change!, depth });
      return;
    }
    const chain = compactDirectoryChain(node);
    const key = `directory:${group}:${chain.terminal.path}`;
    const collapsedDirectory = state.collapsedDirectories.has(key);
    rows.push({
      kind: "directory",
      group,
      node: chain.terminal,
      depth,
      key,
      paths: descendantChangePaths(chain.terminal),
      collapsed: collapsedDirectory,
      label: chain.label,
    });
    if (!collapsedDirectory) {
      for (const child of chain.terminal.children) visit(child, depth + 1);
    }
  };
  for (const node of buildChangeFileTree(changes)) visit(node, 1);
}

function renderChangeRow(
  state: ChangesCommitState,
  row: ChangeViewRow,
  index: number,
  rowCount: number,
  copy: ChangesCopy,
  scanningUntracked = false,
): string {
  const position = `aria-posinset="${index + 1}" aria-setsize="${rowCount}"`;
  if (row.kind === "group") {
    return `<div class="change-group virtual" role="treeitem" ${position} aria-expanded="${!row.collapsed}" data-change-group="${row.group}">
      <div class="group-header" data-change-disclosure="group:${row.group}">
        <input class="change-checkbox" type="checkbox" data-include-group="${row.group}" aria-label="${escapeAttribute(copy.includeAll(row.title))}" ${row.group === "conflicts" ? "disabled checked" : ""} />
        <button class="change-tree-toggle" type="button" aria-label="${escapeAttribute(row.collapsed ? copy.expand(row.title) : copy.collapse(row.title))}"><span class="tree-chevron ${row.collapsed ? "" : "expanded"}">${icon("chevron", 12)}</span></button>
        <span class="group-title">${escapeHtml(row.title)}<b>${escapeHtml(copy.fileCount(row.changes.length))}</b><span class="change-scan-status${scanningUntracked ? " active" : ""}" data-change-scan-status="${row.group}" aria-hidden="true"><span class="spinner"></span></span></span>
      </div>
    </div>`;
  }
  if (row.kind === "directory") {
    return `<div class="change-directory virtual" role="treeitem" ${position} aria-expanded="${!row.collapsed}">
      <div class="change-directory-row" style="--tree-depth:${row.depth}" data-change-disclosure="${escapeAttribute(row.key)}">
        <input class="change-checkbox" type="checkbox" data-include-directory="${escapeAttribute(row.node.path)}" data-include-directory-group="${row.group}" aria-label="${escapeAttribute(copy.include(row.node.path))}" ${row.group === "conflicts" ? "disabled checked" : ""} />
        <button class="change-tree-toggle" type="button" aria-label="${escapeAttribute(row.collapsed ? copy.expand(row.node.path) : copy.collapse(row.node.path))}"><span class="tree-chevron ${row.collapsed ? "" : "expanded"}">${icon("chevron", 12)}</span></button>
        ${icon("folder", 15)}<span>${escapeHtml(row.label)}</span><small class="compact-file-tree-count">${escapeHtml(copy.fileCount(row.paths.length))}</small>
      </div>
    </div>`;
  }
  const kind = effectiveChangeKind(row.change);
  const primary = state.selectedChange?.path === row.change.path;
  const included = !state.excludedPaths.has(row.change.path);
  return `<div class="change-row file-status-${kind} ${included ? "" : "excluded"} ${primary ? "primary" : ""}" role="treeitem" tabindex="0" ${position} style="--tree-depth:${row.depth ?? 1}" data-change-path="${escapeAttribute(row.change.path)}" aria-selected="${primary}" aria-label="${escapeAttribute(copy.selectedDiff(row.change.path, primary))}">
    <input class="change-checkbox" type="checkbox" data-include-path="${escapeAttribute(row.change.path)}" aria-label="${escapeAttribute(copy.includeInCommit(row.change.path))}" ${included ? "checked" : ""} ${row.change.conflicted ? "disabled" : ""} />
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
