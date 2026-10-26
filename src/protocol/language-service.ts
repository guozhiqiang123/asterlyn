import type { EditorLanguageServiceDiagnostic } from "./editor-language-service.ts";
export interface LanguageServiceReview {
  readonly reviewId: string; readonly pluginId: string; readonly serverId: "typescript";
  readonly pluginVersion: string; readonly packageDigest: string; readonly resourceDigest: string;
  readonly executableIdentity: string; readonly expiresAt: number;
}
export interface LanguageServiceTextPosition { readonly line: number; readonly character: number; }
export interface LanguageServiceTextRange { readonly start: LanguageServiceTextPosition; readonly end: LanguageServiceTextPosition; }
export interface LanguageServiceTextChange { readonly range: LanguageServiceTextRange | null; readonly text: string; }
export interface LanguageServiceResultEnvelope { readonly sessionId: string; readonly uri: string; readonly version: number; readonly result: unknown; }

export interface LanguageServiceEvent {
  readonly sessionId: string; readonly kind: "diagnostics" | "terminated";
  readonly uri?: string; readonly version?: number; readonly diagnostics?: readonly EditorLanguageServiceDiagnostic[];
}
export interface NativeLanguageServiceBridge {
  prepare(root: string, pluginId: string): Promise<LanguageServiceReview>;
  confirm(review: LanguageServiceReview): Promise<boolean>;
  start(root: string, reviewId: string): Promise<string>;
  open(root: string, session: string, uri: string, language: string, version: number, text: string): Promise<void>;
  change(root: string, session: string, uri: string, version: number, changes: readonly { range: null; text: string }[]): Promise<void>;
  close(root: string, session: string, uri: string): Promise<void>;
  request(root: string, session: string, uri: string, version: number, requestId: string, feature: "hover" | "definition" | "completion" | "references", line: number, character: number): Promise<LanguageServiceResultEnvelope>;
  cancel(root: string, session: string, requestId: string): Promise<void>;
  stop(root: string, session: string): Promise<void>;
  subscribe(listener: (event: LanguageServiceEvent) => void): () => void;
  dispose?(): void;
}
