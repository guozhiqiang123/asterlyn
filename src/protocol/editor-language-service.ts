/** Framework-neutral bridge between an editable CodeMirror document and the host LSP session. */
export interface EditorLanguageServiceHandle {
  readonly tabId: string;
  readonly path: string;
  readonly loadEpoch: number;
}

export interface EditorLanguageServiceSnapshot {
  readonly version: number;
  readonly text: string;
}

export interface EditorLanguageServiceDiagnostic {
  readonly message: string;
  readonly severity?: 1 | 2 | 3 | 4;
  readonly range: { readonly start: EditorLanguageServicePosition; readonly end: EditorLanguageServicePosition };
  readonly source?: string;
  readonly code?: string | number;
}

export interface EditorLanguageServicePosition { readonly line: number; readonly character: number; }
export interface EditorReadonlyLanguageSource { readonly text:string; readonly path:string; readonly languageId:string; }
export interface EditorLanguageServiceLocation { readonly readonlySource?:EditorReadonlyLanguageSource; readonly uri: string; readonly range: { readonly start: EditorLanguageServicePosition; readonly end: EditorLanguageServicePosition } }
export interface EditorLanguageLocationResults {readonly selectedIndex?:number;readonly kind:"definition"|"references";readonly query:string;readonly locations:readonly EditorLanguageServiceLocation[];readonly limited:boolean;}
export interface EditorLanguageLocationsPublication extends EditorLanguageLocationResults {readonly workspaceRoot:string;readonly workspaceGeneration:number;}
export interface EditorLanguageServiceCompletionItem { readonly label: string; readonly detail?: string; readonly kind?: number; readonly insertText?: string; readonly textEdit?: { readonly range: { readonly start: EditorLanguageServicePosition; readonly end: EditorLanguageServicePosition }; readonly newText: string }; readonly insertReplaceEdit?: unknown; readonly additionalTextEdits?: readonly unknown[]; readonly command?: unknown; readonly insertTextFormat?: number; }

export interface EditorDefinitionEvent { readonly kind?: "definition" | "references"; readonly outcome: "requested" | "discarded" | "invalid" | "empty" | "selected" | "choices"; readonly targetCount: number; }

export interface EditorLanguageServicePort {
  readonly documentUri?: string;
  definitionEvent?(event: EditorDefinitionEvent): void;
  open(handle: EditorLanguageServiceHandle, snapshot: EditorLanguageServiceSnapshot): void;
  update(handle: EditorLanguageServiceHandle, snapshot: EditorLanguageServiceSnapshot): void;
  close(handle: EditorLanguageServiceHandle): void;
  request<T = unknown>(handle: EditorLanguageServiceHandle, method: string, params: unknown, version: number): Promise<T | null>;
  openInWindow?(results:EditorLanguageLocationResults,version:number):void;
  navigate?(location: EditorLanguageServiceLocation): void;
  subscribeDiagnostics(listener: (event: { readonly handle: EditorLanguageServiceHandle; readonly version: number; readonly diagnostics: readonly EditorLanguageServiceDiagnostic[] }) => void): () => void;
}

export type EditorLanguageServicePortFactory = (handle: EditorLanguageServiceHandle) => EditorLanguageServicePort | null;

/** A host-owned loading state, distinct from a successful empty symbol result. */
export class LanguageServiceIndexingError extends Error {
  constructor() { super("Language services are indexing this project."); this.name = "LanguageServiceIndexingError"; }
}
export class LanguageServiceUnavailableError extends Error {
  constructor() { super("Language services are unavailable. Check language service status and retry."); this.name = "LanguageServiceUnavailableError"; }
}
