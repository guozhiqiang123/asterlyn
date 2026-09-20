import type {
  OpenedProject,
  RepositoryStateSlice,
  WorkspaceWatchInvalidation,
} from "../models.ts";
import type { WorkspaceWatchBridge } from "../protocol/workspace-watch.ts";
import {
  createSessionInvalidation,
  invalidates,
  mergeSessionInvalidations,
  type SessionInvalidation,
  type SessionInvalidationCause,
} from "./session-invalidation.ts";
import type { WindowSession } from "./window-session.ts";
import type { RepositoryReadLease } from "./repository-session.ts";
import type { RuntimeScheduler, ScheduledTask } from "./runtime-scheduler.ts";

const FOCUS_RECOVERY_AFTER_MS = 30_000;
const FOCUS_RECOVERY_COOLDOWN_MS = 30_000;
const MAX_BUFFERED_ACTIVATION_EVENTS = 64;
const BROAD_RECOVERY_WINDOW_MS = 30_000;
const MAX_BROAD_RECOVERIES_PER_WINDOW = 3;
const BROAD_RECOVERY_BACKOFF_MS = 100;
const MAX_STALE_READ_RETRIES = 3;
const STALE_READ_RETRY_BACKOFF_MS = 25;

export type WorkspaceWatchHealth =
  | "starting"
  | "healthy"
  | "degraded"
  | "suspended"
  | "unavailable";

export interface WorkspaceWatchCoordinatorActions {
  reconcileRepository(
    project: OpenedProject,
    lease: RepositoryReadLease,
    cause: SessionInvalidationCause,
  ): boolean;
  refreshRemoteAfterFocus(): Promise<boolean> | boolean;
  reportWarning(message: string): void;
  messages?(): WorkspaceWatchMessages;
}

export interface WorkspaceWatchFilesPort {
  refresh(): Promise<boolean>;
}

export interface WorkspaceWatchEditorPort {
  subscribe(listener: (change: { tabsChanged?: boolean }) => void): () => void;
  workspacePaths(): string[];
  reconcileExternalPaths(workspacePaths: Iterable<string>): Promise<void>;
}

export interface WorkspaceFocusPort {
  subscribe(onBlur: () => void, onFocus: () => void): () => void;
}

export interface WorkspaceWatchMessages {
  watchUnavailable(detail?: string): string;
  watchStartFailed(detail: string): string;
  watchSuspended(): string;
  externalReconcileFailed(detail: string): string;
}

const DEFAULT_MESSAGES: WorkspaceWatchMessages = {
  watchUnavailable: (detail) => detail ?? "Native file watching is unavailable; focus and manual refresh remain active.",
  watchStartFailed: (detail) => `Native file watching could not start: ${detail}`,
  watchSuspended: () =>
    "Automatic watcher recovery was suspended after repeated conflicts; use Refresh to verify the workspace.",
  externalReconcileFailed: (detail) => `External changes could not be reconciled: ${detail}`,
};

export class WorkspaceWatchCoordinator {
  private readonly bridge: WorkspaceWatchBridge;
  private readonly session: WindowSession;
  private readonly files: WorkspaceWatchFilesPort;
  private readonly editor: WorkspaceWatchEditorPort;
  private readonly actions: WorkspaceWatchCoordinatorActions;
  private identity: { root: string; generation: number } | null = null;
  private pending: SessionInvalidation | null = null;
  private drainPromise: Promise<void> | null = null;
  private disposed = false;
  private activationSequence = 0;
  private activationQueue: Promise<void> = Promise.resolve();
  private releaseSubscription: (() => void) | null = null;
  private readonly releaseEditorSubscription: () => void;
  private subscription: Promise<void> | null = null;
  private watchInstance: number | null = null;
  private activationPending = false;
  private bufferedActivationEvents: WorkspaceWatchInvalidation[] = [];
  private activationBufferOverflowed = false;
  private watchHealth: WorkspaceWatchHealth = "starting";
  private broadRecoveryTimes: number[] = [];
  private recoveryTimer: ScheduledTask | null = null;
  private drainDeferred = false;
  private staleReadRetries = 0;
  private suspendedWarningReported = false;
  private lastAcceptedAt = 0;
  private lastFocusRecoveryAt: number | null = null;
  private blurredAt: number | null = null;
  private readonly releaseFocusSubscription: () => void;
  private readonly now: () => number;
  private readonly scheduler: RuntimeScheduler;

