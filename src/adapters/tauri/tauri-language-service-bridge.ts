import { listen } from "@tauri-apps/api/event";
import { invokeDesktopCommandUnvalidated } from "./desktop-command-adapter.ts";
import type { LanguageServiceResultEnvelope } from "../../protocol/language-service.ts";

export function createTauriLanguageServiceBridge() {
  const subscribers = new Set<(event: any) => void>();
  void listen("asterlyn://language-service-event", (event) => {
    for (const subscriber of subscribers) subscriber(event.payload);
  });
  return {
    prepare: (workspaceRoot: string, pluginId: string) =>
      invokeDesktopCommandUnvalidated("prepare_language_service", {
        workspaceRoot,
        pluginId,
      }) as Promise<any>,
    confirm: async (_review: unknown) => true,
    start: (workspaceRoot: string, reviewId: string) =>
      invokeDesktopCommandUnvalidated("start_language_service", {
        workspaceRoot,
        reviewId,
      }) as Promise<string>,
    open: (
      workspaceRoot: string,
      sessionId: string,
      uri: string,
      languageId: string,
      version: number,
      text: string,
    ) =>
      invokeDesktopCommandUnvalidated("open_language_document", {
        workspaceRoot,
        sessionId,
        uri,
        languageId,
        version,
        text,
      }).then(() => undefined),
    change: (
      workspaceRoot: string,
      sessionId: string,
      uri: string,
      version: number,
      changes: readonly { range: unknown; text: string }[],
    ) =>
      invokeDesktopCommandUnvalidated("change_language_document", {
        workspaceRoot,
        sessionId,
        uri,
        version,
      changes: [...changes] as never,
      }).then(() => undefined),
    close: (workspaceRoot: string, sessionId: string, uri: string) =>
      invokeDesktopCommandUnvalidated("close_language_document", {
        workspaceRoot,
        sessionId,
        uri,
      }).then(() => undefined),
    request: async (
      workspaceRoot: string,
      sessionId: string,
      uri: string,
      version: number,
      _requestId: string,
      feature: "hover" | "definition" | "completion",
      line: number,
      character: number,
    ) =>
      (await invokeDesktopCommandUnvalidated("request_language_service", {
        workspaceRoot,
        sessionId,
        uri,
        feature,
        version,
        line,
        character,
      })) as Promise<LanguageServiceResultEnvelope>,
    cancel: (_workspaceRoot: string, sessionId: string, requestId: string) =>
      invokeDesktopCommandUnvalidated("cancel_language_request", {
        sessionId,
        requestId: Number(requestId),
      }).then(() => undefined),
    stop: (_workspaceRoot: string, sessionId: string) =>
      invokeDesktopCommandUnvalidated("stop_language_service", {
        sessionId,
      }).then(() => undefined),
    subscribe: (listener: (event: any) => void) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
}
