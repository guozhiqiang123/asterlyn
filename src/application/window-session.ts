import type {
  OpenedProject,
  RepositorySnapshot,
  TrackedChangeScan,
  UntrackedScan,
} from "../models.ts";
import {
  type SessionInvalidation,
  type SessionInvalidationCause,
  type SessionInvalidationSlice,
} from "./session-invalidation.ts";
import { RepositorySession } from "./repository-session.ts";
import { WorkspaceSession, type WorkspaceActivation } from "./workspace-session.ts";

export interface WindowSessionGateway {
  readTrackedChanges(repositoryRoot: string): Promise<TrackedChangeScan>;
  scanUntracked(repositoryRoot: string, scanId: string): Promise<UntrackedScan>;
  cancelUntrackedScan(scanId: string): Promise<void>;
}

export type WindowSessionChangeReason =
  | "tracked-refresh-start"
  | "tracked-refresh-complete"
  | "tracked-refresh-error"
  | "untracked-scan-start"
  | "untracked-scan-complete"
  | "untracked-scan-error";

export interface WindowSessionChange {
  readonly reason: WindowSessionChangeReason;
  readonly root: string;
  readonly generation: number;
  readonly snapshot?: RepositorySnapshot;
  readonly invalidation?: SessionInvalidation;
  readonly announce?: boolean;
  readonly error?: unknown;
}

type Listener = (change: WindowSessionChange) => void;

export class WindowSession {
  readonly workspace = new WorkspaceSession();
  readonly repository = new RepositorySession();

  private readonly listeners = new Set<Listener>();
  private operationGeneration = 0;
  private scanSequence = 0;
  private activeScan: { id: string; root: string; generation: number } | null = null;
  private trackedRefreshTimer: number | null = null;
  private trackedRefreshRoot: string | null = null;
  private trackedRefreshCause: SessionInvalidationCause = "save";
  private trackedRefreshPaths = new Set<string>();
  private trackedRefreshRunning = false;
  private disposed = false;
  private readonly gateway: WindowSessionGateway;

  constructor(gateway: WindowSessionGateway) {
    this.gateway = gateway;
  }

