import {buildFindResultTree,findResultBranches,findResultRows,type FindResultNode,type FindTreeEntry} from "./find-result-tree.ts";
import {normalizeDefinitionTargets} from "../../application/language-services/definition-targets.ts";
import type {EditorLanguageLocationsPublication,EditorLanguageServiceLocation} from "../../protocol/editor-language-service.ts";
import type { ProjectFile, WorkspaceTextSearchMatch, WorkspaceTextSearchReport } from "../../models.ts";
import { sortFilesByName } from "../../presentation/file-name-order.ts";
import {
  buildProjectTree,
  descendantProjectDirectories,
  findProjectTreeNode,
  type ProjectTreeNode,
  type ProjectTreeSelection,
} from "../../presentation/project-tree.ts";

export type FindFileView = "tree" | "flat";

export interface FindTextResultsSnapshot {
  readonly kind: "workspace";
  readonly repositoryRoot: string;
  readonly query: string;
  readonly report: WorkspaceTextSearchReport;
}

export interface FindFileResultsSnapshot {
  readonly kind: "files" | "recent";
  readonly repositoryRoot: string;
  readonly query: string;
  readonly files: readonly ProjectFile[];
}

export interface FindLocationResultsSnapshot {readonly kind:"locations";readonly repositoryRoot:string;readonly workspaceGeneration:number;readonly query:string;readonly intent:"definition"|"references";readonly locations:readonly EditorLanguageServiceLocation[];readonly limited:boolean;}
export type FindResultsSnapshot = FindTextResultsSnapshot | FindFileResultsSnapshot | FindLocationResultsSnapshot;

export interface FindResultsState {
  readonly snapshot: FindResultsSnapshot | null;
  readonly selectedIndex: number;
  readonly resultSelection:string|null;
  readonly resultTree:readonly FindResultNode[];
  readonly fileSelection: ProjectTreeSelection | null;
  readonly fileView: FindFileView;
  readonly expandedDirectories: ReadonlySet<string>;
}

export class FindResultsController {
  private value: FindResultsState = emptyState("tree");

  get state(): Readonly<FindResultsState> {
    return this.value;
  }

  install(
    repositoryRoot: string,
    query: string,
    report: WorkspaceTextSearchReport,
  ): boolean {
    if (!repositoryRoot || !query.trim() || report.matches.length === 0) return false;
    this.installResults({kind:"workspace",repositoryRoot,query,report},report.matches.map((m,index)=>({index,fileKey:m.workspacePath,path:m.workspacePath,line:m.line,column:m.columnUtf16})));
    return true;
  }

  installLocations(publication:EditorLanguageLocationsPublication):boolean {
    const normalized=normalizeDefinitionTargets(publication.locations,publication.kind);
    if(!publication.workspaceRoot||!normalized.locations.length||normalized.invalid)return false;
    const locations=normalized.locations;
    this.installResults({kind:"locations",repositoryRoot:publication.workspaceRoot,workspaceGeneration:publication.workspaceGeneration,query:publication.query,intent:publication.kind,locations,limited:publication.limited||normalized.limited},locations.map((location,index)=>{
      const url=new URL(location.uri),absolute=decodeURIComponent(url.pathname),prefix=publication.workspaceRoot.replace(/\\/gu,"/").replace(/\/$/u,"")+"/";
      const path=location.readonlySource?.path??(absolute.startsWith(prefix)?absolute.slice(prefix.length):absolute.replace(/^\/+/,""));
      return {index,fileKey:location.uri,path,line:location.range.start.line+1,column:location.range.start.character+1};
    }));if(Number.isSafeInteger(publication.selectedIndex))this.select(publication.selectedIndex!);return true;
  }
  private installResults(snapshot:FindTextResultsSnapshot|FindLocationResultsSnapshot,entries:readonly FindTreeEntry[]):void {
    const resultTree=buildFindResultTree(entries);this.value={...emptyState(this.value.fileView),snapshot,resultTree,resultSelection:"result:0",expandedDirectories:new Set(findResultBranches(resultTree).map(n=>n.id))};
  }
  selectResultNode(id:string):boolean {
    const branch=findResultBranches(this.value.resultTree).find(n=>n.id===id);if(!branch||this.value.resultSelection===id)return false;
    this.value={...this.value,resultSelection:id};return true;
  }
  toggleResultNode(id:string,expanded?:boolean):boolean {
    const node=findResultBranches(this.value.resultTree).find(n=>n.id===id);if(!node)return false;
    const next=new Set(this.value.expandedDirectories),open=expanded??!next.has(id);if(open)next.add(id);else next.delete(id);
    this.value={...this.value,resultSelection:id,expandedDirectories:next};return true;
  }
  resultRows(){return findResultRows(this.value.resultTree,this.value.expandedDirectories);}
  selectedLocation():EditorLanguageServiceLocation|null {const s=this.value.snapshot;return s?.kind==="locations"?s.locations[this.value.selectedIndex]??null:null;}

