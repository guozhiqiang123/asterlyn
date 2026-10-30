import { languageServiceFailure,isLanguageServiceIndexingFailure } from "./language-service-failure.ts";
import { invokeDesktopCommandUnvalidated as invoke } from "./desktop-command-adapter.ts";
import type { LanguageServiceReview, LanguageServiceResultEnvelope } from "../../protocol/language-service.ts";
import type { NativeLanguageServiceBridge, LanguageServiceEvent } from "../../protocol/language-service.ts";
import { assertLanguageServiceWorkspaceState, languageServiceProgress } from "../../protocol/validate-language-service.ts";
import { diagnostics } from "../../shared/diagnostics.ts";

const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid language service result"); return value as Record<string, unknown>; };
const text = (value: unknown, max = 16384): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
export function validateLanguageReview(value: unknown): LanguageServiceReview {
  const item = record(value);
  if (item.remembered !== undefined && typeof item.remembered !== "boolean") throw new Error("Invalid remembered language approval");
  if (!text(item.reviewId, 128) || item.pluginId !== "dev.asterlyn.lsp" || !(typeof item.serverId === "string" && /^[a-z][a-z0-9.-]{0,127}$/u.test(item.serverId)) || !text(item.pluginVersion, 128) || !text(item.packageDigest, 128) || !text(item.resourceDigest, 128) || !text(item.executableIdentity) || !Number.isSafeInteger(item.expiresAt)) throw new Error("Invalid language execution review");
  return item as unknown as LanguageServiceReview;
}
export function eventValue(value: unknown): LanguageServiceEvent | null {
  const item = record(value); if (!text(item.sessionId, 128)) return null;
  if (item.kind === "terminated" || item.kind === "indexing" || item.kind === "ready" || item.kind === "degraded") return { kind: item.kind, sessionId: item.sessionId,
    ...(typeof item.code==="string"&&/^[a-z][a-z0-9.-]{0,79}$/u.test(item.code)?{code:item.code}:{}),progress:languageServiceProgress(item.progress) };
  if (item.kind !== "diagnostics" || !text(item.uri) || !Number.isSafeInteger(item.version) || !Array.isArray(item.diagnostics) || item.diagnostics.length > 512) return null;
  const position = (p: unknown) => { const v = record(p); return Number.isSafeInteger(v.line) && Number(v.line) >= 0 && Number.isSafeInteger(v.character) && Number(v.character) >= 0; };
  if (!item.diagnostics.every((d) => { const v = record(d); const range = record(v.range); return text(v.message, 8192) && position(range.start) && position(range.end) && (v.severity === undefined || [1, 2, 3, 4].includes(Number(v.severity))); })) return null;
  return item as unknown as LanguageServiceEvent;
}
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
        diagnostics.report("info","language.debug.operation",JSON.stringify({workspaceHash,documentHash,targetHash,operation:event.operation,outcome:event.outcome,sessionId:event.sessionId,requestId:event.requestId,version:event.version,bytes:event.bytes,durationMs:event.durationMs,resultCount:event.resultCount,reason:event.reason,feature:event.feature}));
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