  get generation(): number {
    return this.operationGeneration;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  beginTransition(): number {
    this.operationGeneration += 1;
    this.cancelUntrackedScan();
    this.cancelScheduledTrackedRefresh();
    return this.operationGeneration;
  }

  matches(generation: number, root?: string): boolean {
    return !this.disposed &&
      generation === this.operationGeneration &&
      (root === undefined || this.workspace.state.root === root);
  }

  activate(
    project: OpenedProject,
    cause: SessionInvalidationCause,
    slices: Iterable<SessionInvalidationSlice>,
  ): WorkspaceActivation {
    const activation = this.workspace.activate(project);
    this.repository.install(activation.identity, project.repository, cause, slices);
    return activation;
  }

  installRepository(
    snapshot: RepositorySnapshot | null,
    cause: SessionInvalidationCause,
    slices: Iterable<SessionInvalidationSlice>,
    options: { paths?: Iterable<string>; overflowed?: boolean } = {},
  ): RepositorySnapshot | null {
    const identity = this.workspace.identity();
    if (!identity) throw new Error("Open a workspace before installing repository state.");
    return this.repository.install(identity, snapshot, cause, slices, options).snapshot;
  }

  installTracked(
    scan: TrackedChangeScan,
    cause: SessionInvalidationCause,
    slices: Iterable<SessionInvalidationSlice>,
    paths: Iterable<string> = [],
  ): RepositorySnapshot | null {
    const identity = this.workspace.identity();
    if (!identity) throw new Error("Open a workspace before installing working-tree state.");
    return this.repository.mergeTracked(identity, scan, cause, paths, slices)?.snapshot ?? null;
  }

  scheduleTrackedRefresh(
    repositoryRoot: string,
    cause: SessionInvalidationCause,
    paths: Iterable<string> = [],
    delay = 100,
  ): void {
    if (this.disposed || this.repository.state.snapshot?.root !== repositoryRoot) return;
    this.trackedRefreshRoot = repositoryRoot;
    this.trackedRefreshCause = cause;
    for (const path of paths) this.trackedRefreshPaths.add(path);
    if (this.trackedRefreshRunning || this.trackedRefreshTimer !== null) return;
    this.trackedRefreshTimer = window.setTimeout(() => {
      this.trackedRefreshTimer = null;
      void this.refreshTracked();
    }, delay);
  }

  async scanUntracked(
    repositoryRoot: string,
    generation: number,
    announce = true,
    cause: SessionInvalidationCause = "manualRefresh",
  ): Promise<void> {
    if (!this.matches(generation, repositoryRoot)) return;
    this.cancelUntrackedScan();
    const scan = {
      id: `${generation}-${++this.scanSequence}`,
      root: repositoryRoot,
      generation,
    };
    this.activeScan = scan;
    this.emit({
      reason: "untracked-scan-start",
      root: repositoryRoot,
      generation,
      announce,
    });
    try {
      const supplement = await this.gateway.scanUntracked(repositoryRoot, scan.id);
      if (this.activeScan !== scan || !this.matches(generation, repositoryRoot)) return;
      const identity = this.workspace.identity();
      const state = identity
        ? this.repository.mergeUntracked(identity, supplement, cause)
        : null;
      const snapshot = state?.snapshot;
      if (!snapshot) return;
      this.emit({
        reason: "untracked-scan-complete",
        root: repositoryRoot,
        generation,
        snapshot,
        invalidation: this.repository.consumeInvalidation() ?? undefined,
        announce,
      });
    } catch (error) {
      if (this.activeScan !== scan || !this.matches(generation, repositoryRoot)) return;
      const identity = this.workspace.identity();
      if (identity) this.repository.markUntrackedFailed(identity);
      this.emit({
        reason: "untracked-scan-error",
        root: repositoryRoot,
        generation,
        snapshot: this.repository.state.snapshot ?? undefined,
        invalidation: this.repository.consumeInvalidation() ?? undefined,
        announce,
        error,
      });
    } finally {
      if (this.activeScan === scan) this.activeScan = null;
    }
  }

  cancelUntrackedScan(): void {
    const scan = this.activeScan;
    if (!scan) return;
    this.activeScan = null;
    void this.gateway.cancelUntrackedScan(scan.id).catch(() => {
      // Session generation and scan identity still reject a late completion.
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.operationGeneration += 1;
    this.cancelUntrackedScan();
    this.cancelScheduledTrackedRefresh();
    this.workspace.clear();
    this.repository.clear();
    this.listeners.clear();
  }

  private async refreshTracked(): Promise<void> {
    if (this.trackedRefreshRunning || this.disposed) return;
    const root = this.trackedRefreshRoot;
    if (!root || this.repository.state.snapshot?.root !== root) return;
    const generation = this.operationGeneration;
    const cause = this.trackedRefreshCause;
    const paths = Array.from(this.trackedRefreshPaths);
    this.trackedRefreshRoot = null;
    this.trackedRefreshPaths.clear();
    this.trackedRefreshRunning = true;
    this.emit({ reason: "tracked-refresh-start", root, generation });
    try {
      const scan = await this.gateway.readTrackedChanges(root);
      if (!this.matches(generation, root)) return;
      const identity = this.workspace.identity();
      const state = identity ? this.repository.mergeTracked(identity, scan, cause, paths) : null;
      const snapshot = state?.snapshot;
      if (!snapshot) return;
      this.emit({
        reason: "tracked-refresh-complete",
        root,
        generation,
        snapshot,
        invalidation: this.repository.consumeInvalidation() ?? undefined,
      });
      void this.scanUntracked(root, generation, false, cause);
    } catch (error) {
      if (this.matches(generation, root)) {
        this.emit({ reason: "tracked-refresh-error", root, generation, error });
      }
    } finally {
      this.trackedRefreshRunning = false;
      if (this.trackedRefreshRoot && this.matches(this.operationGeneration)) {
        this.scheduleTrackedRefresh(
          this.trackedRefreshRoot,
          this.trackedRefreshCause,
          this.trackedRefreshPaths,
        );
      }
    }
  }

  private cancelScheduledTrackedRefresh(): void {
    if (this.trackedRefreshTimer !== null) {
      window.clearTimeout(this.trackedRefreshTimer);
      this.trackedRefreshTimer = null;
    }
    this.trackedRefreshRoot = null;
    this.trackedRefreshPaths.clear();
  }

  private emit(change: WindowSessionChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}
