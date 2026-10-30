import {findResultRows,findResultBranches,type FindResultRow} from "./find-result-tree.ts";
import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import { renderHierarchicalCollectionToolbar } from "../../presentation/hierarchical-collection-toolbar.ts";
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
  previews:ReadonlyMap<number,FindLocationPreview>=new Map(),
): string {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return `<div class="find-results-empty"><span>${icon("search", 24)}</span><strong>${escapeHtml(catalog.navigation.noFindResults)}</strong><p>${escapeHtml(catalog.navigation.noFindResultsDetail)}</p><button class="primary-button" data-find-search type="button">${escapeHtml(catalog.shell.search)}</button></div>`;
  }
  if(snapshot.kind==="files"||snapshot.kind==="recent")return renderFindFiles(state,snapshot,catalog);
  const tree=state.fileView==="tree";
  const rows=tree?findResultRows(state.resultTree,state.expandedDirectories):[];
  const entries=tree?rows:findResultBranches(state.resultTree).flatMap(n=>n.kind==="file"?n.entries:[]).sort((a,b)=>a.index-b.index).map(entry=>({id:`result:${entry.index}`,parentId:null,depth:0,label:"",entry}));
  const html=entries.map((row,index)=>renderResultTreeRow(row,state,catalog,previews,tree,index)).join("");
  const title=snapshot.kind!=="locations"?snapshot.query:`${snapshot.intent==="references"?catalog.editor.languageService.referencesTitle:catalog.editor.languageService.definitionsTitle}${snapshot.query?`: ${snapshot.query}`:""}`;
  const detail=snapshot.kind==="workspace"?formatLocalizedWorkspaceSearchCoverage(snapshot.report,catalog.navigation):snapshot.kind==="locations"?(snapshot.limited?catalog.editor.languageService.limitedLocations.replace("{count}",String(snapshot.locations.length)):catalog.navigation.resultCount("workspace",snapshot.locations.length)):"";
  const selected=entries.findIndex(row=>row.id===state.resultSelection);
  return `<section class="find-results-panel find-location-results" aria-label="${escapeAttribute(catalog.navigation.findWindow)}">
    ${findSummary(title,detail)}
    <div class="find-results-list find-result-tree compact-file-tree ${tree?"tree":"flat"}" role="${tree?"tree":"listbox"}" tabindex="0" aria-label="${escapeAttribute(catalog.navigation.findResultsAria)}"${selected>=0?` aria-activedescendant="find-tree-row-${selected}"`:""}>${html}</div>
  </section>`;

}

