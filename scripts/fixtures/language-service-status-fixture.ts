import "../../src/styles.css";
import "../../src/features/language-services/language-service-status.css";
import {LanguageServiceStatusView} from "../../src/features/language-services/language-service-status-view.ts";
import {EN_US_LANGUAGE_SERVICE_COPY} from "../../src/localization/language-service-copy.ts";
const intervals=new Set<number>(),set=window.setInterval.bind(window),clear=window.clearInterval.bind(window);
window.setInterval=((...args:Parameters<typeof window.setInterval>)=>{const id=set(...args);intervals.add(id);return id;}) as typeof window.setInterval;
window.clearInterval=(id:number|undefined)=>{if(id!==undefined)intervals.delete(id);clear(id);};
const actions:string[]=[];
let debug=false,view:LanguageServiceStatusView;
const scope={workspaceRoot:"/repo",workspaceGeneration:1,pluginId:"dev.asterlyn.lsp",providerVersion:"0.3.8",serverId:"android-jvm"};
let state:any={scope,sessionId:"session-1",label:"Java / Kotlin",state:"indexing",startedAt:Date.now()-2000,progress:{phase:"model"}};
const mount=()=>{view=new LanguageServiceStatusView(document.querySelector("footer")!,()=>EN_US_LANGUAGE_SERVICE_COPY,{retry:()=>actions.push("retry"),forget:()=>actions.push("forget"),debug:value=>{debug=value;actions.push(`debug:${value}`);view.update([state],debug);},error:error=>{throw error;}});view.update([state],debug);};
mount();
(window as any).languageStatusFixture={
 update(value:any){state={...state,...value};view.update([state],debug);},
 rerender(){document.querySelector("footer")!.innerHTML='<span id="status-message">Ready</span>';view.update([state],debug);},
 empty(){view.update([],debug);},
 cycles(){for(let n=0;n<20;n++){view.dispose();mount();}},
 dispose(){view.dispose();},
 snapshot(){return{actions:[...actions],intervals:intervals.size};},
};
