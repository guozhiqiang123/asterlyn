import type {
  GitOperationSnapshot,
  OpenedProject,
  RepositorySnapshot,
  RepositorySliceProject,
  RepositoryStateSlice,
  TrackedChangeScan,
  UntrackedScan,
} from "../models.ts";
import {
  type SessionInvalidation,
  type SessionInvalidationCause,
  type SessionInvalidationSlice,
} from "./session-invalidation.ts";
import { RepositorySession } from "./repository-session.ts";
import type { RepositoryReadCommit, RepositoryReadLease } from "./repository-session.ts";
import type { RuntimeScheduler, ScheduledTask } from "./runtime-scheduler.ts";
import { WorkspaceSession, type WorkspaceActivation, type WorkspaceSessionIdentity } from "./workspace-session.ts";

const UNTRACKED_SCAN_WATCHDOG_MS = 35_000;

export interface WindowSessionGateway {
  openProject(path: string): Promise<OpenedProject>;
  readProject(path: string): Promise<OpenedProject>;
  readRepositorySlices(
    repositoryRoot: string,
    slices: RepositoryStateSlice[],
  ): Promise<RepositorySliceProject>;
  readTrackedChanges(repositoryRoot: string): Promise<TrackedChangeScan>;
  scanUntracked(repositoryRoot: string, scanId: string): Promise<UntrackedScan>;
  cancelUntrackedScan(scanId: string): Promise<void>;
}

export interface ProjectTransition {
  readonly generation: number;
  readonly project: OpenedProject;
  readonly activation: WorkspaceActivation;
  settle(): void;
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
  private reconciliationBarrierGeneration: number | null = null;
  private readonly reconciliationWaiters = new Set<() => void>();
  private scanSequence = 0;
  private activeScan: {
    id: string;
    root: string;
    generation: number;
    workingTreeRevision: number;
    announce: boolean;
    completion: Promise<void>;
    settle: () => void;
    watchdog: ScheduledTask | null;
  } | null = null;
  private pendingUntrackedRecovery: ScheduledTask | null = null;
  private untrackedRecoveryContext: {
    root: string;
    cause: SessionInvalidationCause;
  } | null = null;
  private trackedRefreshTimer: ScheduledTask | null = null;
  private trackedRefreshRoot: string | null = null;
  private trackedRefreshCause: SessionInvalidationCause = "save";
  private trackedRefreshPaths = new Set<string>();
  private trackedRefreshRunning = false;
  private disposed = false;
  private readonly gateway: WindowSessionGateway;
  private readonly scheduler: RuntimeScheduler;

  constructor(gateway: WindowSessionGateway, scheduler: RuntimeScheduler) {
    this.gateway = gateway;
    this.scheduler = scheduler;
  }

