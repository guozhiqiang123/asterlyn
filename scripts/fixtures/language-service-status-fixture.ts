import "../../src/styles.css";
import "../../src/features/language-services/language-service-status.css";
import {createLanguageServicesRuntime} from "../../src/composition/language-services-runtime.ts";
import {LanguageServiceStatusView} from "../../src/features/language-services/language-service-status-view.ts";
import {EN_US_LANGUAGE_SERVICE_COPY} from "../../src/localization/language-service-copy.ts";
const intervals=new Set<number>(),set=window.setInterval.bind(window),clear=window.clearInterval.bind(window);
window.setInterval=((...args:Parameters<typeof window.setInterval>)=>{const id=set(...args);intervals.add(id);return id;}) as typeof window.setInterval;
window.clearInterval=(id:number|undefined)=>{if(id!==undefined)intervals.delete(id);clear(id);};
const actions:string[]=[];
let debug=false,view:LanguageServiceStatusView;
let runtime:ReturnType<typeof createLanguageServicesRuntime>|null=null,providerChanged=()=>{},providerEnabled=true,starts=0;
const scope={workspaceRoot:"/repo",workspaceGeneration:1,pluginId:"dev.asterlyn.lsp",providerVersion:"0.3.8",serverId:"android-jvm"};
let state:any={scope,sessionId:"session-1",label:"Java / Kotlin",state:"indexing",startedAt:Date.now()-2000,progress:{phase:"model"}};
const mount=()=>{view=new LanguageServiceStatusView(document.querySelector("footer")!,()=>EN_US_LANGUAGE_SERVICE_COPY,{resources:value=>actions.push(`resources:${value}`),selectProvider:(language,id)=>actions.push(`provider:${language}:${id}`),retry:()=>actions.push("retry"),forget:()=>actions.push("forget"),debug:value=>{debug=value;actions.push(`debug:${value}`);view.update([state],debug);},error:error=>{throw error;}});view.update([state],debug);};
mount();
(window as any).languageStatusFixture={
 update(value:any){state={...state,...value};view.update([state],debug);},
 rerender(){document.querySelector("footer")!.innerHTML='<span id="status-message">Ready</span>';view.update([state],debug);},
 empty(){view.update([],debug);},
 cycles(){for(let n=0;n<20;n++){view.dispose();mount();}},
 runtime(){
  view.dispose();const provider={kind:"language-service",qualifiedId:"dev.asterlyn.lsp:android",pluginId:"dev.asterlyn.lsp",pluginVersion:"0.3.8",serverId:"android-jvm",label:"Java / Kotlin",languageIds:["java","kotlin"],extensions:[".java",".kt"]};
  runtime=createLanguageServicesRuntime({host:document.querySelector("footer")!,copy:()=>EN_US_LANGUAGE_SERVICE_COPY,registry:{list:()=>providerEnabled?[provider]:[],subscribe:listener=>{providerChanged=listener;return()=>{};}} as any,workspace:()=>({root:"/repo",generation:1}),document:()=>null,bind(){},navigate(){},reportError:error=>{throw error;},native:{workspace:async()=>({startupProfiles:[{pluginId:provider.pluginId,serverId:provider.serverId}],debugTracing:false}),prepare:async()=>({reviewId:"review",pluginId:provider.pluginId,serverId:provider.serverId,pluginVersion:provider.pluginVersion,packageDigest:"package",resourceDigest:"resource",executableIdentity:"node",expiresAt:Date.now()+60000,remembered:true}),confirm:async()=>true,start:async()=>`runtime-${++starts}`,subscribe:()=>()=>{},stop:async()=>{}} as any});runtime.refresh();
 },
 async lazyDisposed(){
  view.dispose();const commands:any[]=[];
  const late=createLanguageServicesRuntime({host:document.querySelector("footer")!,copy:()=>EN_US_LANGUAGE_SERVICE_COPY,registerCommand:command=>{commands.push(command);return()=>{};},registry:{list:()=>[],subscribe:()=>()=>{}} as any,workspace:()=>({root:"/repo",generation:1}),document:()=>null,bind(){},navigate(){},reportError:error=>{throw error;},native:{subscribe:()=>()=>{},confirm:async()=>false} as any});
  const opening=commands.find(command=>command.id==="languageServices.status").execute();late.dispose();await opening;
 },
 provider(enabled:boolean){providerEnabled=enabled;providerChanged();},
 dispose(){runtime?.dispose();view.dispose();},
 resources(){view.update([state],debug,{schema:1,physicalMiB:16384,budgetMiB:8192,maxHeapMiB:4096,compilerMaxMiB:null,choicesMiB:[1024,2048,4096,6144]});},
 snapshot(){return{actions:[...actions],intervals:intervals.size,starts};},
};
