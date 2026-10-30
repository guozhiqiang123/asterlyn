import {workspaceFileUri} from "../application/language-services/workspace-file-uri.ts";
export {workspaceFileUri} from "../application/language-services/workspace-file-uri.ts";
import type { PluginContributionRegistry } from "../application/plugins/index.ts";
import { createEditorLanguageServicePort, type NativeLanguageServiceBridge } from "../features/language-services/language-service-client.ts";
import type { EditorLanguageServiceHandle, EditorLanguageServiceLocation, EditorLanguageServicePortFactory } from "../protocol/editor-language-service.ts";
import type { ApplicationConfirmationRequest } from "../shared/application-confirmation-dialog.ts";
import type { WindowSession } from "../application/window-session.ts";
import type { LanguageServiceStatus } from "../features/language-services/language-service-client.ts";
import type { CommandDescriptor } from "../application/commands/command-service.ts";
import { commandId, WORKBENCH_FOCUS_SCOPES } from "../application/commands/command-service.ts";
import type { LanguageServiceCopy } from "../localization/language-service-copy.ts";
import { LanguageServiceStatusView } from "../features/language-services/language-service-status-view.ts";

/** One callback supplies both language services and target navigation with their workspace scope. */
export function languageWorkspaceForWindow(session: Pick<WindowSession, "workspace">) {
  return () => session.workspace.identity();
}

