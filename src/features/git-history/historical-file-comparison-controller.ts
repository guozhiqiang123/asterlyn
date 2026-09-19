import type { CommitFileChange, CommitFileComparison } from "../../models.ts";
import {
  editorDocumentKey,
  type HistoricalFileComparisonDocument,
} from "../../workbench/editor-document.ts";

export interface HistoricalFileComparisonGateway {
  compareCommitFileToCurrent(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    selected: CommitFileChange,
    currentContent: string | null,
    expectedCurrentRevision: string | null,
  ): Promise<CommitFileComparison>;
}

export type HistoricalFileComparisonState =
  | { status: "idle"; document: null; comparison: null; error: null; version: number }
  | { status: "loading"; document: HistoricalFileComparisonDocument; comparison: null; error: null; version: number }
  | { status: "ready"; document: HistoricalFileComparisonDocument; comparison: CommitFileComparison; error: null; version: number }
  | { status: "error"; document: HistoricalFileComparisonDocument; comparison: null; error: string; version: number };

export interface CurrentBufferComparison {
  readonly content: string;
  readonly expectedRevision: string;
  readonly current: () => boolean;
}

type Listener = () => void;

export class HistoricalFileComparisonController {
  state: HistoricalFileComparisonState = idleState(0);

  private readonly gateway: HistoricalFileComparisonGateway;
  private readonly listeners = new Set<Listener>();
  private requestSequence = 0;
  private disposed = false;

  constructor(gateway: HistoricalFileComparisonGateway) {
    this.gateway = gateway;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async open(
    document: HistoricalFileComparisonDocument,
    buffer: CurrentBufferComparison | null,
  ): Promise<HistoricalFileComparisonState> {
    if (this.disposed) return this.state;
    const request = ++this.requestSequence;
    const version = this.state.version + 1;
    this.state = { status: "loading", document: { ...document }, comparison: null, error: null, version };
    this.emit();
    try {
      const result = await this.gateway.compareCommitFileToCurrent(
        document.repositoryRoot,
        document.repositoryId,
        document.commitOid,
        selectedFile(document),
        buffer?.content ?? null,
        buffer?.expectedRevision ?? null,
      );
      if (!this.current(request, document)) return this.state;
      if (buffer && !buffer.current()) throw new Error("The unsaved editor buffer changed while it was compared");
      assertMatchingResult(document, result);
      this.state = {
        status: "ready",
        document: { ...document },
        comparison: structuredClone(result),
        error: null,
        version,
      };
      this.emit();
      return this.state;
    } catch (error) {
      if (!this.current(request, document)) return this.state;
      this.state = {
        status: "error",
        document: { ...document },
        comparison: null,
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

  private current(request: number, document: HistoricalFileComparisonDocument): boolean {
    return !this.disposed && request === this.requestSequence && this.state.document !== null &&
      editorDocumentKey(this.state.document) === editorDocumentKey(document);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function selectedFile(document: HistoricalFileComparisonDocument): CommitFileChange {
  return { path: document.path, originalPath: document.originalPath, status: document.status };
}

function assertMatchingResult(
  document: HistoricalFileComparisonDocument,
  result: CommitFileComparison,
): void {
  if (
    result.repositoryId !== document.repositoryId ||
    result.commitOid !== document.commitOid ||
    result.path !== document.path ||
    result.currentSource !== document.currentSource
  ) {
    throw new Error("The historical comparison response did not match the requested document");
  }
}

function idleState(version: number): HistoricalFileComparisonState {
  return { status: "idle", document: null, comparison: null, error: null, version };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
