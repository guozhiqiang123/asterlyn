import type {
  CommitComparisonDetails,
  CommitFileChange,
} from "../../models.ts";

export interface HistoryComparisonRequest {
  readonly workspaceRoot: string;
  readonly workspaceGeneration: number;
  readonly repositoryRevision: number;
  readonly repositoryId: string;
  readonly anchorOid: string;
  readonly activeOid: string;
}

export interface HistoryComparisonState {
  readonly request: HistoryComparisonRequest | null;
  readonly beforeOid: string | null;
  readonly afterOid: string | null;
  readonly automaticOrientation: boolean;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly details: CommitComparisonDetails | null;
  readonly selectedFile: string | null;
  readonly error: string | null;
}

export interface HistoryComparisonGateway {
  readCommitComparisonDetails(
    repositoryRoot: string,
    repositoryId: string,
    beforeOid: string,
    afterOid: string,
  ): Promise<CommitComparisonDetails>;
}

export interface HistoryComparisonChange {
  readonly reason: "clear" | "load-start" | "load-complete" | "load-error" | "file-selection";
}

type HistoryComparisonListener = (change: HistoryComparisonChange) => void;

export class HistoryComparisonController {
  private readonly gateway: HistoryComparisonGateway;
  private value: HistoryComparisonState = emptyHistoryComparisonState();
  private readonly listeners = new Set<HistoryComparisonListener>();
  private sequence = 0;
  private disposed = false;

  constructor(gateway: HistoryComparisonGateway) {
    this.gateway = gateway;
  }

  get state(): HistoryComparisonState {
    return this.value;
  }

  subscribe(listener: HistoryComparisonListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  open(request: HistoryComparisonRequest): void {
    const captured = { ...request };
    this.startLoad(captured, captured.anchorOid, captured.activeOid, true, null);
  }

  swap(): boolean {
    const details = this.value.details;
    const request = this.value.request;
    if (!request || !details || this.value.status !== "ready") return false;
    this.startLoad(
      request,
      details.afterOid,
      details.beforeOid,
      false,
      this.value.selectedFile,
    );
    return true;
  }

  retry(): boolean {
    const request = this.value.request;
    const beforeOid = this.value.beforeOid;
    const afterOid = this.value.afterOid;
    if (!request || !beforeOid || !afterOid || this.value.status !== "error") return false;
    this.startLoad(
      request,
      beforeOid,
      afterOid,
      this.value.automaticOrientation,
      this.value.selectedFile,
    );
    return true;
  }

  selectFile(path: string): CommitFileChange | null {
    const file = this.value.details?.files.find((candidate) => candidate.path === path) ?? null;
    if (!file) return null;
    if (this.value.selectedFile !== path) {
      this.value = { ...this.value, selectedFile: path };
      this.emit({ reason: "file-selection" });
    }
    return { ...file };
  }

  clear(): void {
    if (this.value.status === "idle") return;
    this.sequence += 1;
    this.value = emptyHistoryComparisonState();
    this.emit({ reason: "clear" });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sequence += 1;
    this.listeners.clear();
  }

  private startLoad(
    request: HistoryComparisonRequest,
    beforeOid: string,
    afterOid: string,
    autoOrient: boolean,
    selectedFile: string | null,
  ): void {
    const sequence = ++this.sequence;
    this.value = {
      request,
      beforeOid,
      afterOid,
      automaticOrientation: autoOrient,
      status: "loading",
      details: null,
      selectedFile,
      error: null,
    };
    this.emit({ reason: "load-start" });
    void this.completeLoad(sequence, request, beforeOid, afterOid, autoOrient, selectedFile);
  }

  private async completeLoad(
    sequence: number,
    request: HistoryComparisonRequest,
    beforeOid: string,
    afterOid: string,
    autoOrient: boolean,
    selectedFile: string | null,
  ): Promise<void> {
    try {
      let details = await this.gateway.readCommitComparisonDetails(
        request.workspaceRoot,
        request.repositoryId,
        beforeOid,
        afterOid,
      );
      if (!this.accepts(sequence, request)) return;
      if (autoOrient && details.relation === "afterIsAncestor") {
        details = await this.gateway.readCommitComparisonDetails(
          request.workspaceRoot,
          request.repositoryId,
          afterOid,
          beforeOid,
        );
        if (!this.accepts(sequence, request)) return;
      }
      if (
        details.repositoryId !== request.repositoryId ||
        !(
          (details.beforeOid === beforeOid && details.afterOid === afterOid) ||
          (autoOrient && details.beforeOid === afterOid && details.afterOid === beforeOid)
        )
      ) {
        throw new Error("Commit comparison response did not match the requested identity");
      }
      const nextSelection = selectedFile && details.files.some((file) => file.path === selectedFile)
        ? selectedFile
        : null;
      this.value = {
        request,
        beforeOid: details.beforeOid,
        afterOid: details.afterOid,
        automaticOrientation: false,
        status: "ready",
        details,
        selectedFile: nextSelection,
        error: null,
      };
      this.emit({ reason: "load-complete" });
    } catch (error) {
      if (!this.accepts(sequence, request)) return;
      this.value = {
        request,
        beforeOid,
        afterOid,
        automaticOrientation: autoOrient,
        status: "error",
        details: null,
        selectedFile,
        error: error instanceof Error ? error.message : String(error),
      };
      this.emit({ reason: "load-error" });
    }
  }

  private accepts(sequence: number, request: HistoryComparisonRequest): boolean {
    const current = this.value.request;
    return !this.disposed && sequence === this.sequence && Boolean(
      current &&
      current.workspaceRoot === request.workspaceRoot &&
      current.workspaceGeneration === request.workspaceGeneration &&
      current.repositoryRevision === request.repositoryRevision &&
      current.repositoryId === request.repositoryId &&
      current.anchorOid === request.anchorOid &&
      current.activeOid === request.activeOid,
    );
  }

  private emit(change: HistoryComparisonChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

export function emptyHistoryComparisonState(): HistoryComparisonState {
  return {
    request: null,
    beforeOid: null,
    afterOid: null,
    automaticOrientation: false,
    status: "idle",
    details: null,
    selectedFile: null,
    error: null,
  };
}
