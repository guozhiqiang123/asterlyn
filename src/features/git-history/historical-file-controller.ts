import type { CommitFileChange, CommitFilePreview } from "../../models.ts";
import {
  editorDocumentKey,
  type HistoricalFileDocument,
} from "../../editor-document.ts";

export interface HistoricalFileGateway {
  readCommitFile(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    selected: CommitFileChange,
  ): Promise<CommitFilePreview>;
}

export type HistoricalFileState =
  | { status: "idle"; document: null; preview: null; error: null; version: number }
  | { status: "loading"; document: HistoricalFileDocument; preview: null; error: null; version: number }
  | { status: "ready"; document: HistoricalFileDocument; preview: CommitFilePreview; error: null; version: number }
  | { status: "error"; document: HistoricalFileDocument; preview: null; error: string; version: number };

type Listener = () => void;

export class HistoricalFileController {
  state: HistoricalFileState = idleState(0);

  private readonly listeners = new Set<Listener>();
  private readonly gateway: HistoricalFileGateway;
  private requestSequence = 0;
  private disposed = false;

  constructor(gateway: HistoricalFileGateway) {
    this.gateway = gateway;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async open(document: HistoricalFileDocument): Promise<HistoricalFileState> {
    if (this.disposed) return this.state;
    const request = ++this.requestSequence;
    const version = this.state.version + 1;
    this.state = { status: "loading", document: cloneDocument(document), preview: null, error: null, version };
    this.emit();
    try {
      const preview = await this.gateway.readCommitFile(
        document.repositoryRoot,
        document.repositoryId,
        document.commitOid,
        selectedFile(document),
      );
      if (!this.current(request, document)) return this.state;
      assertMatchingPreview(document, preview);
      this.state = {
        status: "ready",
        document: cloneDocument(document),
        preview: structuredClone(preview),
        error: null,
        version,
      };
      this.emit();
      return this.state;
    } catch (error) {
      if (!this.current(request, document)) return this.state;
      this.state = {
        status: "error",
        document: cloneDocument(document),
        preview: null,
        error: errorMessage(error),
        version,
      };
      this.emit();
      return this.state;
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.requestSequence += 1;
    if (this.state.status === "idle") return;
    this.state = idleState(this.state.version + 1);
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requestSequence += 1;
    this.listeners.clear();
  }

  private current(request: number, document: HistoricalFileDocument): boolean {
    return !this.disposed &&
      request === this.requestSequence &&
      this.state.document !== null &&
      editorDocumentKey(this.state.document) === editorDocumentKey(document);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function assertMatchingPreview(
  document: HistoricalFileDocument,
  preview: CommitFilePreview,
): void {
  if (
    preview.repositoryId !== document.repositoryId ||
    preview.commitOid !== document.commitOid ||
    preview.path !== document.path
  ) {
    throw new Error("The historical file response did not match the requested document");
  }
}

function selectedFile(document: HistoricalFileDocument): CommitFileChange {
  return {
    path: document.path,
    originalPath: document.originalPath,
    status: document.status,
  };
}

function cloneDocument(document: HistoricalFileDocument): HistoricalFileDocument {
  return { ...document };
}

function idleState(version: number): HistoricalFileState {
  return { status: "idle", document: null, preview: null, error: null, version };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
