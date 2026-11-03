import type {EditorLanguageLocationsPublication,EditorLanguageServiceLocation} from "../../protocol/editor-language-service.ts";
import type {FindLocationResultsSnapshot} from "./find-results-controller.ts";
import type { LocaleCatalog } from "../../localization/catalog.ts";
import type { CommandAvailability } from "../../application/commands/command-service.ts";
import type { SearchCommandAction } from "../../application/commands/search-command-ids.ts";
import type { ProjectFile, WorkspaceTextSearchMatch, WorkspaceTextSearchReport } from "../../models.ts";
import type { NavigationMode } from "./navigation.ts";
import { FindResultsController } from "./find-results-controller.ts";
import { FindLocationPreviews } from "./find-location-previews.ts";
import { diagnostics } from "../../application/diagnostics.ts";
import { renderFindLocationPreview, renderFindHeaderActions, renderFindResults } from "./find-results-view.ts";

interface FindResultsSource {
  readonly mode: NavigationMode | null;
  readonly repositoryRoot: string | null;
  readonly query: string;
  readonly files: readonly ProjectFile[];
  readonly searchRepositoryRoot: string | null;
  readonly report: WorkspaceTextSearchReport | null;
  readonly searchCurrent: boolean;
}

export interface FindResultsRuntimeOptions {
  readonly copy: () => LocaleCatalog;
  readonly source: () => FindResultsSource;
  readonly activeWorkspaceGeneration?:()=>number|null;
  readonly openLocation?:(location:EditorLanguageServiceLocation)=>Promise<void>;
  readonly readLocationSource?:(root:string,location:EditorLanguageServiceLocation)=>Promise<string|null>;
  readonly activeRepositoryRoot: () => string | null;
  readonly activeFilePath: () => string | null;
  readonly locateCurrentFile: () => void;
  readonly openSearch: () => void;
  readonly openPanel: () => void;
  readonly openFile: (repositoryRoot: string, file: ProjectFile) => Promise<void>;
  readonly openMatch: (repositoryRoot: string, match: WorkspaceTextSearchMatch) => Promise<void>;
  readonly wrongWorkspace: () => void;
  readonly visible: () => boolean;
  readonly presentationChanged: () => void;
}

export class FindResultsRuntime {
  private readonly previews: FindLocationPreviews;
  private previewObserver: ResizeObserver | null = null;
  private previewFrame: number | null = null;
  private previewTrace = "";
  private readonly controller = new FindResultsController();
  private readonly root: HTMLElement;
  private readonly options: FindResultsRuntimeOptions;

  constructor(
    root: HTMLElement,
    options: FindResultsRuntimeOptions,
  ) {
    this.root = root;
    this.options = options;
    this.previews = new FindLocationPreviews({
      current: (snapshot) => this.locationsCurrent(snapshot),
      read: async (root, location) => await options.readLocationSource?.(root, location) ?? null,
      changed: (indices) => this.patchPreviews(indices),
      idle: (summary) => diagnostics.report("info", "find.preview.completed",
        `files=${summary.files};loaded=${summary.loaded};ready=${summary.ready};unavailable=${summary.unavailable}`,
        { traceId: this.previewTrace }),
    });
  }

  bindCommandSurface(): void {
    this.root.querySelector<HTMLButtonElement>("#command-surface-open-find")
      ?.addEventListener("click", () => this.openFromSearch());
  }

  clear(): void {
    this.stopPreviewViewport();
    this.previews.reset(null);
    this.controller.clear();
  }

  render(): void {
    const host = this.query<HTMLElement>("#find-tool-host");
    this.stopPreviewViewport();
    host.innerHTML = renderFindResults(this.controller.state, this.options.copy(),this.previews.values);
    this.renderHeaderActions();
    this.bindResults(host);
    this.observePreviewViewport(host);
  }

  commandAvailability(action: SearchCommandAction): CommandAvailability {
    const state = this.controller.state;
    const unavailable = this.options.copy().settings.keybindings.bottomToolRequired;
    if (!this.options.visible() || !state.snapshot) {
      return { enabled: false, reason: unavailable };
    }
    if (action === "locate-current") {
      return this.options.activeFilePath()
        ? { enabled: true }
        : { enabled: false, reason: unavailable };
    }
    if (action === "toggle-results-view") return { enabled: true };
    return state.fileView === "tree" && (state.fileSelection?.kind === "directory"||state.resultSelection?.startsWith("file:")||state.resultSelection?.startsWith("directory:"))
      ? { enabled: true }
      : { enabled: false, reason: unavailable };
  }

