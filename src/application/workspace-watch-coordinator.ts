import type {
  RepositorySnapshot,
  RepositoryStateSlice,
  WorkspaceWatchInvalidation,
} from "../models.ts";
import type { WorkspaceWatchBridge } from "../protocol/workspace-watch.ts";
import type { EditorSessionController } from "../features/files-editor/editor-session-controller.ts";
import type { ProjectFilesController } from "../features/files-editor/project-files-controller.ts";
import {
  createSessionInvalidation,
  invalidates,
  mergeSessionInvalidations,
  type SessionInvalidation,
  type SessionInvalidationCause,
} from "./session-invalidation.ts";
import type { WindowSession } from "./window-session.ts";

const FOCUS_RECOVERY_AFTER_MS = 5_000;

export interface WorkspaceWatchCoordinatorActions {
  reconcileRepository(
    snapshot: RepositorySnapshot | null,
    slices: RepositoryStateSlice[],
    cause: SessionInvalidationCause,
  ): void;
  refreshRemoteAfterFocus(): Promise<void> | void;
  reportWarning(message: string): void;
  messages?(): WorkspaceWatchMessages;
}

export interface WorkspaceWatchMessages {
  watchUnavailable(detail?: string): string;
  watchStartFailed(detail: string): string;
  externalReconcileFailed(detail: string): string;
}

const DEFAULT_MESSAGES: WorkspaceWatchMessages = {
  watchUnavailable: (detail) => detail ?? "Native file watching is unavailable; focus and manual refresh remain active.",
  watchStartFailed: (detail) => `Native file watching could not start: ${detail}`,
  externalReconcileFailed: (detail) => `External changes could not be reconciled: ${detail}`,
};

export class WorkspaceWatchCoordinator {
  private readonly bridge: WorkspaceWatchBridge;
  private readonly session: WindowSession;
  private readonly files: ProjectFilesController;
  private readonly editor: EditorSessionController;
  private readonly actions: WorkspaceWatchCoordinatorActions;
  private identity: { root: string; generation: number } | null = null;
  private pending: SessionInvalidation | null = null;
  private drainPromise: Promise<void> | null = null;
  private disposed = false;
  private activationSequence = 0;
  private activationQueue: Promise<void> = Promise.resolve();
  private releaseSubscription: (() => void) | null = null;
  private subscription: Promise<void> | null = null;
  private blurredAt: number | null = null;
  private readonly focusController = new AbortController();
  private readonly now: () => number;

  constructor(
    bridge: WorkspaceWatchBridge,
    session: WindowSession,
    files: ProjectFilesController,
    editor: EditorSessionController,
    actions: WorkspaceWatchCoordinatorActions,
    focusTarget: EventTarget | null = typeof window === "undefined" ? null : window,
    now: () => number = () => Date.now(),
  ) {
    this.bridge = bridge;
    this.session = session;
    this.files = files;
    this.editor = editor;
    this.actions = actions;
    this.now = now;
    focusTarget?.addEventListener("blur", () => {
      this.blurredAt = this.now();
    }, { signal: this.focusController.signal });
    focusTarget?.addEventListener("focus", () => this.recoverAfterFocus(), {
      signal: this.focusController.signal,
    });
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
        const status = await this.bridge.start(identity.root, identity.generation);
        if (!this.current(sequence, identity)) {
          await this.bridge.stop().catch(() => undefined);
          return;
        }
        if (this.bridge.native && !status.available) {
          this.actions.reportWarning(this.messages().watchUnavailable(status.message ?? undefined));
        }
      } catch (error) {
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
    this.pending = null;
    this.focusController.abort();
    this.releaseSubscription?.();
    this.releaseSubscription = null;
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
    let invalidation: SessionInvalidation | null = null;
    for (const cause of event.causes) {
      const next = createSessionInvalidation(
        event.root,
        event.generation,
        event.slices,
        cause,
        { paths: event.paths, overflowed: event.overflowed },
      );
      invalidation = mergeSessionInvalidations(invalidation, next);
    }
    if (!invalidation) return;
    this.pending = mergeSessionInvalidations(this.pending, invalidation);
    void this.drain();
  }

  private drain(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.drainPromise) return this.drainPromise;
    const task = this.drainPending().finally(() => {
      if (this.drainPromise === task) this.drainPromise = null;
      if (this.pending && !this.disposed) void this.drain();
    });
    this.drainPromise = task;
    return task;
  }

  private async drainPending(): Promise<void> {
    while (this.pending && !this.disposed) {
      const invalidation = this.pending;
      this.pending = null;
      try {
        await this.reconcile(invalidation);
      } catch (error) {
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
    const cause = reconciliationCause(invalidation);
    if (invalidates(invalidation, "openDocuments")) {
      await this.editor.reconcileExternalPaths(invalidation.paths);
    }
    if (!this.session.workspace.matches(identity)) return;
    if (invalidates(invalidation, "workspaceCatalog")) {
      const refreshed = await this.files.refresh();
      if (refreshed && this.session.workspace.matches(identity)) this.activate();
    }
    if (!this.session.workspace.matches(identity)) return;

    const repositorySlices = invalidation.slices.filter((slice) =>
      slice === "head" || slice === "refs" || slice === "history" || slice === "operation"
    );
    if (repositorySlices.length > 0) {
      const project = await this.session.refreshProject(identity);
      if (!project || !this.session.workspace.matches(identity)) return;
      this.actions.reconcileRepository(project.repository, [...invalidation.slices], cause);
      this.activate();
    }
    if (repositorySlices.length === 0 && invalidates(invalidation, "workingTree")) {
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
    const longAbsence = this.now() - blurredAt >= FOCUS_RECOVERY_AFTER_MS;
    if (longAbsence) {
      const slices = ["workspaceCatalog", "openDocuments"] as const;
      const repositorySlices = this.session.repository.state.snapshot
        ? ["workingTree", "head", "refs", "history", "operation"] as const
        : [];
      const invalidation = createSessionInvalidation(
        identity.root,
        identity.generation,
        [...slices, ...repositorySlices],
        "focusRecovery",
      );
      this.pending = mergeSessionInvalidations(this.pending, invalidation);
    }
    const localRecovery = longAbsence ? this.drain() : Promise.resolve();
    void localRecovery.then(async () => {
      if (
        this.disposed ||
        this.identity?.root !== identity.root ||
        this.identity.generation !== identity.generation ||
        !this.session.workspace.matches(identity)
      ) return;
      try {
        await this.actions.refreshRemoteAfterFocus();
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
}

function reconciliationCause(invalidation: SessionInvalidation): SessionInvalidationCause {
  if (invalidation.overflowed || invalidation.causes.includes("overflowRecovery")) {
    return "overflowRecovery";
  }
  if (invalidation.causes.includes("focusRecovery")) return "focusRecovery";
  return "watcher";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