  installFiles(
    kind: "files" | "recent",
    repositoryRoot: string,
    query: string,
    files: readonly ProjectFile[],
  ): boolean {
    if (!repositoryRoot || files.length === 0) return false;
    const snapshot: FindFileResultsSnapshot = { kind, repositoryRoot, query, files: [...files] };
    const first = sortedFindFiles(snapshot)[0] ?? null;
    this.value = {
      snapshot,
      selectedIndex: 0,
      resultSelection:null,resultTree:[],
      fileSelection: first ? { path: first.workspacePath, kind: "file" } : null,
      fileView: this.value.fileView,
      expandedDirectories: new Set(allDirectoryPaths(findFileTree(snapshot))),
    };
    return true;
  }

  clear(): void {
    this.value = emptyState(this.value.fileView);
  }

  select(index: number): boolean {
    const snapshot = this.value.snapshot;
    const count = snapshot?.kind === "workspace" ? snapshot.report.matches.length : snapshot?.kind==="locations"?snapshot.locations.length:0;
    if (!Number.isInteger(index) || index < 0 || index >= count) return false;
    if (this.value.selectedIndex === index&&this.value.resultSelection===`result:${index}`) return false;
    this.value = { ...this.value, selectedIndex: index,resultSelection:`result:${index}` };
    return true;
  }

  move(delta: number): boolean {
    const snapshot = this.value.snapshot;
    const count = snapshot?.kind === "workspace" ? snapshot.report.matches.length : snapshot?.kind==="locations"?snapshot.locations.length:0;
    if (count === 0) return false;
    const selectedIndex = (this.value.selectedIndex + delta % count + count) % count;
    if (selectedIndex === this.value.selectedIndex) return false;
    this.value = { ...this.value, selectedIndex,resultSelection:`result:${selectedIndex}` };
    return true;
  }

  selectFile(path: string, kind: ProjectTreeSelection["kind"]): boolean {
    const snapshot = fileSnapshot(this.value.snapshot);
    const node = snapshot ? findProjectTreeNode(findFileTree(snapshot), path) : null;
    if (!node || node.kind !== kind) return false;
    if (this.value.fileSelection?.path === path && this.value.fileSelection.kind === kind) return false;
    this.value = { ...this.value, fileSelection: { path, kind } };
    return true;
  }

  toggleDirectory(path: string): boolean {
    const snapshot = fileSnapshot(this.value.snapshot);
    const node = snapshot ? findProjectTreeNode(findFileTree(snapshot), path) : null;
    if (!node || node.kind !== "directory") return false;
    const expandedDirectories = new Set(this.value.expandedDirectories);
    if (expandedDirectories.has(path)) expandedDirectories.delete(path);
    else expandedDirectories.add(path);
    this.value = { ...this.value, fileSelection: { path, kind: "directory" }, expandedDirectories };
    return true;
  }

