import type {RegisteredPluginContribution} from "../application/plugins/plugin-types.ts";
import {LanguageProviderPreferences,selectLanguageProvider,type ProviderPreferenceStorage} from "../application/language-services/provider-selection.ts";
import {workspaceFileUri} from "../application/language-services/workspace-file-uri.ts";
export {workspaceFileUri} from "../application/language-services/workspace-file-uri.ts";
import type { PluginContributionRegistry } from "../application/plugins/index.ts";
import { createEditorLanguageServicePort, type NativeLanguageServiceBridge } from "../features/language-services/language-service-client.ts";
import type { EditorLanguageServiceHandle, EditorLanguageServiceLocation, EditorLanguageServicePortFactory } from "../protocol/editor-language-service.ts";
import type { WindowSession } from "../application/window-session.ts";
import type { LanguageServiceStatus } from "../features/language-services/language-service-client.ts";
import type { CommandDescriptor } from "../application/commands/command-service.ts";
import { commandId, WORKBENCH_FOCUS_SCOPES } from "../application/commands/command-service.ts";
import type { LanguageServiceCopy } from "../localization/language-service-copy.ts";
import type { LanguageServiceStatusView } from "../features/language-services/language-service-status-view.ts";

/** One callback supplies both language services and target navigation with their workspace scope. */
export function languageWorkspaceForWindow(session: Pick<WindowSession, "workspace">) {
  return () => session.workspace.identity();
}