  constructor(
    bridge: WorkspaceWatchBridge,
    session: WindowSession,
    files: WorkspaceWatchFilesPort,
    editor: WorkspaceWatchEditorPort,
    actions: WorkspaceWatchCoordinatorActions,
    scheduler: RuntimeScheduler,
    focus: WorkspaceFocusPort | null = null,
    now: () => number = () => Date.now(),
  ) {
    this.bridge = bridge;
    this.session = session;
    this.files = files;
    this.editor = editor;
    this.actions = actions;
    this.scheduler = scheduler;
    this.now = now;
    this.releaseEditorSubscription = editor.subscribe((change) => {
      if (change.tabsChanged) this.activate();
    });
    this.releaseFocusSubscription = focus?.subscribe(() => {
      this.blurredAt = this.now();
    }, () => this.recoverAfterFocus()) ?? (() => undefined);
  }

  get health(): WorkspaceWatchHealth {
    return this.watchHealth;
  }

  recordAuthoritativeRefresh(): void {
    this.broadRecoveryTimes = [];
    this.staleReadRetries = 0;
    this.suspendedWarningReported = false;
    this.watchHealth = this.watchInstance === null ? "unavailable" : "healthy";
    this.lastAcceptedAt = this.now();
    if (this.pending) this.scheduleDrain(0);
  }