export interface LanguageServicesRuntimeOptions {
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
  readonly definitionDiagnostic?: (event: import("../protocol/editor-language-service.ts").EditorDefinitionEvent) => void;
  readonly approvalDiagnostic?: (event: import("../protocol/language-service.ts").LanguageServiceApprovalEvent) => void;
  readonly diagnostic?: (fields: { providerCount: number; workspaceGeneration: number | null }) => void;
}
const LANGUAGES: Readonly<Record<string, string>> = { java:"java", kt:"kotlin", kts:"kotlin", groovy:"groovy", gradle:"groovy", rs: "rust", ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact" };
export function createLanguageServicesRuntime(options: LanguageServicesRuntimeOptions) {
  let disposed=false,epoch=0,suspended:string|null=null,key="";
  const projectKey=()=>JSON.stringify(options.workspace());
  const states=new Map<string,LanguageServiceStatus>();
  const publish=(status:LanguageServiceStatus)=>{
    const workspace=options.workspace();
    if(disposed || workspace?.root!==status.scope.workspaceRoot || workspace.generation!==status.scope.workspaceGeneration)return;
    const provider=options.registry.list().find(item=>item.kind==="language-service"&&item.pluginId===status.scope.pluginId&&item.serverId===(status.scope.serverId??"typescript")&&item.pluginVersion===status.scope.providerVersion);
    if(!provider)return;
    states.set(`${status.scope.pluginId}:${status.scope.serverId??"typescript"}`,status);
    options.status?.(status);renderStatus();
  };
  let debugTracing=false,shownProject=projectKey();
  const factory = createEditorLanguageServicePort((handle) => {
    const workspace = options.workspace(); const document = options.document(handle);
    if (!workspace || suspended===projectKey() || !document || document.readOnly || document.loadEpoch !== handle.loadEpoch) return null;
    const extension = document.workspacePath.match(/\.([^.\/]+)$/u)?.[1];
    const languageId = extension ? LANGUAGES[extension] : undefined;
    const providers = options.registry.list().filter((entry) => entry.kind === "language-service" && languageId && entry.languageIds.includes(languageId) && entry.extensions.includes(`.${extension}`));
    if (providers.length !== 1 || !languageId) return null;
    const provider = providers[0]!; if (provider.kind !== "language-service") return null; const uri = workspaceFileUri(workspace.root, document.workspacePath);
    return uri ? { workspaceRoot: workspace.root, workspaceGeneration: workspace.generation, uri, languageId, pluginId: provider.pluginId, providerVersion: provider.pluginVersion, serverId: provider.serverId } : null;
  }, options.native, options.reportError, options.navigate, event=>{if(debugTracing)options.definitionDiagnostic?.(event);}, options.approvalDiagnostic,publish,options.openInWindow);
  const view=options.host&&options.copy?new LanguageServiceStatusView(options.host,options.copy,{
    retry:()=>{void retry().catch(options.reportError);},forget:()=>{void forget();},debug:enabled=>{void setDebug(enabled);},error:options.reportError,
  }):null;
  function providerLabel(state:LanguageServiceStatus):string{const provider=options.registry.list().find(item=>item.kind==="language-service"&&item.pluginId===state.scope.pluginId&&item.serverId===(state.scope.serverId??"typescript"));return provider?.kind==="language-service"?provider.label:state.scope.serverId??"Language services";}
  function renderStatus(){view?.update([...states.values()].map(state=>({ ...state,label:providerLabel(state)})),debugTracing);}
  const scopeCurrent=(scope:import("../features/language-services/language-service-client.ts").LanguageConsentScope)=>{
    const workspace=options.workspace();return workspace?.root===scope.workspaceRoot&&workspace.generation===scope.workspaceGeneration&&options.registry.list().some(item=>item.kind==="language-service"&&item.pluginId===scope.pluginId&&item.pluginVersion===scope.providerVersion&&item.serverId===(scope.serverId??"typescript"));
  };
  async function warm(token:number){
    const workspace=options.workspace();if(!workspace||!options.native.workspace||suspended===projectKey())return;
    const providers=options.registry.list().filter(item=>item.kind==="language-service"&&item.serverId!=="typescript"&&item.serverId!=="rust-analyzer");
    if(!options.registry.list().some(item=>item.kind==="language-service"))return;
    try{
      const state=await options.native.workspace(workspace.root);
      if(disposed||token!==epoch||suspended===projectKey())return;
      debugTracing=state.debugTracing;renderStatus();
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
    if(shownProject!==projectKey()){shownProject=projectKey();states.clear();suspended=null;}
    for(const [id,state] of states)if(!scopeCurrent(state.scope))states.delete(id);
    renderStatus();
    const next = JSON.stringify([workspace, options.registry.list().filter((item) => item.kind === "language-service").map((item) => [item.qualifiedId, item.pluginVersion, item.serverId])]);
    if (key === next) return;
    key = next; factory.reconcile((info) => workspace?.root === info.workspaceRoot && workspace.generation === info.workspaceGeneration
      && !options.registry.list().some((item) => item.kind === "language-service" && item.pluginId === info.pluginId && item.pluginVersion !== info.providerVersion),scopeCurrent);
    options.diagnostic?.({ providerCount: options.registry.list().filter((item) => item.kind === "language-service").length, workspaceGeneration: workspace?.generation ?? null });
    // A new binding identity refreshes existing cached editors once when admission/activation changes.
    options.bind((handle) => factory(handle));
    void warm(++epoch);
  };
  async function retry(){
    const project=projectKey();++epoch;suspended=null;await factory.restart();
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
    ["languageServices.status","statusCommand",()=>view?.open()],
    ["languageServices.retry","retry",retry],
    ["languageServices.debug.enable","debugOn",()=>setDebug(true)],
    ["languageServices.debug.disable","debugOff",()=>setDebug(false)],
    ["languageServices.forgetProjectConsent","forget",forget],
  ] as const).map(([id,title,execute])=>options.registerCommand!({id:commandId(id),category:"workbench",userBindingScopes:WORKBENCH_FOCUS_SCOPES,detail:()=>"",title:()=>options.copy!().workspaceStatus[title],availability:()=>({enabled:options.workspace()!==null}),execute:async()=>{await execute();}})):[];
  const releaseDebug=options.native.subscribeDebug?.(enabled=>{debugTracing=enabled;renderStatus();});
  const release = options.registry.subscribe(refresh);
  return { refresh,retry,forget,setDebug,revoke: (pluginId: string) => { factory.revoke(pluginId); }, dispose: () => { disposed=true;++epoch;release();releaseDebug?.();commandReleases.forEach(release=>release());view?.dispose();options.bind(null); factory.dispose(); } };
}
export function languageExecutionConfirmation(review: Parameters<NativeLanguageServiceBridge["confirm"]>[0], chinese: boolean): ApplicationConfirmationRequest {
  if (!["typescript", "rust-analyzer"].includes(review.serverId)) return chinese ? {
    title: "启用项目语言服务？",
    message: `语言插件将通过依赖插件读取当前项目模型，并运行已校验的本机语言工具。Gradle 会执行项目配置；语言工具会读取源码和当前未保存的编辑内容，具有当前用户的系统权限。首次分析可能需要较长时间，进度和失败原因可在日志中查看。\n\n执行程序：${review.executableIdentity}\n插件与工具校验：${review.resourceDigest}\n\n启用后为此项目记住授权，重新打开项目和重启应用不会重复询问；“暂不启用”仅适用于本次会话。更换插件、依赖插件或工具后重新确认，可在语言服务状态中清除项目授权。`,
    confirmLabel: "启用语言服务", cancelLabel: "暂不启用",
  } : {
    title: "Enable project language services?",
    message: `The language plugin will read this project's model through its declared dependency plugin and run verified local language tools. Gradle executes project configuration. Tools can read source files and unsaved edits with your account's system permissions. Initial analysis can take time; progress and failures are recorded in the application log.\n\nExecutable: ${review.executableIdentity}\nPlugin and tool identity: ${review.resourceDigest}\n\nApproval is remembered for this project across restarts; “Not now” applies to this session. Changed plugins, dependency plugins or tools require confirmation again. Project approval can be cleared from the language service status.`,
    confirmLabel: "Enable language services", cancelLabel: "Not now",
  };
  if (review.serverId === "rust-analyzer") return chinese ? {
    title: "启用 Rust 语言服务？",
    message: `插件 ${review.pluginId} ${review.pluginVersion} 将运行本机 Rust 1.98.1 的 rust-analyzer，并通过 Cargo 读取当前项目模型。该进程具有当前用户的系统权限；项目和用户的 Cargo 配置也会影响执行。\n\n首版使用离线模式，关闭构建脚本、过程宏和保存时 Cargo check；宏生成代码的分析可能不完整。不会自动安装依赖或工具。\n\n执行程序：${review.executableIdentity}\n插件校验：${review.packageDigest}\n\n为此项目单独记住 Rust 的选择，重启后仍然有效。工具或插件身份变化后重新确认，可在语言服务状态中清除项目授权。`,
    confirmLabel: "启用 Rust 语言服务", cancelLabel: "暂不启用",
  } : {
    title: "Enable Rust language services?",
    message: `Plugin ${review.pluginId} ${review.pluginVersion} will run local Rust 1.98.1 rust-analyzer and read this project's model through Cargo. It has your user account's system permissions; project and user Cargo configuration can also affect execution.\n\nThis initial profile runs offline with build scripts, procedural macros and Cargo check on save disabled. Generated code analysis may be incomplete. Tools and dependencies are never installed automatically.\n\nExecutable: ${review.executableIdentity}\nPackage: ${review.packageDigest}\n\nRemember Rust's separate choice for this project across restarts. Changed plugin or tool identities require confirmation again. Project approval can be cleared from the language service status.`,
    confirmLabel: "Enable Rust language services", cancelLabel: "Not now",
  };
  return chinese ? {
    title: "启用 TypeScript / JavaScript 语言服务？",
    message: `插件 ${review.pluginId} ${review.pluginVersion} 将通过本机 Node.js 运行随包附带的语言服务，并读取当前项目与打开的源文件。该进程具有当前用户的系统权限。\n\n执行程序：${review.executableIdentity}\n插件校验：${review.packageDigest}\n\n为此项目记住此选择，重启应用和重新打开项目不会重复询问。插件或 Node 身份变化后需要重新确认，可在语言服务状态中清除项目授权。`,
    confirmLabel: "启用语言服务", cancelLabel: "暂不启用",
  } : {
    title: "Enable TypeScript / JavaScript language services?",
    message: `Plugin ${review.pluginId} ${review.pluginVersion} will run its packaged language server with local Node.js and read this project and its open source files. The process has your user account's system permissions.\n\nExecutable: ${review.executableIdentity}\nPackage: ${review.packageDigest}\n\nApproval is remembered for this project across restarts; “Not now” applies to this session. Changed plugin or Node identities require confirmation again. Project approval can be cleared from the language service status.`,
    confirmLabel: "Enable language services", cancelLabel: "Not now",
  };
}
