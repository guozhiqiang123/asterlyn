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
export interface EditorLanguageServiceLocation { readonly uri: string; readonly range: { readonly start: EditorLanguageServicePosition; readonly end: EditorLanguageServicePosition } }
export interface EditorLanguageServiceCompletionItem { readonly label: string; readonly detail?: string; readonly kind?: number; readonly insertText?: string; readonly textEdit?: { readonly range: { readonly start: EditorLanguageServicePosition; readonly end: EditorLanguageServicePosition }; readonly newText: string }; readonly insertReplaceEdit?: unknown; readonly additionalTextEdits?: readonly unknown[]; readonly command?: unknown; readonly insertTextFormat?: number; }

export interface EditorLanguageServicePort {
  open(handle: EditorLanguageServiceHandle, snapshot: EditorLanguageServiceSnapshot): void;
  update(handle: EditorLanguageServiceHandle, snapshot: EditorLanguageServiceSnapshot): void;
  close(handle: EditorLanguageServiceHandle): void;
  request<T = unknown>(handle: EditorLanguageServiceHandle, method: string, params: unknown, version: number): Promise<T | null>;
  navigate?(location: EditorLanguageServiceLocation): void;
  subscribeDiagnostics(listener: (event: { readonly handle: EditorLanguageServiceHandle; readonly version: number; readonly diagnostics: readonly EditorLanguageServiceDiagnostic[] }) => void): () => void;
}

export type EditorLanguageServicePortFactory = (handle: EditorLanguageServiceHandle) => EditorLanguageServicePort | null;