  activate(): void {
    const identity = this.session.workspace.identity();
    if (!identity || this.disposed) return;
    this.identity = identity;
    const sequence = ++this.activationSequence;
    this.activationQueue = this.activationQueue.catch(() => undefined).then(async () => {
      if (!this.current(sequence, identity)) return;
      try {
        await this.ensureSubscription();
        if (!this.current(sequence, identity)) return;
        const previousWatchInstance = this.watchInstance;
        const continuingHandshake = this.activationPending;
        this.activationPending = true;
        this.watchInstance = null;
        if (!continuingHandshake) {
          this.bufferedActivationEvents = [];
          this.activationBufferOverflowed = false;
        }
        const status = await this.bridge.start(
          identity.root,
          identity.generation,
          this.editor.workspacePaths(),
        );
        if (!this.current(sequence, identity)) {
          if (this.disposed || sequence === this.activationSequence) {
            await this.bridge.stop().catch(() => undefined);
          }
          return;
        }
        this.watchInstance = status.watchInstance;
        this.activationPending = false;
        if (!status.available || status.watchInstance === null) {
          this.watchHealth = "unavailable";
        } else {
          const instanceChanged = previousWatchInstance !== status.watchInstance;
          if (instanceChanged) {
            this.broadRecoveryTimes = [];
            this.suspendedWarningReported = false;
          }
          if (instanceChanged || this.watchHealth !== "suspended") {
            this.watchHealth = status.verificationRequired ? "starting" : "healthy";
          }
          if (instanceChanged) this.lastAcceptedAt = this.now();
        }
        const buffered = this.bufferedActivationEvents;
        const bufferOverflowed = this.activationBufferOverflowed;
        this.bufferedActivationEvents = [];
        this.activationBufferOverflowed = false;
        for (const event of buffered) this.receive(event);
        if (this.bridge.native && !status.available) {
          this.actions.reportWarning(this.messages().watchUnavailable(status.message ?? undefined));
        }
        if (status.available && (status.verificationRequired || bufferOverflowed)) {
          this.schedulePlanVerification(identity, bufferOverflowed);
        }
      } catch (error) {
        if (this.current(sequence, identity)) {
          this.activationPending = false;
          this.watchInstance = null;
          this.watchHealth = "unavailable";
          this.bufferedActivationEvents = [];
          this.activationBufferOverflowed = false;
        }
        if (this.current(sequence, identity) && this.bridge.native) {
          this.actions.reportWarning(this.messages().watchStartFailed(errorMessage(error)));
        }
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activationSequence += 1;
    this.identity = null;
    this.watchInstance = null;
    this.activationPending = false;
    this.bufferedActivationEvents = [];
    this.activationBufferOverflowed = false;
    if (this.recoveryTimer !== null) {
      this.scheduler.cancel(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.pending = null;
    this.releaseFocusSubscription();
    this.releaseSubscription?.();
    this.releaseSubscription = null;
    this.releaseEditorSubscription();
    void this.bridge.stop().catch(() => undefined);
  }

  private async ensureSubscription(): Promise<void> {
    if (!this.bridge.native || this.releaseSubscription || this.disposed) return;
    if (!this.subscription) {
      this.subscription = this.bridge.subscribe((invalidation) => {
        this.receive(invalidation);
      }).then((release) => {
        if (this.disposed) release();
        else this.releaseSubscription = release;
      }).finally(() => {
        this.subscription = null;
      });
    }
    await this.subscription;
  }

  private receive(event: WorkspaceWatchInvalidation): void {
    const identity = this.identity;
    if (
      this.disposed ||
      !identity ||
      event.root !== identity.root ||
      event.generation !== identity.generation ||
      !this.session.workspace.matches(identity)
    ) return;
    if (this.watchInstance === null) {
      if (
        this.activationPending &&
        this.bufferedActivationEvents.length < MAX_BUFFERED_ACTIVATION_EVENTS
      ) this.bufferedActivationEvents.push(event);
      else if (this.activationPending) this.activationBufferOverflowed = true;
      return;
    }
    if (event.watchInstance !== this.watchInstance) {
      if (!this.activationPending && event.watchInstance > this.watchInstance) {
        this.watchInstance = event.watchInstance;
        this.broadRecoveryTimes = [];
        this.suspendedWarningReported = false;
        this.watchHealth = "healthy";
      } else {
        return;
      }
    }
    this.staleReadRetries = 0;
    let drainDelay = 0;
    if (event.recovery === "backendOverflow") {
      const authorizedDelay = this.authorizeBroadRecovery();
      if (authorizedDelay === null) return;
      drainDelay = authorizedDelay;
    } else if (this.watchHealth === "suspended") {
      // Exact new evidence remains useful and can close the circuit after it reconciles.
      this.watchHealth = "degraded";
    }
    let invalidation: SessionInvalidation | null = null;
    for (const cause of event.causes) {
      const next = createSessionInvalidation(
        event.root,
        event.generation,
        event.slices,
        cause,
        { paths: event.paths, recovery: event.recovery },
      );
      invalidation = mergeSessionInvalidations(invalidation, next);
    }
    if (!invalidation) return;
    this.pending = mergeSessionInvalidations(this.pending, invalidation);
    this.scheduleDrain(drainDelay);
  }

  private schedulePlanVerification(
    identity: { root: string; generation: number },
    complete: boolean,
  ): void {
    if (!this.session.workspace.matches(identity)) return;
    const slices: RepositoryStateSlice[] = complete
      ? [
          "workspaceCatalog",
          "openDocuments",
          "repositoryCapability",
          "workingTree",
          "head",
          "refs",
          "history",
          "operation",
        ]
      : ["workspaceCatalog", "openDocuments"];
    if (!complete && this.session.repository.state.snapshot) slices.push("workingTree");
    this.pending = mergeSessionInvalidations(
      this.pending,
      createSessionInvalidation(
        identity.root,
        identity.generation,
        slices,
        complete ? "overflowRecovery" : "watcher",
        complete ? { recovery: "backendOverflow" } : {},
      ),
    );
    if (!complete) {
      this.scheduleDrain(0);
      return;
    }
    const delay = this.authorizeBroadRecovery();
    if (delay !== null) this.scheduleDrain(delay);
  }

  private scheduleDrain(delay: number): void {
    if (this.disposed) return;
    if (delay <= 0) {
      if (this.recoveryTimer !== null) {
        this.scheduler.cancel(this.recoveryTimer);
        this.recoveryTimer = null;
      }
      this.drainDeferred = false;
      void this.drain();
      return;
    }
    if (this.recoveryTimer !== null) return;
    this.drainDeferred = true;
    this.recoveryTimer = this.scheduler.schedule(() => {
      this.recoveryTimer = null;
      this.drainDeferred = false;
      void this.drain();
    }, delay);
  }

  private drain(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.drainPromise) return this.drainPromise;
    const task = this.drainPending().finally(() => {
      if (this.drainPromise === task) this.drainPromise = null;
      if (this.pending && !this.disposed && !this.drainDeferred) void this.drain();
    });
    this.drainPromise = task;
    return task;
  }

  private async drainPending(): Promise<void> {
    while (this.pending && !this.disposed && !this.drainDeferred) {
      const invalidation = this.pending;
      this.pending = null;
      try {
        await this.reconcile(invalidation);
        if (this.drainDeferred) continue;
        this.staleReadRetries = 0;
        this.lastAcceptedAt = this.now();
        if (this.watchHealth === "starting" || this.watchHealth === "degraded") {
          this.watchHealth = "healthy";
        }
      } catch (error) {
        if (this.watchHealth !== "suspended" && this.watchHealth !== "unavailable") {
          this.watchHealth = "degraded";
        }
        if (this.session.workspace.matches({
          root: invalidation.root,
          generation: invalidation.generation,
        })) {
          this.actions.reportWarning(this.messages().externalReconcileFailed(errorMessage(error)));
        }
      }
    }
  }

  private async reconcile(invalidation: SessionInvalidation): Promise<void> {
    const identity = { root: invalidation.root, generation: invalidation.generation };
    if (!this.session.workspace.matches(identity)) return;
    if (!(await this.session.whenReconciliationIdle(identity))) return;
    const cause = reconciliationCause(invalidation);
    if (invalidates(invalidation, "openDocuments")) {
      await this.editor.reconcileExternalPaths(invalidation.paths);
    }
    if (!this.session.workspace.matches(identity)) return;
    if (invalidates(invalidation, "workspaceCatalog")) {
      const refreshed = await this.files.refresh();
      const repositoryActivationFollows = invalidation.slices.some((slice) =>
        isRepositorySlice(slice) && slice !== "workingTree"
      );
      if (
        refreshed &&
        !repositoryActivationFollows &&
        this.session.workspace.matches(identity)
      ) this.activate();
    }
    if (!this.session.workspace.matches(identity)) return;

    const repositorySlices = invalidation.slices.filter(isRepositorySlice);
    const metadataSlices = repositorySlices.filter((slice) => slice !== "workingTree");
    if (metadataSlices.length > 0) {
      const lease = this.session.beginRepositoryRead(identity, repositorySlices);
      if (!lease) return;
      const project = await this.session.refreshRepositorySlices(identity, repositorySlices);
      if (!project || !this.session.workspace.matches(identity)) return;
      const accepted = this.actions.reconcileRepository(project, lease, cause);
      if (!accepted && this.session.workspace.matches(identity)) {
        this.pending = mergeSessionInvalidations(this.pending, invalidation);
        this.staleReadRetries += 1;
        if (this.staleReadRetries <= MAX_STALE_READ_RETRIES) {
          this.scheduleDrain(
            STALE_READ_RETRY_BACKOFF_MS * 2 ** (this.staleReadRetries - 1),
          );
        } else {
          this.drainDeferred = true;
          this.watchHealth = "degraded";
        }
        return;
      }
      this.activate();
    }
    if (metadataSlices.length === 0 && invalidates(invalidation, "workingTree")) {
      this.session.scheduleTrackedRefresh(
        invalidation.root,
        cause,
        invalidation.paths,
        0,
      );
    }
  }

  private recoverAfterFocus(): void {
    const blurredAt = this.blurredAt;
    this.blurredAt = null;
    const identity = this.identity;
    if (
      blurredAt === null ||
      !identity ||
      !this.session.workspace.matches(identity)
    ) return;
    const now = this.now();
    const longAbsence = now - blurredAt >= FOCUS_RECOVERY_AFTER_MS;
    const stale = this.lastAcceptedAt === 0 || now - this.lastAcceptedAt >= FOCUS_RECOVERY_AFTER_MS;
    const outsideCooldown = this.lastFocusRecoveryAt === null ||
      now - this.lastFocusRecoveryAt >= FOCUS_RECOVERY_COOLDOWN_MS;
    const localRecoveryNeeded = longAbsence && stale && outsideCooldown;
    if (localRecoveryNeeded) {
      this.lastFocusRecoveryAt = now;
      const slices = ["workspaceCatalog", "openDocuments", "repositoryCapability"] as const;
      const repositorySlices = this.session.repository.state.snapshot
        ? ["workingTree", "operation"] as const
        : [];
      const invalidation = createSessionInvalidation(
        identity.root,
        identity.generation,
        [...slices, ...repositorySlices],
        "focusRecovery",
      );
      this.pending = mergeSessionInvalidations(this.pending, invalidation);
    }
    const localRecovery = localRecoveryNeeded ? this.drain() : Promise.resolve();
    void localRecovery.then(async () => {
      if (
        this.disposed ||
        this.identity?.root !== identity.root ||
        this.identity.generation !== identity.generation ||
        !this.session.workspace.matches(identity)
      ) return;
      try {
        const remoteReconciled = await this.actions.refreshRemoteAfterFocus();
        if (
          !localRecoveryNeeded ||
          remoteReconciled ||
          !this.session.repository.state.snapshot ||
          this.disposed ||
          !this.session.workspace.matches(identity)
        ) return;
        const fallback = createSessionInvalidation(
          identity.root,
          identity.generation,
          ["head", "refs", "history"],
          "focusRecovery",
        );
        this.pending = mergeSessionInvalidations(this.pending, fallback);
        await this.drain();
      } catch (error) {
        this.actions.reportWarning(this.messages().externalReconcileFailed(errorMessage(error)));
      }
    });
  }

  private current(sequence: number, identity: { root: string; generation: number }): boolean {
    return !this.disposed && sequence === this.activationSequence &&
      this.identity?.root === identity.root && this.identity.generation === identity.generation;
  }

  private messages(): WorkspaceWatchMessages {
    return this.actions.messages?.() ?? DEFAULT_MESSAGES;
  }

  private authorizeBroadRecovery(): number | null {
    const now = this.now();
    this.broadRecoveryTimes = this.broadRecoveryTimes.filter(
      (time) => now - time < BROAD_RECOVERY_WINDOW_MS,
    );
    if (this.broadRecoveryTimes.length >= MAX_BROAD_RECOVERIES_PER_WINDOW) {
      this.watchHealth = "suspended";
      if (!this.suspendedWarningReported) {
        this.suspendedWarningReported = true;
        this.actions.reportWarning(this.messages().watchSuspended());
      }
      return null;
    }
    this.broadRecoveryTimes.push(now);
    this.watchHealth = "degraded";
    return BROAD_RECOVERY_BACKOFF_MS * 2 ** (this.broadRecoveryTimes.length - 1);
  }
}

function isRepositorySlice(slice: RepositoryStateSlice): boolean {
  return slice === "workingTree" || slice === "repositoryCapability" ||
    slice === "head" || slice === "refs" ||
    slice === "history" || slice === "operation";
}

function reconciliationCause(invalidation: SessionInvalidation): SessionInvalidationCause {
  if (
    invalidation.recovery === "backendOverflow" ||
    invalidation.causes.includes("overflowRecovery")
  ) {
    return "overflowRecovery";
  }
  if (invalidation.causes.includes("focusRecovery")) return "focusRecovery";
  return "watcher";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