export interface LanguageServicesRuntimeOptions {
  readonly notificationPublisher?: import("../application/notifications/notification-center.ts").HostNotificationPublisher;
  readonly providerStorage?:ProviderPreferenceStorage;
  readonly host?: HTMLElement;
  readonly copy?: ()=>LanguageServiceCopy;
  readonly registerCommand?: (command:CommandDescriptor)=>()=>void;
  readonly status?: (status:LanguageServiceStatus)=>void;
  readonly registry: PluginContributionRegistry;
  readonly native: NativeLanguageServiceBridge;
  readonly workspace: () => { root: string; generation: number } | null;
  readonly document: (handle: EditorLanguageServiceHandle) => { workspacePath: string; readOnly: boolean; loadEpoch: number } | null;
  readonly bind: (factory: EditorLanguageServicePortFactory | null) => void;
  readonly reportError: (error: unknown) => void;
  readonly openInWindow?: (results:import("../protocol/editor-language-service.ts").EditorLanguageLocationsPublication)=>void;
  readonly navigate: (location: EditorLanguageServiceLocation) => void;
  readonly readReferenceSource?: (root:string,location:EditorLanguageServiceLocation)=>Promise<string|null>;
  readonly definitionDiagnostic?: (event: import("../protocol/editor-language-service.ts").EditorDefinitionEvent) => void;
  readonly approvalDiagnostic?: (event: import("../protocol/language-service.ts").LanguageServiceApprovalEvent) => void;
  readonly diagnostic?: (fields: { providerCount: number; workspaceGeneration: number | null }) => void;
}
const LANGUAGES: Readonly<Record<string, string>> = { java:"java", kt:"kotlin", kts:"kotlin", groovy:"groovy", gradle:"groovy", rs: "rust", ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact" };
export function createLanguageServicesRuntime(options: LanguageServicesRuntimeOptions) {
  let storage=options.providerStorage;
  try{if(typeof window!=="undefined")storage??=window.localStorage;}catch{/* Persistence is optional. */}
  const preferences=new LanguageProviderPreferences(storage);
  const providersFor=(languageId:string)=>options.registry.list().filter((item):item is Extract<RegisteredPluginContribution,{kind:"language-service"}>=>item.kind==="language-service"&&item.languageIds.includes(languageId));
  const providerFor=(languageId:string)=>{const workspace=options.workspace();return selectLanguageProvider(providersFor(languageId),workspace?preferences.get(workspace.root,languageId):null).provider;};
  let disposed=false,epoch=0,suspended:string|null=null,key="";
  const projectKey=()=>JSON.stringify(options.workspace());
  const states=new Map<string,LanguageServiceStatus>();
  let tipEpoch=0;
  let tips:import("../features/language-services/project-failure-notifications.ts").LanguageProjectFailureNotifications|null=null;
  let tipsLoading:Promise<import("../features/language-services/project-failure-notifications.ts").LanguageProjectFailureNotifications>|null=null;
  const notifyProjectFailure=(id:string,status:LanguageServiceStatus)=>{
    if(tips){tips.observe(id,status);return;}
    if((status.state!=="failed"&&status.progress?.phase!=="failed")||(!status.failure?.project&&status.failure?.code!=="resource-limit")||!options.notificationPublisher)return;
    const token=tipEpoch;
    tipsLoading??=import("../features/language-services/project-failure-notifications.ts").then(({LanguageProjectFailureNotifications})=>tips=new LanguageProjectFailureNotifications(options.notificationPublisher!,()=>options.copy?.().workspaceStatus.locale??"en"));
    void tipsLoading.then(observer=>{const current=states.get(id);if(!disposed&&token===tipEpoch&&current&&scopeCurrent(current.scope))observer.observe(id,current);}).catch(options.reportError);
  };
  const publish=(status:LanguageServiceStatus)=>{
    const workspace=options.workspace();
    if(disposed || workspace?.root!==status.scope.workspaceRoot || workspace.generation!==status.scope.workspaceGeneration)return;
    const provider=options.registry.list().find(item=>item.kind==="language-service"&&item.pluginId===status.scope.pluginId&&item.serverId===(status.scope.serverId??"typescript")&&item.pluginVersion===status.scope.providerVersion);
    if(!provider)return;
    const id=`${status.scope.pluginId}:${status.scope.serverId??"typescript"}`;
    states.set(id,status);
    notifyProjectFailure(id,status);
    options.status?.(status);renderStatus();
  };
  let resourcePolicy:import("../protocol/generated-native-language-types.ts").LanguageResourcePolicy|undefined;
  let debugTracing=false,shownProject=projectKey();
  let view:LanguageServiceStatusView|null=null,viewLoading:Promise<LanguageServiceStatusView|null>|null=null;
  const factory = createEditorLanguageServicePort((handle) => {
    const workspace = options.workspace(); const document = options.document(handle);
    if (!workspace || suspended===projectKey() || !document || document.readOnly || document.loadEpoch !== handle.loadEpoch) return null;
    const extension = document.workspacePath.match(/\.([^.\/]+)$/u)?.[1];
    const languageId = extension ? LANGUAGES[extension] : undefined;
    const providers = options.registry.list().filter((entry) => entry.kind === "language-service" && languageId && entry.languageIds.includes(languageId) && entry.extensions.includes(`.${extension}`));
    if (!languageId) return null;
    const provider = providerFor(languageId);if(!provider||!providers.some(item=>item.qualifiedId===provider.qualifiedId))return null; if (provider.kind !== "language-service") return null; const uri = workspaceFileUri(workspace.root, document.workspacePath);
    return uri ? { workspaceRoot: workspace.root, workspaceGeneration: workspace.generation, uri, languageId, pluginId: provider.pluginId, providerVersion: provider.pluginVersion, serverId: provider.serverId } : null;
  }, options.native, options.reportError, options.navigate, event=>{if(debugTracing)options.definitionDiagnostic?.(event);}, options.approvalDiagnostic,publish,options.openInWindow,options.readReferenceSource);
  function ensureStatusView():Promise<LanguageServiceStatusView|null>{
    if(disposed)return Promise.resolve(null);
    if(view)return Promise.resolve(view);
    const {host,copy}=options;if(!host||!copy)return Promise.resolve(null);
    return viewLoading??=import("../features/language-services/language-service-status-view.ts").then(({LanguageServiceStatusView})=>{
      if(disposed)return null;
      view=new LanguageServiceStatusView(host,copy,{
        resources:async value=>{const workspace=options.workspace();if(!workspace||!options.native.setResources)return;const token=epoch;try{const policy=await options.native.setResources(workspace.root,value);if(disposed||epoch!==token||options.workspace()?.root!==workspace.root)return;resourcePolicy=policy;await retry();}catch(error){renderStatus();options.reportError(error);}},
        selectProvider:(language,id)=>{selectProvider(language,id);},retry:()=>{void retry().catch(options.reportError);},forget:()=>{void forget();},debug:enabled=>{void setDebug(enabled);},error:options.reportError,
      });
      renderStatus();return view;
    }).catch(error=>{viewLoading=null;if(!disposed)options.reportError(error);return null;});
  }
  async function openStatus(){const current=await ensureStatusView();if(!disposed)current?.open();}
  function providerLabel(state:LanguageServiceStatus):string{if(state.selectionKey)return state.selectionKey;const provider=options.registry.list().find(item=>item.kind==="language-service"&&item.pluginId===state.scope.pluginId&&item.serverId===(state.scope.serverId??"typescript"));return provider?.kind==="language-service"?provider.label:state.scope.serverId??"Language services";}
  function renderStatus(){if(!view){if(states.size)void ensureStatusView();return;}view.update([...states.values()].map(state=>({ ...state,label:providerLabel(state)})),debugTracing,resourcePolicy);}
  const scopeCurrent=(scope:import("../features/language-services/language-service-client.ts").LanguageConsentScope)=>{
    const workspace=options.workspace();return workspace?.root===scope.workspaceRoot&&workspace.generation===scope.workspaceGeneration&&options.registry.list().some(item=>item.kind==="language-service"&&item.pluginId===scope.pluginId&&item.pluginVersion===scope.providerVersion&&item.serverId===(scope.serverId??"typescript")&&item.languageIds.some(language=>providerFor(language)?.qualifiedId===item.qualifiedId));
  };
  async function warm(token:number){
    const workspace=options.workspace();if(!workspace||!options.native.workspace||suspended===projectKey())return;
    const providers=options.registry.list().filter(item=>item.kind==="language-service"&&item.serverId!=="typescript"&&item.serverId!=="rust-analyzer"&&item.languageIds.some(language=>providerFor(language)?.qualifiedId===item.qualifiedId));
    if(!options.registry.list().some(item=>item.kind==="language-service"))return;
    try{
      const state=await options.native.workspace(workspace.root);
      if(disposed||token!==epoch||suspended===projectKey())return;
      resourcePolicy=state.resources;debugTracing=state.debugTracing;renderStatus();
      for(const profile of state.startupProfiles){
        const provider=providers.find(item=>item.pluginId===profile.pluginId&&item.kind==="language-service"&&item.serverId===profile.serverId);
        if(!provider||disposed||token!==epoch)return;
        await factory.warm({workspaceRoot:workspace.root,workspaceGeneration:workspace.generation,pluginId:profile.pluginId,providerVersion:provider.pluginVersion,serverId:profile.serverId});
      }
    }catch{
      if(disposed||token!==epoch)return;
      const provider=providers[0];if(provider?.kind==="language-service")publish({scope:{workspaceRoot:workspace.root,workspaceGeneration:workspace.generation,pluginId:provider.pluginId,providerVersion:provider.pluginVersion,serverId:provider.serverId},sessionId:null,state:"failed",code:"language-workspace-unavailable",startedAt:Date.now()});
    }
  }
  const refresh = () => {
    const workspace = options.workspace();
    if(shownProject!==projectKey()){shownProject=projectKey();resourcePolicy=undefined;states.clear();tips?.reset();++tipEpoch;suspended=null;}
    for(const [id,state] of states)if(id.startsWith("provider:")||!scopeCurrent(state.scope)){states.delete(id);tips?.forget(id);}
    if(workspace){
      const languages=new Set(options.registry.list().flatMap(item=>item.kind==="language-service"?item.languageIds:[]));
      for(const language of languages){const candidates=providersFor(language),selection=selectLanguageProvider(candidates,preferences.get(workspace.root,language));
        if(selection.conflict||candidates.length>1){const first=selection.provider??candidates[0];if(first?.kind!=="language-service")continue;
          states.set(`provider:${language}`,{scope:{workspaceRoot:workspace.root,workspaceGeneration:workspace.generation,pluginId:first.pluginId,providerVersion:first.pluginVersion,serverId:first.serverId},sessionId:null,state:selection.provider?"provider-selected":"conflict",code:selection.provider?undefined:"language-provider-conflict",startedAt:Date.now(),selectionKey:language,choices:candidates.map(item=>({id:item.qualifiedId,label:item.label})),selectedProvider:preferences.get(workspace.root,language)??""});
        }
      }
    }
    renderStatus();
    const next = JSON.stringify([workspace, options.registry.list().filter((item) => item.kind === "language-service").map((item) => [item.qualifiedId, item.pluginVersion, item.serverId,item.languageIds.map(language=>workspace?preferences.get(workspace.root,language):null)])]);
    if (key === next) return;
    key = next; factory.reconcile((info) => workspace?.root === info.workspaceRoot && workspace.generation === info.workspaceGeneration
      && !options.registry.list().some((item) => item.kind === "language-service" && item.pluginId === info.pluginId && item.pluginVersion !== info.providerVersion),scopeCurrent);
    options.diagnostic?.({ providerCount: options.registry.list().filter((item) => item.kind === "language-service").length, workspaceGeneration: workspace?.generation ?? null });
    // A new binding identity refreshes existing cached editors once when admission/activation changes.
    options.bind((handle) => factory(handle));
    void warm(++epoch);
  };
  function selectProvider(language:string,id:string){
    const workspace=options.workspace();if(!workspace||!providersFor(language).some(item=>item.qualifiedId===id))return;
    preferences.set(workspace.root,language,id);key="";factory.reconcile(scopeCurrent,scopeCurrent);refresh();
  }
  async function retry(){
    const project=projectKey();++epoch;suspended=null;tips?.reset();++tipEpoch;await factory.restart();
    if(disposed||project!==projectKey())return;states.clear();key="";refresh();
  }
  async function forget(){
    const workspace=options.workspace();if(!workspace||!options.native.forget)return;
    suspended=projectKey();++epoch;
    try{await options.native.forget(workspace.root);for(const item of options.registry.list())if(item.kind==="language-service")factory.revoke(item.pluginId);options.bind(handle=>factory(handle));renderStatus();}
    catch(error){options.reportError(error);}
  }
  async function setDebug(enabled:boolean){try{await options.native.setDebug?.(enabled);debugTracing=enabled;renderStatus();}catch(error){options.reportError(error);}}
  const commandReleases=options.registerCommand&&options.copy?([
    ["languageServices.status","statusCommand",openStatus],
    ["languageServices.retry","retry",retry],
    ["languageServices.debug.enable","debugOn",()=>setDebug(true)],
    ["languageServices.debug.disable","debugOff",()=>setDebug(false)],
    ["languageServices.forgetProjectConsent","forget",forget],
  ] as const).map(([id,title,execute])=>options.registerCommand!({id:commandId(id),category:"workbench",userBindingScopes:WORKBENCH_FOCUS_SCOPES,detail:()=>"",title:()=>options.copy!().workspaceStatus[title],availability:()=>({enabled:options.workspace()!==null}),execute:async()=>{await execute();}})):[];
  const releaseDebug=options.native.subscribeDebug?.(enabled=>{debugTracing=enabled;renderStatus();});
  const release = options.registry.subscribe(refresh);
  return { refresh,retry,forget,setDebug,selectProvider,revoke: (pluginId: string) => { factory.revoke(pluginId); }, dispose: () => { disposed=true;++epoch;++tipEpoch;tips?.reset();release();releaseDebug?.();commandReleases.forEach(release=>release());view?.dispose();options.bind(null); factory.dispose(); } };
}
