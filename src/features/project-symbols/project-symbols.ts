import type {ProjectSymbolsNativePort} from "../../protocol/project-symbols.ts";
import type {SymbolCandidate,SymbolOverlay,SymbolQueryReport} from "../../protocol/generated-native-language-types.ts";
export interface SymbolWorkspace {root:string;generation:number}
export interface ProjectSymbolsPorts extends ProjectSymbolsNativePort {
 workspace():SymbolWorkspace|null;
 overlays():ReadonlyArray<SymbolOverlay>;
 origin():string|null;
 navigate(root:string,candidate:SymbolCandidate):Promise<void>;
 chinese():boolean;
}
/** Explicit lazy surface; no indexing or buffer retention while closed. */
export class ProjectSymbols {
 private dialog:HTMLDialogElement|null=null;
 private timer:ReturnType<typeof setTimeout>|null=null;
 private monitor:ReturnType<typeof setInterval>|null=null;
 private sequence=0;
 private pending:string|null=null;
 private disposed=false;
 private restoreFocus:(()=>void)|null=null;
 constructor(private readonly host:HTMLElement,private readonly ports:ProjectSymbolsPorts){}
 open():void {
  if(this.disposed)return;
  if(this.dialog?.isConnected){this.dialog.querySelector("input")?.focus();return;}
  const workspace=this.ports.workspace();if(!workspace)return;
  const doc=this.host.ownerDocument,previous=doc.activeElement,zh=this.ports.chinese();
  this.restoreFocus=()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
  const dialog=doc.createElement("dialog");this.dialog=dialog;dialog.className="project-symbols";dialog.setAttribute("aria-labelledby","project-symbols-title");
  const heading=doc.createElement("h2");heading.id="project-symbols-title";heading.textContent=zh?"项目符号 · 语法候选":"Project Symbols · Syntax candidates";
  const close=doc.createElement("button");close.type="button";close.textContent=zh?"关闭":"Close";close.addEventListener("click",()=>this.close());
  const header=doc.createElement("header");header.append(heading,close);
  const input=doc.createElement("input");input.type="search";input.placeholder=zh?"按名称查找符号":"Find symbols by name";input.setAttribute("aria-label",input.placeholder);input.maxLength=128;
  const status=doc.createElement("p");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const list=doc.createElement("div");list.className="project-symbols-list";list.setAttribute("role","listbox");list.setAttribute("aria-label",heading.textContent);input.setAttribute("aria-controls","project-symbols-list");list.id="project-symbols-list";
  const note=doc.createElement("small");note.textContent=zh?"按需提取声明；结果不是语义引用。Android 范围取决于已启用语言服务的项目模型。":"Declarations extracted on demand; these are not semantic references. Android scope requires an approved language-service project model.";
  dialog.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();this.close();}});
  dialog.append(header,input,status,list,note);doc.body.append(dialog);dialog.addEventListener("cancel",event=>{event.preventDefault();this.close();});
  dialog.addEventListener("close",()=>{if(this.dialog===dialog)this.close();});
  let report:SymbolQueryReport|null=null,selection=0,overlaySignature="",queryOrigin:string|null=null,busy=false;
  const stillCurrent=()=>{const current=this.ports.workspace();return this.dialog===dialog&&current?.root===workspace.root&&current.generation===workspace.generation;};
  const select=(index:number)=>{selection=Math.max(0,Math.min((report?.matches.length??1)-1,index));Array.from(list.children).forEach((node,i)=>node.setAttribute("aria-selected",String(i===selection)));const row=list.children[selection];if(row){input.setAttribute("aria-activedescendant",row.id);row.scrollIntoView({block:"nearest"});}else input.removeAttribute("aria-activedescendant");};
  const open=async(index:number)=>{
   if(busy||!report||!stillCurrent())return;
   const candidate=report.matches[index];if(!candidate)return;busy=true;input.disabled=true;
   try {
    const overlays=this.ports.overlays();if(JSON.stringify(overlays)!==overlaySignature){status.textContent=zh?"源码已更改，请重新查询。":"Source changed. Search again.";schedule();return;}
    const overlay=overlays.find(o=>o.workspacePath===candidate.workspacePath)??null;
    if(!await this.ports.validate(workspace.root,candidate,report,queryOrigin,overlay)||!stillCurrent()||JSON.stringify(this.ports.overlays())!==overlaySignature){status.textContent=zh?"结果已过期，请重新查询。":"Results changed. Search again.";schedule();return;}
    this.close();await this.ports.navigate(workspace.root,candidate);
   }catch{if(stillCurrent())status.textContent=zh?"无法打开此结果，请重新查询。":"Unable to open this result. Search again.";}
   finally{busy=false;input.disabled=false;}
  };
  const execute=async(token:number)=>{
   if(!stillCurrent()||token!==this.sequence)return;
   const id=`symbols-${Date.now()}-${token}`;this.pending=id;const overlays=this.ports.overlays(),origin=this.ports.origin();const signature=JSON.stringify(overlays);
   try {const value=await this.ports.query(workspace.root,id,input.value,origin,overlays);if(!stillCurrent()||token!==this.sequence)return;
    report=value;overlaySignature=signature;queryOrigin=origin;list.replaceChildren();
    for(const [index,item]of value.matches.entries()){const row=doc.createElement("div");row.id=`project-symbol-${token}-${index}`;row.setAttribute("role","option");const name=doc.createElement("strong");name.textContent=item.name;const detail=doc.createElement("span");detail.textContent=`${item.kind} · ${item.workspacePath}:${item.range.start.line+1}:${item.range.start.character+1}${item.overlay?(zh?" · 未保存":" · Unsaved"):""}`;row.append(name,detail);row.addEventListener("click",()=>{void open(index);});list.append(row);}
    status.textContent=zh?`${value.matches.length} 个候选 · ${value.reusedFiles}/${value.filesScanned} 个文件复用${value.partial?" · 部分范围（模型、文件或预算受限）":""}`:`${value.matches.length} candidates · ${value.reusedFiles}/${value.filesScanned} files reused${value.partial?" · Partial scope (model, files or budget limited)":""}`;select(0);
   }catch{if(stillCurrent()&&token===this.sequence){status.textContent=zh?"符号查询不可用。请确认语言插件已启用，或稍后重试。":"Symbol search unavailable. Enable the language plugin or try again shortly.";}}
   finally{if(this.pending===id)this.pending=null;}
  };
  const schedule=()=>{const token=++this.sequence;if(this.timer)clearTimeout(this.timer);if(this.pending){void this.ports.cancel(this.pending).catch(()=>{});this.pending=null;}report=null;list.replaceChildren();input.removeAttribute("aria-activedescendant");status.textContent=zh?"正在查找语法候选…":"Finding syntax candidates…";this.timer=setTimeout(()=>{this.timer=null;void execute(token);},120);};
  input.addEventListener("input",schedule);input.addEventListener("keydown",event=>{if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();select(selection+(event.key==="ArrowDown"?1:-1));}if(event.key==="Enter"){event.preventDefault();void open(selection);}});
  this.monitor=setInterval(()=>{if(!stillCurrent())this.close();},200);
  dialog.showModal();input.focus();schedule();
 }
 close():void{++this.sequence;if(this.timer)clearTimeout(this.timer);this.timer=null;if(this.monitor)clearInterval(this.monitor);this.monitor=null;if(this.pending)void this.ports.cancel(this.pending).catch(()=>{});this.pending=null;const dialog=this.dialog;this.dialog=null;if(dialog){dialog.close();dialog.remove();}this.restoreFocus?.();this.restoreFocus=null;}
 dispose():void{this.disposed=true;this.close();}
}
