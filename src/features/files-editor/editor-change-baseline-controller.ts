import type { FileChange, RepositorySnapshot, WorkingDiffBase } from "../../models.ts";

export interface EditorChangeBaselineGateway {
  readWorkingDiffBase(repositoryRoot: string, change: FileChange): Promise<WorkingDiffBase>;
}

export interface EditorChangeBaselineChange {
  readonly path: string;
}

type BaselineEntry = {
  readonly identity: string;
  status: "loading" | "ready" | "unavailable";
  content: string | null;
};

type Listener = (change: EditorChangeBaselineChange) => void;

/**
 * Owns bounded, read-only HEAD baselines for open changed files. It never owns
 * worktree content and rejects every completion whose repository projection
 * has moved since the request began.
 */
export class EditorChangeBaselineController {
  private readonly gateway: EditorChangeBaselineGateway;
  private readonly entries = new Map<string, BaselineEntry>();
  private readonly listeners = new Set<Listener>();
  private snapshot: RepositorySnapshot | null = null;
  private disposed = false;

  constructor(gateway: EditorChangeBaselineGateway) {
    this.gateway = gateway;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  installSnapshot(snapshot: RepositorySnapshot | null): void {
    if (this.disposed) return;
    if (snapshot === this.snapshot) return;
    this.snapshot = snapshot;
    const invalidated: string[] = [];
    const identities = new Map(
      snapshot?.changes.map((change) => [change.path, changeBaselineIdentity(snapshot, change)]) ?? [],
    );
    for (const [path, entry] of this.entries) {
      if (identities.get(path) !== entry.identity) {
        this.entries.delete(path);
        if (entry.status === "ready") invalidated.push(path);
      }
    }
    for (const path of invalidated) this.emit(path);
  }

  content(path: string): string | null {
    const entry = this.entries.get(path);
    return entry?.status === "ready" ? entry.content : null;
  }

  baseline(
    snapshot: RepositorySnapshot | null,
    repositoryId: string,
    path: string,
    fallback: string,
  ): string {
    this.installSnapshot(snapshot);
    if (repositoryId === ".") this.load(path);
    return this.content(path) ?? fallback;
  }

  load(path: string): void {
    if (this.disposed) return;
    const snapshot = this.snapshot;
    const change = snapshot?.changes.find((candidate) => candidate.path === path);
    if (!snapshot || !change || !supportsBaseline(change)) return;
    const identity = changeBaselineIdentity(snapshot, change);
    const existing = this.entries.get(path);
    if (existing?.identity === identity) return;
    const entry: BaselineEntry = { identity, status: "loading", content: null };
    this.entries.set(path, entry);
    void this.gateway.readWorkingDiffBase(snapshot.root, change).then(
      (result) => this.complete(path, entry, result.content),
      () => this.complete(path, entry, null),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.entries.clear();
    this.listeners.clear();
    this.snapshot = null;
  }

  private complete(
    path: string,
    entry: BaselineEntry,
    content: string | null,
  ): void {
    if (this.disposed || this.entries.get(path) !== entry) return;
    entry.status = content === null ? "unavailable" : "ready";
    entry.content = content;
    this.emit(path);
  }

  private emit(path: string): void {
    for (const listener of this.listeners) listener({ path });
  }
}

function supportsBaseline(change: FileChange): boolean {
  return !change.conflicted && !change.submodule &&
    change.indexStatus !== "deleted" && change.worktreeStatus !== "deleted";
}

function changeBaselineIdentity(snapshot: RepositorySnapshot, change: FileChange): string {
  return [
    snapshot.root,
    snapshot.branch.oid ?? "",
    change.path,
    change.originalPath ?? "",
    change.indexStatus,
    change.worktreeStatus,
    change.conflicted ? "1" : "0",
    change.submodule ? "1" : "0",
  ].join("\0");
}
