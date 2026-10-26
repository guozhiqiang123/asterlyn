import { LanguageServiceIndexingError } from "../../protocol/editor-language-service.ts";
import { invokeDesktopCommandUnvalidated as invoke } from "./desktop-command-adapter.ts";
import type { LanguageServiceReview, LanguageServiceResultEnvelope } from "../../protocol/language-service.ts";
import type { NativeLanguageServiceBridge, LanguageServiceEvent } from "../../protocol/language-service.ts";

const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid language service result"); return value as Record<string, unknown>; };
const text = (value: unknown, max = 16384): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
export function validateLanguageReview(value: unknown): LanguageServiceReview {
  const item = record(value);
  if (!text(item.reviewId, 128) || item.pluginId !== "dev.asterlyn.lsp" || !["typescript", "rust-analyzer"].includes(String(item.serverId)) || !text(item.pluginVersion, 128) || !text(item.packageDigest, 128) || !text(item.resourceDigest, 128) || !text(item.executableIdentity) || !Number.isSafeInteger(item.expiresAt)) throw new Error("Invalid language execution review");
  return item as unknown as LanguageServiceReview;
}
function eventValue(value: unknown): LanguageServiceEvent | null {
  const item = record(value); if (!text(item.sessionId, 128)) return null;
  if (item.kind === "terminated" || item.kind === "indexing" || item.kind === "ready" || item.kind === "degraded") return { kind: item.kind, sessionId: item.sessionId };
  if (item.kind !== "diagnostics" || !text(item.uri) || !Number.isSafeInteger(item.version) || !Array.isArray(item.diagnostics) || item.diagnostics.length > 512) return null;
  const position = (p: unknown) => { const v = record(p); return Number.isSafeInteger(v.line) && Number(v.line) >= 0 && Number.isSafeInteger(v.character) && Number(v.character) >= 0; };
  if (!item.diagnostics.every((d) => { const v = record(d); const range = record(v.range); return text(v.message, 8192) && position(range.start) && position(range.end) && (v.severity === undefined || [1, 2, 3, 4].includes(Number(v.severity))); })) return null;
  return item as unknown as LanguageServiceEvent;
}
/** The caller supplies the host-owned approval dialog; this adapter cannot silently approve. */
export function createTauriLanguageServiceBridge(confirm: NativeLanguageServiceBridge["confirm"]): NativeLanguageServiceBridge {
  let released = false;
  let release: (() => void) | null = null;
  const subscribers = new Set<(event: LanguageServiceEvent) => void>();
  const ready = import("@tauri-apps/api/event").then(({ listen }) => listen<unknown>("asterlyn://language-service-event", (event) => {
    try { const value = eventValue(event.payload); if (value && !released) for (const subscriber of subscribers) subscriber(value); } catch { /* Malformed service traffic never reaches editor state. */ }
  })).then((stop) => { if (released) stop(); else release = stop; });
  return {
    prepare: async (workspaceRoot, pluginId, serverId = "typescript") => { await ready; const review = validateLanguageReview(await invoke("prepare_language_service", { workspaceRoot, pluginId, serverId })); if (review.serverId !== serverId) throw Error("Language profile review mismatch"); return review; },
    confirm,
    start: async (workspaceRoot, reviewId, serverId = "typescript") => { const value = await invoke("start_language_service", { workspaceRoot, reviewId, serverId }); if (!text(value, 128)) throw new Error("Invalid language session identity"); return value; },
    open: (workspaceRoot, sessionId, uri, languageId, version, text) => invoke("open_language_document", { workspaceRoot, sessionId, uri, languageId, version, text }).then(() => undefined),
    change: (workspaceRoot, sessionId, uri, version, changes) => invoke("change_language_document", { workspaceRoot, sessionId, uri, version, changes: [...changes] }).then(() => undefined),
    close: (workspaceRoot, sessionId, uri) => invoke("close_language_document", { workspaceRoot, sessionId, uri }).then(() => undefined),
    request: async (workspaceRoot, sessionId, uri, version, requestId, feature, line, character) => {
      const value = record(await invoke("request_language_service", { workspaceRoot, sessionId, uri, version, requestId, feature, line, character }).catch((error: unknown) => { if (error === "Rust language services are loading this project. Try navigation again shortly.") throw new LanguageServiceIndexingError(); throw error; }));
      if (value.sessionId !== sessionId || value.uri !== uri || value.version !== version || !("result" in value) || JSON.stringify(value).length > 4 * 1024 * 1024) throw new Error("Invalid language response identity or size");
      return value as unknown as LanguageServiceResultEnvelope;
    },
    cancel: (workspaceRoot, sessionId, requestId) => invoke("cancel_language_request", { workspaceRoot, sessionId, requestId }).then(() => undefined),
    stop: (workspaceRoot, sessionId) => invoke("stop_language_service", { workspaceRoot, sessionId }).then(() => undefined),
    subscribe: (listener) => { subscribers.add(listener); return () => subscribers.delete(listener); },
    dispose: () => { released = true; release?.(); release = null; subscribers.clear(); },
  };
}