  get generation(): number {
    return this.operationGeneration;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  beginTransition(options: { reconciliationBarrier?: boolean } = {}): number {
    this.operationGeneration += 1;
    if (options.reconciliationBarrier) {
      this.reconciliationBarrierGeneration = this.operationGeneration;
    } else if (this.reconciliationBarrierGeneration !== null) {
      this.reconciliationBarrierGeneration = null;
      for (const resolve of this.reconciliationWaiters) resolve();
      this.reconciliationWaiters.clear();
    }
    this.cancelPendingUntrackedRecovery();
    this.cancelUntrackedScan();
    this.cancelScheduledTrackedRefresh();
    return this.operationGeneration;
  }

  completeTransition(generation: number): void {
    if (this.reconciliationBarrierGeneration !== generation) return;
    this.reconciliationBarrierGeneration = null;
    for (const resolve of this.reconciliationWaiters) resolve();
    this.reconciliationWaiters.clear();
    this.schedulePendingUntrackedRecovery(generation);
  }

  async whenReconciliationIdle(identity: WorkspaceSessionIdentity): Promise<boolean> {
    while (!this.disposed && this.workspace.matches(identity)) {
      if (this.reconciliationBarrierGeneration === null) return true;
      await new Promise<void>((resolve) => this.reconciliationWaiters.add(resolve));
    }
    return false;
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

  async openProject(
    path: string,
    cause: SessionInvalidationCause,
    slices: Iterable<SessionInvalidationSlice>,
  ): Promise<ProjectTransition | null> {
    const generation = this.beginTransition({ reconciliationBarrier: true });
    let settlementTransferred = false;
    try {
      const project = await this.gateway.openProject(path);
      if (!this.matches(generation)) return null;
      const activation = this.activate(project, cause, slices);
      settlementTransferred = true;
      return {
        generation,
        project,
        activation,
        settle: () => this.completeTransition(generation),
      };
    } finally {
      if (!settlementTransferred) this.completeTransition(generation);
    }
  }

  beginRepositoryRead(
    identity: WorkspaceSessionIdentity,
    slices: Iterable<RepositoryStateSlice>,
  ): RepositoryReadLease | null {
    if (this.disposed || !this.workspace.matches(identity)) return null;
    return this.repository.beginRead(identity, slices);
  }

  installRepositoryRead(
    lease: RepositoryReadLease,
    project: OpenedProject,
    cause: SessionInvalidationCause,
    options: { paths?: Iterable<string>; recovery?: import("../models.ts").WorkspaceWatchRecovery } = {},
  ): RepositoryReadCommit | null {
    if (
      this.disposed ||
      !this.workspace.matches(lease.identity) ||
      project.root !== lease.identity.root
    ) return null;
    const committed = this.repository.installRead(lease, project.repository, cause, options);
    if (!committed) return null;
    this.workspace.activate(project);
    return committed;
  }

  async refreshProject(identity: WorkspaceSessionIdentity): Promise<OpenedProject | null> {
    const path = identity.root;
    if (this.disposed || !this.workspace.matches(identity)) return null;
    const operationGeneration = this.operationGeneration;
    const project = await this.gateway.readProject(path);
    if (
      !this.matches(operationGeneration, path) ||
      !this.workspace.matches(identity) ||
      project.root !== path
    ) return null;
    return project;
  }

  async refreshRepositorySlices(
    identity: WorkspaceSessionIdentity,
    slices: RepositoryStateSlice[],
  ): Promise<OpenedProject | null> {
    if (this.disposed || !this.workspace.matches(identity)) return null;
    const operationGeneration = this.operationGeneration;
    const project = await this.gateway.readRepositorySlices(identity.root, slices);
    if (
      !this.matches(operationGeneration, identity.root) ||
      !this.workspace.matches(identity) ||
      project.root !== identity.root
    ) return null;
    const current = this.repository.state.snapshot;
    if (!project.repository) return { root: project.root, repository: null };
    validateRepositorySlicePayload(project.repository, identity.root, slices);
    if (!current || current.gitDir !== project.repository.gitDir) {
      return this.refreshProject(identity);
    }
    return {
      root: project.root,
      repository: materializeRepositorySlices(current, project.repository),
    };
  }

  installRepository(
    snapshot: RepositorySnapshot | null,
    cause: SessionInvalidationCause,
    slices: Iterable<SessionInvalidationSlice>,
    options: { paths?: Iterable<string>; recovery?: import("../models.ts").WorkspaceWatchRecovery } = {},
  ): RepositorySnapshot | null {
    const identity = this.workspace.identity();
    if (!identity) throw new Error("Open a workspace before installing repository state.");
    const state = this.repository.install(identity, snapshot, cause, slices, options);
    this.workspace.activate({ root: identity.root, repository: state.snapshot });
    return state.snapshot;
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

  installTrackedOperation(
    scan: TrackedChangeScan,
    operation: GitOperationSnapshot | null,
    cause: SessionInvalidationCause,
    slices: Iterable<SessionInvalidationSlice>,
  ): RepositorySnapshot | null {
    const identity = this.workspace.identity();
    if (!identity) throw new Error("Open a workspace before installing Git operation state.");
    return this.repository.mergeTrackedOperation(
      identity,
      scan,
      operation,
      cause,
      slices,
    )?.snapshot ?? null;
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
    this.trackedRefreshTimer = this.scheduler.schedule(() => {
      this.trackedRefreshTimer = null;
      void this.refreshTracked();
    }, delay);
  }

  scanUntracked(
    repositoryRoot: string,
    generation: number,
    announce = true,
    cause: SessionInvalidationCause = "manualRefresh",
  ): Promise<void> {
    if (!this.matches(generation, repositoryRoot)) return Promise.resolve();
    this.cancelPendingUntrackedRecovery();
    this.cancelUntrackedScan();
    let settle = () => {};
    const completion = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const scan: NonNullable<WindowSession["activeScan"]> = {
      id: `${generation}-${++this.scanSequence}`,
      root: repositoryRoot,
      generation,
      workingTreeRevision: this.repository.state.workingTreeRevision,
      announce,
      completion,
      settle,
      watchdog: null,
    };
    this.untrackedRecoveryContext = { root: repositoryRoot, cause };
    this.activeScan = scan;
    scan.watchdog = this.scheduler.schedule(
      () => this.expireUntrackedScan(scan),
      UNTRACKED_SCAN_WATCHDOG_MS,
    );
    this.emit({
      reason: "untracked-scan-start",
      root: repositoryRoot,
      generation,
      announce: scan.announce,
    });
    void this.runUntrackedScan(scan, cause);
    return scan.completion;
  }

  ensureUntrackedScan(
    repositoryRoot: string,
    generation: number,
    announce = true,
    cause: SessionInvalidationCause = "manualRefresh",
  ): Promise<void> {
    const active = this.activeScan;
    if (
      active &&
      active.root === repositoryRoot &&
      active.generation === generation
    ) {
      if (announce && !active.announce) {
        active.announce = true;
        this.emit({
          reason: "untracked-scan-start",
          root: repositoryRoot,
          generation,
          announce: true,
        });
      }
      return active.completion;
    }
    return this.scanUntracked(repositoryRoot, generation, announce, cause);
  }

  private async runUntrackedScan(
    scan: NonNullable<WindowSession["activeScan"]>,
    cause: SessionInvalidationCause,
  ): Promise<void> {
    const { root: repositoryRoot, generation } = scan;
    try {
      const supplement = await this.gateway.scanUntracked(repositoryRoot, scan.id);
      if (this.activeScan !== scan || !this.matches(generation, repositoryRoot)) return;
      const identity = this.workspace.identity();
      const state = identity
        ? this.repository.mergeUntracked(
            identity,
            supplement,
            cause,
            scan.workingTreeRevision,
          )
        : null;
      const snapshot = state?.snapshot;
      if (!snapshot) {
        if (this.matches(generation, repositoryRoot)) {
          this.scheduleTrackedRefresh(repositoryRoot, cause, [], 0);
        }
        return;
      }
      this.emit({
        reason: "untracked-scan-complete",
        root: repositoryRoot,
        generation,
        snapshot,
        invalidation: this.repository.consumeInvalidation() ?? undefined,
        announce: scan.announce,
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
        announce: scan.announce,
        error,
      });
    } finally {
      if (scan.watchdog !== null) {
        this.scheduler.cancel(scan.watchdog);
        scan.watchdog = null;
      }
      if (this.activeScan === scan) this.activeScan = null;
      scan.settle();
    }
  }

  private expireUntrackedScan(
    scan: NonNullable<WindowSession["activeScan"]>,
  ): void {
    if (this.activeScan !== scan || !this.matches(scan.generation, scan.root)) return;
    scan.watchdog = null;
    this.activeScan = null;
    scan.settle();
    void this.gateway.cancelUntrackedScan(scan.id).catch(() => {
      // The session identity below still rejects a late completion.
    });
    const identity = this.workspace.identity();
    if (identity) this.repository.markUntrackedFailed(identity);
    this.emit({
      reason: "untracked-scan-error",
      root: scan.root,
      generation: scan.generation,
      snapshot: this.repository.state.snapshot ?? undefined,
      invalidation: this.repository.consumeInvalidation() ?? undefined,
      announce: scan.announce,
      error: new Error("The untracked-file scan did not respond within 35 seconds."),
    });
  }

  cancelUntrackedScan(): void {
    const scan = this.activeScan;
    if (!scan) return;
    this.activeScan = null;
    if (scan.watchdog !== null) {
      this.scheduler.cancel(scan.watchdog);
      scan.watchdog = null;
    }
    scan.settle();
    void this.gateway.cancelUntrackedScan(scan.id).catch(() => {
      // Session generation and scan identity still reject a late completion.
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.operationGeneration += 1;
    this.cancelPendingUntrackedRecovery();
    this.cancelUntrackedScan();
    this.cancelScheduledTrackedRefresh();
    this.workspace.clear();
    this.repository.clear();
    for (const resolve of this.reconciliationWaiters) resolve();
    this.reconciliationWaiters.clear();
    this.listeners.clear();
  }

  private async refreshTracked(): Promise<void> {
    if (this.trackedRefreshRunning || this.disposed) return;
    const root = this.trackedRefreshRoot;
    if (!root || this.repository.state.snapshot?.root !== root) return;
    const generation = this.operationGeneration;
    const workingTreeRevision = this.repository.state.workingTreeRevision;
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
      const state = identity
        ? this.repository.mergeTracked(
            identity,
            scan,
            cause,
            paths,
            ["workingTree"],
            workingTreeRevision,
          )
        : null;
      const snapshot = state?.snapshot;
      if (!snapshot) {
        if (this.matches(generation, root)) {
          this.trackedRefreshRoot = root;
          for (const path of paths) this.trackedRefreshPaths.add(path);
        }
        return;
      }
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
      this.scheduler.cancel(this.trackedRefreshTimer);
      this.trackedRefreshTimer = null;
    }
    this.trackedRefreshRoot = null;
    this.trackedRefreshPaths.clear();
  }

  private schedulePendingUntrackedRecovery(generation: number): void {
    this.cancelPendingUntrackedRecovery();
    const snapshot = this.repository.state.snapshot;
    if (
      !snapshot ||
      snapshot.untrackedState !== "pending" ||
      !this.matches(generation, snapshot.root)
    ) return;
    const root = snapshot.root;
    const cause = this.untrackedRecoveryContext?.root === root
      ? this.untrackedRecoveryContext.cause
      : "manualRefresh";
    this.pendingUntrackedRecovery = this.scheduler.schedule(() => {
      this.pendingUntrackedRecovery = null;
      const current = this.repository.state.snapshot;
      if (
        !current ||
        current.root !== root ||
        current.untrackedState !== "pending" ||
        !this.matches(generation, root)
      ) return;
      void this.ensureUntrackedScan(root, generation, false, cause);
    }, 0);
  }

  private cancelPendingUntrackedRecovery(): void {
    if (this.pendingUntrackedRecovery === null) return;
    this.scheduler.cancel(this.pendingUntrackedRecovery);
    this.pendingUntrackedRecovery = null;
  }

  private emit(change: WindowSessionChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}

function validateRepositorySlicePayload(
  snapshot: NonNullable<RepositorySliceProject["repository"]>,
  root: string,
  slices: Iterable<RepositoryStateSlice>,
): void {
  if (snapshot.root !== root) {
    throw new Error("Repository slice snapshot belongs to another workspace session.");
  }
  const fields = new Set(Object.keys(snapshot));
  const required = new Map<RepositoryStateSlice, string[]>([
    ["workingTree", ["changes", "untrackedState"]],
    ["head", ["branch"]],
    ["refs", ["repositoryRoots", "branches", "remotes"]],
    ["history", ["commits"]],
    ["operation", ["operation"]],
  ]);
  for (const slice of slices) {
    for (const field of required.get(slice) ?? []) {
      if (!fields.has(field)) {
        throw new Error(`Repository slice snapshot omitted ${field} for ${slice}.`);
      }
    }
  }
}

function materializeRepositorySlices(
  current: RepositorySnapshot,
  incoming: NonNullable<RepositorySliceProject["repository"]>,
): RepositorySnapshot {
  return {
    ...current,
    gitDir: incoming.gitDir,
    repositoryRoots: incoming.repositoryRoots ?? current.repositoryRoots,
    branch: incoming.branch ?? current.branch,
    operation: "operation" in incoming ? incoming.operation ?? null : current.operation,
    changes: incoming.changes ?? current.changes,
    commits: incoming.commits ?? current.commits,
    branches: incoming.branches ?? current.branches,
    remotes: incoming.remotes ?? current.remotes,
    untrackedState: incoming.untrackedState ?? current.untrackedState,
  };
}
