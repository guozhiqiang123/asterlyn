import type { EditorLanguageServiceDiagnostic } from "./editor-language-service.ts";
export interface LanguageServiceReview {
  readonly reviewId: string; readonly pluginId: string; readonly serverId: string;
  readonly pluginVersion: string; readonly packageDigest: string; readonly resourceDigest: string;
  readonly executableIdentity: string; readonly expiresAt: number;
  readonly remembered?: boolean;
}
export interface LanguageServiceTextPosition { readonly line: number; readonly character: number; }
export interface LanguageServiceTextRange { readonly start: LanguageServiceTextPosition; readonly end: LanguageServiceTextPosition; }
export interface LanguageServiceTextChange { readonly range: LanguageServiceTextRange | null; readonly text: string; }
export interface LanguageServiceResultEnvelope { readonly sessionId: string; readonly uri: string; readonly version: number; readonly result: unknown; }
export interface LanguageServiceApprovalEvent {
  readonly outcome: "requested" | "approved" | "declined" | "reused" | "discarded" | "invalidated";
  readonly reason?: "first-use" | "identity-changed" | "scope-changed" | "shutdown";
}

export interface LanguageServiceEvent {
  readonly sessionId: string; readonly kind: "diagnostics" | "terminated" | "indexing" | "ready" | "degraded";
  readonly uri?: string; readonly version?: number; readonly diagnostics?: readonly EditorLanguageServiceDiagnostic[];
  readonly code?: string; readonly progress?: LanguageServiceProgress;
}
export interface LanguageServiceProgress {
  readonly phase: "model" | "sources" | "backend" | "indexing" | "refreshing" | "ready" | "failed";
  readonly completed?: number; readonly total?: number; readonly unit?: "modules" | "files" | "items";
}
export interface LanguageServiceWorkspaceState {
  readonly startupProfiles: readonly {pluginId:string;serverId:string}[];
  readonly debugTracing: boolean;
}
export interface LanguageServiceTrace {
  readonly operation: string; readonly outcome: string; readonly workspaceRoot: string;
  readonly uri?: string; readonly targetUri?:string; readonly sessionId?: string; readonly requestId?: string;
  readonly version?: number; readonly bytes?: number; readonly durationMs?: number; readonly resultCount?: number;
  readonly reason?: string; readonly feature?: string;
}
export interface NativeLanguageServiceBridge {
  workspace?(root: string): Promise<LanguageServiceWorkspaceState>;
  setDebug?(enabled:boolean): Promise<void>;
  subscribeDebug?(listener:(enabled:boolean)=>void):()=>void;
  forget?(root:string): Promise<void>;
  trace?(event:LanguageServiceTrace): void;
  prepare(root: string, pluginId: string, serverId?: string): Promise<LanguageServiceReview>;
  confirm(review: LanguageServiceReview): Promise<boolean>;
  start(root: string, reviewId: string, serverId?: string, remember?: boolean, refreshModel?:boolean): Promise<string>;
  open(root: string, session: string, uri: string, language: string, version: number, text: string): Promise<void>;
  change(root: string, session: string, uri: string, version: number, changes: readonly { range: null; text: string }[]): Promise<void>;
  close(root: string, session: string, uri: string): Promise<void>;
  request(root: string, session: string, uri: string, version: number, requestId: string, feature: "hover" | "definition" | "completion" | "references", line: number, character: number): Promise<LanguageServiceResultEnvelope>;
  cancel(root: string, session: string, requestId: string): Promise<void>;
  stop(root: string, session: string): Promise<void>;
  subscribe(listener: (event: LanguageServiceEvent) => void): () => void;
  dispose?(): void;
}
