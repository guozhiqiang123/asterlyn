import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import type { LocaleCatalog } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";
import { projectTreeRows } from "./project-files-view.ts";
import type { FindFileResultsSnapshot, FindResultsState } from "./find-results-controller.ts";
import { findFileTree, sortedFindFiles } from "./find-results-controller.ts";
import {
  formatLocalizedWorkspaceSearchCoverage,
  renderWorkspaceSearchMatchContent,
} from "./workspace-navigation-view.ts";

export function renderFindResults(
  state: Readonly<FindResultsState>,
  catalog: LocaleCatalog = EN_US,
): string {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return `<div class="find-results-empty"><span>${icon("search", 24)}</span><strong>${escapeHtml(catalog.navigation.noFindResults)}</strong><p>${escapeHtml(catalog.navigation.noFindResultsDetail)}</p></div>`;
  }
  if (snapshot.kind !== "workspace") return renderFindFiles(state, snapshot, catalog);
  const rows = snapshot.report.matches.map((match, index) =>
    `<button class="command-result workspace-search-result find-result ${index === state.selectedIndex ? "selected" : ""}" id="find-result-${index}" type="button" role="option" aria-selected="${index === state.selectedIndex}" data-find-result="${index}">${renderWorkspaceSearchMatchContent(match, catalog.navigation)}</button>`
  ).join("");
  return `<section class="find-results-panel" aria-label="${escapeAttribute(catalog.navigation.findWindow)}">
    ${findSummary(snapshot.query, formatLocalizedWorkspaceSearchCoverage(snapshot.report, catalog.navigation))}
    <div class="find-results-list" role="listbox" tabindex="0" aria-label="${escapeAttribute(catalog.navigation.findResultsAria)}" aria-activedescendant="find-result-${state.selectedIndex}">${rows}</div>
  </section>`;
}

export function renderFindHeaderActions(
  state: Readonly<FindResultsState>,
  catalog: LocaleCatalog = EN_US,
  activePath: string | null = null,
): string {
  const snapshot = state.snapshot;
  if (!snapshot || snapshot.kind === "workspace") return "";
  const selectedDirectory = state.fileSelection?.kind === "directory";
  const canLocate = activePath !== null;
  const nextView = state.fileView === "tree" ? catalog.projectFiles.flatList : catalog.projectFiles.directoryTree;
  return `<button class="compact-icon-button" type="button" data-find-action="locate" aria-label="${escapeAttribute(catalog.projectFiles.locateCurrentFile)}" title="${escapeAttribute(catalog.projectFiles.locateCurrentFile)}" ${canLocate ? "" : "disabled"}>${icon("locate", 14)}</button>
    <button class="compact-icon-button ${state.fileView === "tree" ? "active" : ""}" type="button" data-find-action="view" aria-label="${escapeAttribute(catalog.projectFiles.showAs(nextView))}" title="${escapeAttribute(catalog.projectFiles.showAs(nextView))}" aria-pressed="${state.fileView === "tree"}">${icon("eye", 14)}</button>
    <button class="compact-icon-button" type="button" data-find-action="expand" aria-label="${escapeAttribute(catalog.projectFiles.expandSelectedFolder)}" title="${escapeAttribute(catalog.projectFiles.expandSelectedFolder)}" ${state.fileView === "tree" && selectedDirectory ? "" : "disabled"}>${icon("expand", 14)}</button>
    <button class="compact-icon-button" type="button" data-find-action="collapse" aria-label="${escapeAttribute(catalog.projectFiles.collapseSelectedFolder)}" title="${escapeAttribute(catalog.projectFiles.collapseSelectedFolder)}" ${state.fileView === "tree" && selectedDirectory ? "" : "disabled"}>${icon("collapse", 14)}</button>`;
}

function renderFindFiles(
  state: Readonly<FindResultsState>,
  snapshot: FindFileResultsSnapshot,
  catalog: LocaleCatalog,
): string {
  const rows = state.fileView === "tree"
    ? projectTreeRows(findFileTree(snapshot), state.expandedDirectories).map((row) => {
      const selected = state.fileSelection?.path === row.node.path && state.fileSelection.kind === row.node.kind;
      if (row.node.kind === "directory") {
        const expanded = state.expandedDirectories.has(row.node.path);
        return `<button class="find-file-row directory ${selected ? "selected" : ""}" type="button" role="treeitem" style="--tree-depth:${row.depth}" aria-selected="${selected}" aria-expanded="${expanded}" data-find-path="${escapeAttribute(row.node.path)}" data-find-kind="directory"><span class="tree-chevron ${expanded ? "expanded" : ""}">${icon("chevron", 12)}</span>${icon("folder", 15)}<span>${escapeHtml(row.label)}</span><small>${row.fileCount}</small></button>`;
      }
      return renderFindFileRow(row.node.path, row.depth, selected, true);
    }).join("")
    : sortedFindFiles(snapshot).map((file) => renderFindFileRow(
      file.workspacePath,
      0,
      state.fileSelection?.kind === "file" && state.fileSelection.path === file.workspacePath,
      false,
    )).join("");
  const label = catalog.navigation.resultCount(snapshot.kind, snapshot.files.length);
  return `<section class="find-results-panel find-file-results" aria-label="${escapeAttribute(catalog.navigation.findWindow)}">
    ${findSummary(snapshot.query || catalog.navigation.tabs[snapshot.kind], label)}
    <div class="find-results-list find-file-list ${state.fileView}" role="${state.fileView === "tree" ? "tree" : "listbox"}" tabindex="0" aria-label="${escapeAttribute(catalog.navigation.findResultsAria)}">${rows}</div>
  </section>`;
}

function renderFindFileRow(
  workspacePath: string,
  depth: number,
  selected: boolean,
  tree: boolean,
): string {
  const directory = dirname(workspacePath);
  return `<button class="find-file-row file ${tree ? "tree-row" : "flat-row"} ${selected ? "selected" : ""}" type="button" role="${tree ? "treeitem" : "option"}" style="--tree-depth:${depth}" aria-selected="${selected}" data-find-path="${escapeAttribute(workspacePath)}" data-find-kind="file" title="${escapeAttribute(workspacePath)}"><span class="find-file-glyph">${fileTypeIcon(workspacePath)}</span><span class="find-file-name">${escapeHtml(basename(workspacePath))}</span>${tree ? "" : `<span class="find-file-directory">${escapeHtml(directory)}</span>`}</button>`;
}

function findSummary(query: string, detail: string): string {
  return `<div class="find-results-summary">${icon("search", 14)}<strong title="${escapeAttribute(query)}">${escapeHtml(query)}</strong><small>${escapeHtml(detail)}</small></div>`;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
