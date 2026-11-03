import {validateLanguageReview,eventValue} from "./language-service-values.ts";
import { languageServiceFailure,isLanguageServiceIndexingFailure } from "./language-service-failure.ts";
import { invokeDesktopCommandUnvalidated as invoke } from "./desktop-command-adapter.ts";
import type { LanguageServiceResultEnvelope } from "../../protocol/language-service.ts";
import type { NativeLanguageServiceBridge, LanguageServiceEvent } from "../../protocol/language-service.ts";
import { assertLanguageServiceWorkspaceState } from "../../protocol/validate-language-service.ts";
import { diagnostics } from "../../shared/diagnostics.ts";

const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid language service result"); return value as Record<string, unknown>; };
const text=(value:unknown,max=16384):value is string=>typeof value==="string"&&value.length>0&&value.length<=max;
/** The caller supplies the host-owned approval dialog; this adapter cannot silently approve. */
export function createTauriLanguageServiceBridge(confirm: NativeLanguageServiceBridge["confirm"]): NativeLanguageServiceBridge {
  let released = false;
  let release: (() => void) | null = null;
  let releaseDebug:(()=>void)|null=null,debugTracing=false;
  const subscribers = new Set<(event: LanguageServiceEvent) => void>();
  const debugSubscribers=new Set<(enabled:boolean)=>void>();
  let traceWindow=0,traceCount=0;
  const ready = import("@tauri-apps/api/event").then(({ listen }) => listen<unknown>("asterlyn://language-service-event", (event) => {
    try { const value = eventValue(event.payload); if (value && !released) for (const subscriber of subscribers) subscriber(value); } catch { /* Malformed service traffic never reaches editor state. */ }
  })).then((stop) => { if (released) stop(); else release = stop; });
  const debugReady=import("@tauri-apps/api/event").then(({listen})=>listen<{enabled:boolean}>("asterlyn://language-service-debug",event=>{debugTracing=event.payload?.enabled===true;for(const listener of debugSubscribers)listener(debugTracing);})).then(stop=>{if(released)stop();else releaseDebug=stop;});
  const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,"0")).join("").slice(0,16);
  return {
    workspace:async(workspaceRoot)=>{await Promise.all([ready,debugReady]);const value=await invoke("language_service_workspace_state",{workspaceRoot});assertLanguageServiceWorkspaceState(value);debugTracing=value.debugTracing;return value;},
    setDebug:async(enabled)=>{await invoke("set_language_service_debug",{enabled});debugTracing=enabled;},
    subscribeDebug:listener=>{debugSubscribers.add(listener);return()=>debugSubscribers.delete(listener);},
    forget:async(workspaceRoot)=>{await invoke("forget_language_service_consent",{workspaceRoot});},
    trace:event=>{
      if(!debugTracing||released)return;
      const window=Math.floor(performance.now()/1000);if(window!==traceWindow){traceWindow=window;traceCount=0;}if(++traceCount>120)return;
      void Promise.all([hash(event.workspaceRoot),event.uri?hash(event.uri):undefined,event.targetUri?hash(event.targetUri):undefined]).then(([workspaceHash,documentHash,targetHash])=>{
        if(!debugTracing||released)return;
        diagnostics.report("info","language.debug.operation",JSON.stringify({workspaceHash,documentHash,targetHash,operation:event.operation,outcome:event.outcome,sessionId:event.sessionId,requestId:event.requestId,version:event.version,bytes:event.bytes,durationMs:event.durationMs,resultCount:event.resultCount,reason:event.reason,feature:event.feature,attempt:event.attempt,generation:event.generation,delayMs:event.delayMs}));
      }).catch(()=>{});
    },
    prepare: async (workspaceRoot, pluginId, serverId = "typescript") => { await ready; const review = validateLanguageReview(await invoke("prepare_language_service", { workspaceRoot, pluginId, serverId })); if (review.serverId !== serverId) throw Error("Language profile review mismatch"); return review; },
    confirm,
    start: async (workspaceRoot, reviewId, serverId = "typescript", remember = false, refreshModel = false) => { const value = await invoke("start_language_service", { workspaceRoot, reviewId, serverId, remember, refreshModel }); if (!text(value, 128)) throw new Error("Invalid language session identity"); return value; },
    open: (workspaceRoot, sessionId, uri, languageId, version, text) => invoke("open_language_document", { workspaceRoot, sessionId, uri, languageId, version, text }).then(() => undefined),
    change: (workspaceRoot, sessionId, uri, version, changes) => invoke("change_language_document", { workspaceRoot, sessionId, uri, version, changes: [...changes] }).then(() => undefined),
    close: (workspaceRoot, sessionId, uri) => invoke("close_language_document", { workspaceRoot, sessionId, uri }).then(() => undefined),
    request: async (workspaceRoot, sessionId, uri, version, requestId, feature, line, character) => {
      const value = record(await invoke("request_language_service", { workspaceRoot, sessionId, uri, version, requestId, feature, line, character },isLanguageServiceIndexingFailure).catch((error: unknown) => {throw languageServiceFailure(error);}));
      if (value.sessionId !== sessionId || value.uri !== uri || value.version !== version || !("result" in value) || JSON.stringify(value).length > 4 * 1024 * 1024) throw new Error("Invalid language response identity or size");
      return value as unknown as LanguageServiceResultEnvelope;
    },
    cancel: (workspaceRoot, sessionId, requestId) => invoke("cancel_language_request", { workspaceRoot, sessionId, requestId }).then(() => undefined),
    stop: (workspaceRoot, sessionId) => invoke("stop_language_service", { workspaceRoot, sessionId }).then(() => undefined),
    subscribe: (listener) => { subscribers.add(listener); return () => subscribers.delete(listener); },
    dispose: () => { released = true; release?.(); releaseDebug?.();debugSubscribers.clear(); release = null;releaseDebug=null; subscribers.clear(); },
  };
}