export function renderFindHeaderActions(
  state: Readonly<FindResultsState>,
  catalog: LocaleCatalog = EN_US,
  activePath: string | null = null,
): string {
  const snapshot = state.snapshot;
  if (!snapshot) return "";
  const selectedDirectory = state.fileSelection?.kind === "directory"||findResultBranches(state.resultTree).some(n=>n.id===state.resultSelection);
  const canLocate = activePath !== null;
  const nextView = state.fileView === "tree" ? catalog.projectFiles.flatList : catalog.projectFiles.directoryTree;
  return renderHierarchicalCollectionToolbar({
    mode: state.fileView,
    ariaLabel: catalog.navigation.findWindow,
    commands: [
      { id: "locate", label: catalog.projectFiles.locateCurrentFile, icon: "locate", disabled: !canLocate },
      { id: "view", label: catalog.projectFiles.showAs(nextView), icon: "eye", pressed: state.fileView === "tree", active: state.fileView === "tree" },
      { id: "expand", label: catalog.projectFiles.expandSelectedFolder, icon: "expand", disabled: !(state.fileView === "tree" && selectedDirectory) },
      { id: "collapse", label: catalog.projectFiles.collapseSelectedFolder, icon: "collapse", disabled: !(state.fileView === "tree" && selectedDirectory) },
    ],
  });
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
    <div class="find-results-list find-file-list compact-file-tree ${state.fileView}" role="${state.fileView === "tree" ? "tree" : "listbox"}" tabindex="0" aria-label="${escapeAttribute(catalog.navigation.findResultsAria)}">${rows}</div>
  </section>`;
}

function renderFindFileRow(
  workspacePath: string,
  depth: number,
  selected: boolean,
  tree: boolean,
): string {
  const directory = dirname(workspacePath);
  const disclosureSpacer = tree ? '<span class="find-tree-disclosure-spacer" aria-hidden="true"></span>' : "";
  return `<button class="find-file-row file ${tree ? "tree-row" : "flat-row"} ${selected ? "selected" : ""}" type="button" role="${tree ? "treeitem" : "option"}" style="--tree-depth:${depth}" aria-selected="${selected}" data-find-path="${escapeAttribute(workspacePath)}" data-find-kind="file" title="${escapeAttribute(workspacePath)}">${disclosureSpacer}<span class="find-file-glyph">${fileTypeIcon(workspacePath)}</span><span class="find-file-name">${escapeHtml(basename(workspacePath))}</span>${tree ? "" : `<span class="find-file-directory">${escapeHtml(directory)}</span>`}</button>`;
}

export interface FindLocationPreview {readonly before:string;readonly found:string;readonly after:string;readonly leading:boolean;readonly trailing:boolean;}
export function locationPreview(text:string,line:number,from:number,to:number):FindLocationPreview|null {
  return locationPreviewLine(text.split("\n")[line],from,to);
}
export function locationPreviewLine(source:string|undefined,from:number,to:number):FindLocationPreview|null {
  if(source===undefined||!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>source.length||to<from)return null;
  const splitsPair=(offset:number)=>offset>0&&/[\uD800-\uDBFF]/.test(source[offset-1]??"")&&/[\uDC00-\uDFFF]/.test(source[offset]??"");
  if(splitsPair(from))return null;
  let start=Math.max(0,from-80),highlightEnd=Math.min(source.length,to,from+160),end=Math.min(source.length,highlightEnd+200);
  if(splitsPair(start))start--;if(splitsPair(highlightEnd))highlightEnd--;if(splitsPair(end))end++;
  return {before:source.slice(start,from),found:source.slice(from,highlightEnd),after:source.slice(highlightEnd,end),leading:start>0,trailing:end<source.length};
}
function renderResultTreeRow(row:FindResultRow,state:Readonly<FindResultsState>,catalog:LocaleCatalog,previews:ReadonlyMap<number,FindLocationPreview>,tree:boolean,visibleIndex:number):string {
  const selected=row.id===state.resultSelection;
  const common=`id="find-tree-row-${visibleIndex}" role="${tree?"treeitem":"option"}" ${tree?`aria-level="${row.depth+1}"`:""} aria-selected="${selected}" style="--tree-depth:${row.depth}"`;
  if(row.node){const expanded=state.expandedDirectories.has(row.id);return `<button class="find-file-row find-group-row ${row.node.kind} ${selected?"selected":""}" type="button" tabindex="-1" ${common} aria-expanded="${expanded}" data-find-node="${escapeAttribute(row.id)}" title="${escapeAttribute(row.node.path)}"><span class="tree-chevron ${expanded?"expanded":""}">${icon("chevron",12)}</span><span class="find-file-glyph">${row.node.kind==="directory"?icon("folder",15):fileTypeIcon(row.node.path)}</span><span class="find-file-name">${escapeHtml(row.label)}</span><small>${row.node.count}</small></button>`;}
  const entry=row.entry!,snapshot=state.snapshot!;let content="";
  if(snapshot.kind==="workspace")content=renderWorkspaceSearchMatchContent(snapshot.report.matches[entry.index]!,catalog.navigation,tree?`${entry.line}:${entry.column}`:undefined);
  else if(snapshot.kind==="locations"){
    const preview=previews.get(entry.index),snippet=preview?`${preview.leading?"…":""}${escapeHtml(preview.before)}<mark class="command-result-match">${escapeHtml(preview.found)}</mark>${escapeHtml(preview.after)}${preview.trailing?"…":""}`:"";
    content=`<span class="search-result-location" title="${escapeAttribute(`${entry.path}:${entry.line}:${entry.column}`)}">${escapeHtml(tree?`${entry.line}:${entry.column}`:`${basename(entry.path)}:${entry.line}`)}</span><code>${snippet}</code>`;
  }
  return `<button class="workspace-search-result find-result find-match-row ${selected?"selected":""}" type="button" tabindex="-1" ${common} data-find-result="${entry.index}">${content}</button>`;
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