  executeCommand(action: SearchCommandAction): void {
    if (!this.commandAvailability(action).enabled) return;
    this.activateHeaderAction({
      "locate-current": "locate", "toggle-results-view": "view",
      "expand-results": "expand", "collapse-results": "collapse",
    }[action]!);
  }

  private openFromSearch(): void {
    const source = this.options.source();
    const { mode, repositoryRoot } = source;
    let installed = false;
    if (repositoryRoot && (mode === "files" || mode === "recent")) {
      installed = this.controller.installFiles(mode, repositoryRoot, source.query, source.files);
    } else if (
      repositoryRoot && mode === "workspace" && source.searchRepositoryRoot === repositoryRoot &&
      source.report && source.searchCurrent
    ) {
      installed = this.controller.install(repositoryRoot, source.query, source.report);
    }
    if (!installed) return;
    this.previews.reset(null);
    this.options.openPanel();
    queueMicrotask(() => this.focusSelection());
  }

  openLocations(publication:EditorLanguageLocationsPublication):void {
    if(publication.workspaceRoot!==this.options.activeRepositoryRoot()||publication.workspaceGeneration!==this.options.activeWorkspaceGeneration?.())return;
    if(!this.controller.installLocations(publication))return;
    const snapshot=this.controller.state.snapshot;
    this.previews.reset(snapshot?.kind==="locations"?snapshot:null);
    this.previewTrace=diagnostics.newTrace();
    this.options.openPanel();queueMicrotask(()=>this.focusSelection());
  }
  private locationsCurrent(snapshot:FindLocationResultsSnapshot):boolean{return this.controller.state.snapshot===snapshot&&this.options.activeRepositoryRoot()===snapshot.repositoryRoot&&this.options.activeWorkspaceGeneration?.()===snapshot.workspaceGeneration;}

  private stopPreviewViewport(): void {
    this.previewObserver?.disconnect();
    this.previewObserver=null;
    if(this.previewFrame!==null)this.root.ownerDocument.defaultView?.cancelAnimationFrame(this.previewFrame);
    this.previewFrame=null;
  }

  private observePreviewViewport(host: HTMLElement): void {
    if(this.controller.state.snapshot?.kind!=="locations")return;
    const list=host.querySelector<HTMLElement>(".find-results-list");
    if(!list)return;
    list.addEventListener("scroll",()=>this.schedulePreviewViewport(),{passive:true});
    this.previewObserver=new ResizeObserver(()=>this.schedulePreviewViewport());
    this.previewObserver.observe(list);
    this.schedulePreviewViewport();
  }

  private schedulePreviewViewport(): void {
    const view=this.root.ownerDocument.defaultView;
    if(this.previewFrame!==null||!view)return;
    this.previewFrame=view.requestAnimationFrame(()=>{
      this.previewFrame=null;
      const snapshot=this.controller.state.snapshot,list=this.root.querySelector<HTMLElement>(".find-results-list");
      if(snapshot?.kind!=="locations"||!this.locationsCurrent(snapshot)||!this.options.visible()||!list?.clientHeight)return;
      const viewport=list.getBoundingClientRect(),indices:number[]=[];
      for(const row of list.querySelectorAll<HTMLElement>("[data-find-result]")){
        const bounds=row.getBoundingClientRect();
        if(bounds.bottom>=viewport.top-160&&bounds.top<=viewport.bottom+160)indices.push(Number(row.dataset.findResult));
      }
      this.previews.request(indices);
    });
  }

  private patchPreviews(indices: readonly number[]): void {
    // Patch source text only. Replacing the tree here loses focus and the scroll anchor.
    const changed=new Set(indices),copy=this.options.copy().navigation;
    for(const row of this.root.querySelectorAll<HTMLElement>(".find-results-list [data-find-result]")){
      const index=Number(row.dataset.findResult);
      if(!changed.has(index))continue;
      const code=row.querySelector("code");
      if(code)code.innerHTML=renderFindLocationPreview(this.previews.values.get(index),copy);
    }
  }

