import {toolchainDescription} from "../../localization/toolchain-copy.ts";
import type { LanguageServiceStatus } from "./language-service-client.ts";
import type { LanguageServiceCopy } from "../../localization/language-service-copy.ts";

type Status=LanguageServiceStatus & {label:string};
const busy=(state:Status)=>["recovering","preparing","awaiting-approval","indexing"].includes(state.state)||((state.state==="ready"||state.state==="partial")&&state.progress!==undefined&&!["ready","failed"].includes(state.progress.phase));

/** One persistent footer control; phase announcements exclude the once-per-second timer. */
export class LanguageServiceStatusView {
  private readonly host:HTMLElement;
  private readonly copy:()=>LanguageServiceCopy;
  private readonly button:HTMLButtonElement;
  private readonly caption:HTMLSpanElement;
  private readonly elapsed:HTMLSpanElement;
  private readonly panel:HTMLDivElement;
  private readonly list:HTMLDivElement;
  private readonly title:HTMLElement;
  private readonly closeButton:HTMLButtonElement;
  private readonly retryButton:HTMLButtonElement;
  private readonly forgetButton:HTMLButtonElement;
  private readonly debug:HTMLInputElement;
  private readonly debugLabel:HTMLSpanElement;
  private readonly resourceSelect:HTMLSelectElement;
  private readonly resourceLabel:HTMLSpanElement;
  private readonly resourceHint:HTMLElement;
  private readonly debugHint:HTMLElement;
  private readonly abort=new AbortController();
  private timer:ReturnType<typeof setInterval>|null=null;
  private states:readonly Status[]=[];
  private key="";
  private disposed=false;
  private returnFocus:HTMLElement|null=null;
  private readonly actions:{selectProvider?(language:string,id:string):void};
  constructor(host:HTMLElement,copy:()=>LanguageServiceCopy,actions:{resources?(value:number|null):void|Promise<void>;selectProvider?(language:string,id:string):void;retry():void;forget():void;debug(enabled:boolean):void;error(error:unknown):void}){
    this.actions=actions;this.host=host;this.copy=copy;
    const doc=host.ownerDocument;
    this.button=doc.createElement("button");this.button.id="language-service-status";this.button.type="button";this.button.hidden=true;this.button.className="language-service-status";this.button.setAttribute("aria-haspopup","dialog");this.button.setAttribute("aria-controls","language-service-details");this.button.setAttribute("aria-expanded","false");
    this.caption=doc.createElement("span");this.caption.setAttribute("role","status");this.caption.setAttribute("aria-live","polite");
    this.elapsed=doc.createElement("span");this.elapsed.setAttribute("aria-hidden","true");this.button.append(this.caption,this.elapsed);
    this.panel=doc.createElement("div");this.panel.id="language-service-details";this.panel.className="language-service-details";this.panel.setAttribute("role","dialog");this.panel.setAttribute("aria-modal","false");this.panel.hidden=true;
    this.title=doc.createElement("strong");this.title.id="language-service-details-title";this.panel.setAttribute("aria-labelledby",this.title.id);
    this.closeButton=doc.createElement("button");this.closeButton.type="button";this.closeButton.textContent="×";this.closeButton.className="language-service-close";
    const header=doc.createElement("header");header.append(this.title,this.closeButton);
    this.list=doc.createElement("div");this.list.className="language-service-list";
    this.retryButton=doc.createElement("button");this.retryButton.type="button";this.retryButton.dataset.action="retry";
    this.forgetButton=doc.createElement("button");this.forgetButton.type="button";
    const controls=doc.createElement("div");controls.className="language-service-actions";controls.append(this.retryButton,this.forgetButton);
    const debugLabel=doc.createElement("label");this.debug=doc.createElement("input");this.debug.type="checkbox";this.debug.dataset.action="debug";this.debugLabel=doc.createElement("span");debugLabel.append(this.debug,this.debugLabel);
    const resourceLabel=doc.createElement("label");this.resourceLabel=doc.createElement("span");this.resourceSelect=doc.createElement("select");this.resourceSelect.dataset.action="resources";resourceLabel.append(this.resourceLabel,this.resourceSelect);this.resourceHint=doc.createElement("small");
    this.resourceSelect.addEventListener("change",()=>{const value=this.resourceSelect.value==="auto"?null:Number(this.resourceSelect.value);this.resourceSelect.disabled=true;void Promise.resolve(actions.resources?.(value)).catch(actions.error).finally(()=>{if(!this.disposed)this.resourceSelect.disabled=this.resourceSelect.dataset.available!=="true";});},{signal:this.abort.signal});
    this.debugHint=doc.createElement("small");this.panel.append(header,this.list,controls,resourceLabel,this.resourceHint,debugLabel,this.debugHint);host.append(this.panel);
    const signal=this.abort.signal;
    this.button.addEventListener("click",()=>this.panel.hidden?this.open():this.close(true),{signal});
    this.closeButton.addEventListener("click",()=>this.close(true),{signal});
    this.retryButton.addEventListener("click",()=>actions.retry(),{signal});
    this.forgetButton.addEventListener("click",()=>actions.forget(),{signal});
    this.debug.addEventListener("change",()=>actions.debug(this.debug.checked),{signal});
    doc.addEventListener("pointerdown",event=>{if(!this.panel.hidden&&event.target instanceof Node&&!this.panel.contains(event.target)&&!this.button.contains(event.target))this.close(false);},{capture:true,signal});
    this.panel.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();this.close(true);}},{signal});
  }
  private stage(state:Status):string {
    const copy=this.copy().workspaceStatus;
    const stage=(state.state==="indexing"||state.state==="ready"||state.state==="partial")&&state.progress?state.progress.phase:state.state;
    const counts=state.progress?.completed===undefined?"":` · ${state.progress.completed}${state.progress.total===undefined?"":`/${state.progress.total}`} ${copy.units[state.progress.unit??"items"]}`;
    const label=(state.state==="ready"||state.state==="partial")&&state.code&&(!state.progress||["ready","failed"].includes(state.progress.phase))?copy.partiallyReady:copy.stages[stage];
    return `${label}${counts}${state.state==="recovering"&&state.recovery?` (${state.recovery.attempt}/${state.recovery.maximum})`:""}`;
  }
  update(states:readonly Status[],debug:boolean,resources?:import("../../protocol/generated-native-language-types.ts").LanguageResourcePolicy):void{
    if(this.disposed)return;this.states=states;
    if(!this.button.isConnected)this.host.querySelector("#status-message")?.after(this.button);
    if(!this.panel.isConnected)this.host.append(this.panel);
    const copy=this.copy().workspaceStatus;
    this.resourceLabel.textContent=copy.resources;this.resourceSelect.setAttribute("aria-label",copy.resources);this.resourceHint.textContent=copy.resourceHint;this.resourceSelect.dataset.available=String(!!resources);this.resourceSelect.disabled=!resources;
    const resourceKey=JSON.stringify([resources,copy.resourceAuto]);if(this.resourceSelect.dataset.policy!==resourceKey){this.resourceSelect.dataset.policy=resourceKey;this.resourceSelect.replaceChildren();for(const value of [null,...(resources?.choicesMiB??[])]){const option=this.host.ownerDocument.createElement("option");option.value=value===null?"auto":String(value);option.textContent=value===null?copy.resourceAuto:`${value/1024} GiB`;this.resourceSelect.append(option);}}this.resourceSelect.value=String(resources?.compilerMaxMiB??"auto");
    this.button.hidden=!states.length;this.button.title=copy.statusCommand;
    this.title.textContent=copy.title;this.closeButton.setAttribute("aria-label",copy.close);this.retryButton.textContent=copy.retry;this.forgetButton.textContent=copy.forget;this.debugLabel.textContent=copy.debug;this.debugHint.textContent=copy.debugHint;this.debug.checked=debug;
    const primary=states.find(state=>state.state==="failed"||state.state==="conflict")??states.find(busy)??states[0];
    const text=primary?`${copy.title}: ${this.stage(primary)}`:copy.empty;
    if(this.caption.textContent!==text)this.caption.textContent=text;
    this.button.dataset.state=primary?.state??"stopped";
    this.button.dataset.busy=String(!!primary&&busy(primary));
    const key=JSON.stringify([states,copy.title,debug]);
    if(this.key!==key){this.key=key;this.list.replaceChildren();
      if(!states.length)this.list.textContent=copy.empty;
      for(const state of states){const row=this.host.ownerDocument.createElement("section"),label=this.host.ownerDocument.createElement("strong"),stage=this.host.ownerDocument.createElement("span");label.textContent=state.label;stage.textContent=this.stage(state);row.append(label,stage);
        if(state.state==="failed"||((state.state==="ready"||state.state==="partial")&&state.code)){const detail=this.host.ownerDocument.createElement("small");detail.textContent=state.state==="failed"||state.progress?.phase==="failed"?(state.failure?copy.failureReasons[state.failure.code]:copy.failure):copy.partial;row.append(detail);if(state.failure?.project)void import("../../localization/project-language-failure-copy.ts").then(({projectLanguageFailureMessage})=>{if(!this.disposed&&this.key===key&&detail.isConnected)detail.textContent=projectLanguageFailureMessage(state.failure?.project,copy.locale)??detail.textContent;}).catch(()=>{});if(debug&&state.code){const code=this.host.ownerDocument.createElement("code");code.textContent=state.code;row.append(code);}}
        if(state.toolchains?.length){
          const details=this.host.ownerDocument.createElement("details"),summary=this.host.ownerDocument.createElement("summary");summary.textContent=copy.toolchains.title;details.className="language-toolchains";details.append(summary);
          for(const tool of state.toolchains){const description=this.host.ownerDocument.createElement("p");description.textContent=toolchainDescription(tool,copy.toolchains);details.append(description);}row.append(details);
        }
        if(state.choices&&state.selectionKey){
          const hint=this.host.ownerDocument.createElement("small"),select=this.host.ownerDocument.createElement("select");hint.textContent=copy.providerConflict;select.setAttribute("aria-label",`${copy.chooseProvider}: ${state.selectionKey}`);
          const placeholder=this.host.ownerDocument.createElement("option");placeholder.value="";placeholder.textContent=copy.chooseProvider;select.append(placeholder);
          for(const choice of state.choices){const option=this.host.ownerDocument.createElement("option");option.value=choice.id;option.textContent=choice.label;select.append(option);}
          select.value=state.selectedProvider??"";select.addEventListener("change",()=>{this.actions.selectProvider?.(state.selectionKey!,select.value);if(!select.isConnected&&!this.panel.hidden)this.closeButton.focus();});row.append(hint,select);
        }
        if(state.progress?.total!==undefined&&state.progress.completed!==undefined){const progress=this.host.ownerDocument.createElement("progress");progress.max=state.progress.total;progress.value=state.progress.completed;progress.setAttribute("aria-label",this.stage(state));row.append(progress);}this.list.append(row);
      }
    }
    if(states.some(busy)&&!this.timer)this.timer=setInterval(()=>this.tick(),1000);
    if(!states.some(busy)&&this.timer){clearInterval(this.timer);this.timer=null;}this.tick();
  }
  private tick():void{const active=this.states.find(busy);this.elapsed.textContent=active?` · ${this.copy().workspaceStatus.elapsed(Math.max(0,Math.floor((Date.now()-active.startedAt)/1000)))}`:"";}
  open():void{if(this.disposed)return;if(this.panel.hidden){const active=this.host.ownerDocument.activeElement;this.returnFocus=active instanceof HTMLElement&&!this.panel.contains(active)&&(active.tabIndex>=0||active.isContentEditable)?active:null;}this.panel.hidden=false;this.button.setAttribute("aria-expanded","true");this.closeButton.focus();}
  private close(restore:boolean):void{this.panel.hidden=true;this.button.setAttribute("aria-expanded","false");if(restore){if(this.returnFocus?.isConnected)this.returnFocus.focus();else if(!this.button.hidden)this.button.focus();}this.returnFocus=null;}
  dispose():void{if(this.disposed)return;this.disposed=true;this.abort.abort();if(this.timer)clearInterval(this.timer);this.timer=null;this.button.remove();this.panel.remove();this.states=[];}
}