  toggleFileView(): boolean {
    const snapshot = this.value.snapshot;
    if (!snapshot) return false;
    if(snapshot.kind==="workspace"||snapshot.kind==="locations"){
      const fileView=this.value.fileView==="tree"?"flat":"tree",expandedDirectories=new Set(this.value.expandedDirectories);
      if(fileView==="tree"){
        const reveal=(nodes:readonly FindResultNode[],parents:string[]):boolean=>{for(const node of nodes){const path=[...parents,node.id];if(node.entries.some(entry=>entry.index===this.value.selectedIndex)){for(const id of path)expandedDirectories.add(id);return true;}if(reveal(node.children,path))return true;}return false;};reveal(this.value.resultTree,[]);
      }
      this.value={...this.value,fileView,resultSelection:`result:${this.value.selectedIndex}`,expandedDirectories};return true;
    }
    const fileView = this.value.fileView === "tree" ? "flat" : "tree";
    const first = fileView === "flat" && this.value.fileSelection?.kind === "directory"
      ? sortedFindFiles(snapshot)[0] ?? null
      : null;
    this.value = {
      ...this.value,
      fileView,
      fileSelection: first ? { path: first.workspacePath, kind: "file" } : this.value.fileSelection,
    };
    return true;
  }

  setSelectedSubtreeExpanded(expanded: boolean): boolean {
    if(this.value.resultTree.length){const node=findResultBranches(this.value.resultTree).find(n=>n.id===this.value.resultSelection);if(!node)return false;const next=new Set(this.value.expandedDirectories);for(const child of findResultBranches([node])){if(expanded)next.add(child.id);else next.delete(child.id);}this.value={...this.value,expandedDirectories:next};return true;}
    const snapshot = fileSnapshot(this.value.snapshot);
    const selection = this.value.fileSelection;
    const node = snapshot && selection?.kind === "directory"
      ? findProjectTreeNode(findFileTree(snapshot), selection.path)
      : null;
    if (!node || node.kind !== "directory") return false;
    const expandedDirectories = new Set(this.value.expandedDirectories);
    for (const path of descendantProjectDirectories(node)) {
      if (expanded) expandedDirectories.add(path);
      else expandedDirectories.delete(path);
    }
    this.value = { ...this.value, expandedDirectories };
    return true;
  }

  selectedMatch(): WorkspaceTextSearchMatch | null {
    const snapshot = this.value.snapshot;
    return snapshot?.kind === "workspace" ? snapshot.report.matches[this.value.selectedIndex] ?? null : null;
  }

  selectedFile(): ProjectFile | null {
    const snapshot = fileSnapshot(this.value.snapshot);
    const selection = this.value.fileSelection;
    return selection?.kind === "file"
      ? snapshot?.files.find((file) => file.workspacePath === selection.path) ?? null
      : null;
  }
}

export function findFileTree(snapshot: FindFileResultsSnapshot): ProjectTreeNode[] {
  return buildProjectTree(snapshot.files.map((file) => file.workspacePath));
}

export function sortedFindFiles(snapshot: FindFileResultsSnapshot): ProjectFile[] {
  const byPath = new Map(snapshot.files.map((file) => [file.workspacePath, file]));
  return sortFilesByName(snapshot.files.map((file) => ({ path: file.workspacePath })))
    .map((entry) => byPath.get(entry.path)!)
    .filter(Boolean);
}

function fileSnapshot(snapshot: FindResultsSnapshot | null): FindFileResultsSnapshot | null {
  return snapshot && (snapshot.kind === "files"||snapshot.kind === "recent") ? snapshot : null;
}

function allDirectoryPaths(nodes: readonly ProjectTreeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "directory" ? descendantProjectDirectories(node) : []);
}

function emptyState(fileView: FindFileView): FindResultsState {
  return { snapshot: null, selectedIndex: 0, resultSelection:null,resultTree:[],fileSelection: null, fileView, expandedDirectories: new Set() };
}