  private renderHeaderActions(): void {
    const actions = this.query<HTMLElement>("#terminal-header-actions");
    const html = renderFindHeaderActions(
      this.controller.state,
      this.options.copy(),
      this.options.activeFilePath(),
    );
    actions.innerHTML = html;
    actions.classList.toggle("hidden", html.length === 0);
    this.options.presentationChanged();
    if (actions.dataset.findBound === "true") return;
    actions.dataset.findBound = "true";
    actions.addEventListener("click", (event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-collection-command]");
      if (!button || !actions.contains(button)) return;
      this.activateHeaderAction(button.dataset.collectionCommand ?? "");
    });
  }

  private activateHeaderAction(action: string): void {
    if (action === "locate") {
      this.options.locateCurrentFile();
      return;
    }
    if (action === "view" && this.controller.toggleFileView()) {
      this.renderAndReveal(this.controller.state.fileSelection?.path ?? null);
      return;
    }
    if ((action === "expand" || action === "collapse") &&
      this.controller.setSelectedSubtreeExpanded(action === "expand")) {
      this.renderAndReveal(this.controller.state.fileSelection?.path ?? null);
    }
  }

  private bindResults(host: HTMLElement): void {
    host.querySelector<HTMLButtonElement>("[data-find-search]")
      ?.addEventListener("click", this.options.openSearch);
    host.querySelectorAll<HTMLButtonElement>("[data-find-result],[data-find-node]").forEach(button=>{
      button.addEventListener("focus",()=>this.selectResultRow(button,false));
      button.addEventListener("click",()=>{this.selectResultRow(button,false);const node=button.dataset.findNode;if(node){if(this.controller.toggleResultNode(node))this.renderAndReveal(null);}else void this.openSelected();});
    });
    host.querySelectorAll<HTMLButtonElement>("[data-find-path]").forEach((button) => {
      button.addEventListener("mousemove", () => this.selectFile(button, false));
      button.addEventListener("click", () => {
        this.selectFile(button, false);
        if (button.dataset.findKind === "directory") {
          if (this.controller.toggleDirectory(button.dataset.findPath ?? "")) {
            this.renderAndReveal(button.dataset.findPath ?? null);
          }
        } else {
          void this.openSelected();
        }
      });
    });
    host.querySelector<HTMLElement>(".find-results-list")?.addEventListener("keydown", (event) => {
      if (this.controller.state.resultTree.length) this.handleResultKey(event);
      else this.handleFileKey(event);
    });
  }

  private handleResultKey(event:KeyboardEvent):void {
    const rows=Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("[data-find-result],[data-find-node]")),selected=rows.findIndex(row=>row.classList.contains("selected")),current=rows[selected];
    const move=(index:number)=>{const row=rows[index];if(row)this.selectResultRow(row,true);};
    if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){event.preventDefault();move(event.key==="Home"?0:event.key==="End"?rows.length-1:((selected>=0?selected:event.key==="ArrowDown"?-1:0)+(event.key==="ArrowDown"?1:-1)+rows.length)%rows.length);return;}
    if(!current)return;
    if(event.key==="Enter"){event.preventDefault();current.click();return;}
    if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();
    const id=current.dataset.findNode,expanded=current.getAttribute("aria-expanded")==="true";
    if(id&&((event.key==="ArrowRight"&&!expanded)||(event.key==="ArrowLeft"&&expanded))){this.controller.toggleResultNode(id,event.key==="ArrowRight");this.renderAndReveal(null);return;}
    if(event.key==="ArrowRight"&&id&&expanded){move(selected+1);return;}
    if(event.key==="ArrowLeft"){const key=id??`result:${current.dataset.findResult}`,parent=this.controller.resultRows().find(row=>row.id===key)?.parentId;if(parent){const row=this.resultRow(parent);if(row)this.selectResultRow(row,true);}}
  }
  private resultRow(id:string|null):HTMLButtonElement|null {
    if(!id)return null;return Array.from(this.root.querySelectorAll<HTMLButtonElement>("[data-find-node],[data-find-result]")).find(row=>(row.dataset.findNode??`result:${row.dataset.findResult}`)===id)??null;
  }
  private selectResultRow(button:HTMLButtonElement,reveal:boolean):void {
    const previous=this.controller.state.resultSelection,branch=!!button.dataset.findNode;
    const changed=branch?this.controller.selectResultNode(button.dataset.findNode!):this.controller.select(Number(button.dataset.findResult));
    if(changed){syncRowSelection(this.resultRow(previous),button,this.root.querySelector(".find-results-list"));const wasBranch=previous!==null&&!previous.startsWith("result:");if(branch!==wasBranch)this.renderHeaderActions();}
    if(reveal)revealAndFocus(button);
  }

  private handleFileKey(event: KeyboardEvent): void {
    const list = event.currentTarget as HTMLElement;
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>("[data-find-path]"));
    const selected = rows.findIndex((row) => row.classList.contains("selected"));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const base = selected >= 0 ? selected : event.key === "ArrowDown" ? -1 : 0;
      const next = (base + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      const row = rows[next];
      if (row) this.selectFile(row, true);
      return;
    }
    const row = rows[selected];
    if (!row) return;
    if (event.key === "Enter") {
      event.preventDefault();
      row.click();
      return;
    }
    if (row.dataset.findKind !== "directory" || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    const expanded = row.getAttribute("aria-expanded") === "true";
    if ((event.key === "ArrowRight" && !expanded) || (event.key === "ArrowLeft" && expanded)) {
      event.preventDefault();
      if (this.controller.toggleDirectory(row.dataset.findPath ?? "")) {
        this.renderAndReveal(row.dataset.findPath ?? null);
      }
    }
  }

  private selectFile(button: HTMLButtonElement, reveal: boolean): void {
    const previous = this.controller.state.fileSelection?.path ?? null;
    const kind = button.dataset.findKind === "directory" ? "directory" : "file";
    if (!this.controller.selectFile(button.dataset.findPath ?? "", kind)) return;
    const previousRow = this.fileRow(previous);
    syncRowSelection(previousRow, button, this.root.querySelector(".find-results-list"));
    this.renderHeaderActions();
    if (reveal) revealAndFocus(button);
  }

  private renderAndReveal(path: string | null): void {
    const current = this.root.querySelector<HTMLElement>(".find-results-list");
    const scroll = [current?.scrollTop ?? 0, current?.scrollLeft ?? 0] as const;
    this.render();
    const next = this.root.querySelector<HTMLElement>(".find-results-list");
    if (next) [next.scrollTop, next.scrollLeft] = scroll;
    queueMicrotask(() => revealAndFocus(this.controller.state.resultTree.length?this.resultRow(this.controller.state.resultSelection):this.fileRow(path)));
  }

  private focusSelection(): void {
    const state = this.controller.state;
    const target = state.resultTree.length
      ? this.resultRow(state.resultSelection)
      : this.fileRow(state.fileSelection?.path ?? null);
    revealAndFocus(target);
  }

  private fileRow(path: string | null): HTMLButtonElement | null {
    if (!path) return null;
    return Array.from(this.root.querySelectorAll<HTMLButtonElement>("[data-find-path]"))
      .find((row) => row.dataset.findPath === path) ?? null;
  }

  private async openSelected(): Promise<void> {
    const snapshot = this.controller.state.snapshot;
    if (!snapshot || this.options.activeRepositoryRoot() !== snapshot.repositoryRoot) {
      this.options.wrongWorkspace();
      return;
    }
    if(snapshot.kind==="locations"){
      if(snapshot.workspaceGeneration!==this.options.activeWorkspaceGeneration?.()){this.options.wrongWorkspace();return;}
      const location=this.controller.selectedLocation();if(location)await this.options.openLocation?.(location);return;
    }
    if (snapshot.kind === "workspace") {
      const match = this.controller.selectedMatch();
      if (match) await this.options.openMatch(snapshot.repositoryRoot, match);
      return;
    }
    const file = this.controller.selectedFile();
    if (file) await this.options.openFile(snapshot.repositoryRoot, file);
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Find results element: ${selector}`);
    return element;
  }
}

function syncRowSelection(
  previous: HTMLElement | null,
  selected: HTMLElement | null,
  list: Element | null,
): void {
  if (previous !== selected) {
    previous?.classList.remove("selected");
    previous?.setAttribute("aria-selected", "false");
  }
  selected?.classList.add("selected");
  selected?.setAttribute("aria-selected", "true");
  list?.setAttribute("aria-activedescendant", selected?.id ?? "");
}

function revealAndFocus(row: HTMLElement | null): void {
  row?.scrollIntoView({ block: "nearest" });
  row?.focus();
}
