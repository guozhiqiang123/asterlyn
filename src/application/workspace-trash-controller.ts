import type {
  WorkspaceMutationOutcome,
  WorkspaceMutationPreview,
} from "../models.ts";
import type {
  WorkspaceMutationExecutionResult,
  WorkspaceMutationIdentity,
  WorkspaceMutationPlanResult,
  WorkspaceMutationReconciliationResult,
} from "./workspace-mutation-coordinator.ts";
import type { WorkspaceEntryIdentity } from "./workbench-navigation.ts";

export interface WorkspaceTrashTarget extends WorkspaceEntryIdentity {
  readonly selectedTargets?: readonly WorkspaceTrashTarget[];
}

export interface WorkspaceTrashState<TTarget extends WorkspaceTrashTarget> {
  readonly planningTarget: TTarget | null;
  readonly dialog: {
    readonly target: TTarget;
    readonly targets?: readonly TTarget[];
    readonly planId: string;
    readonly preview: WorkspaceMutationPreview;
    readonly busy: boolean;
  } | null;
}

export interface WorkspaceTrashMutationPort {
  plan(
    identity: WorkspaceMutationIdentity,
    operation:
      | { readonly kind: "trash"; readonly source: string }
      | { readonly kind: "trash"; readonly sources: string[] },
    collisionPolicy: "cancel",
    editorRequest:
      | { readonly kind: "trash"; readonly sourceWorkspacePath: string }
      | { readonly kind: "trashMany"; readonly sourceWorkspacePaths: readonly string[] },
  ): { planId: string; completion: Promise<WorkspaceMutationPlanResult> };
  execute(
    identity: WorkspaceMutationIdentity,
    planId: string,
    options?: { readonly reconcile?: boolean },
  ): Promise<WorkspaceMutationExecutionResult>;
  reconcile?(
    identity: WorkspaceMutationIdentity,
    outcome: WorkspaceMutationOutcome,
  ): Promise<WorkspaceMutationReconciliationResult>;
  cancel(): void;
}

export interface WorkspaceTrashRuntime<TTarget extends WorkspaceTrashTarget> {
  currentIdentity(): WorkspaceMutationIdentity | null;
  isTargetCurrent(target: TTarget): boolean;
  completed(targets: readonly TTarget[], outcome: WorkspaceMutationOutcome): void;
  reconciliationFailed?(error: unknown): void;
  status(message: string): void;
  error(error: unknown): void;
}

export interface WorkspaceTrashMessages {
  readonly targetChanged: string;
  readonly blocked: string;
  readonly operationFailed: string;
  readonly trashed: string;
  readonly saveBeforeTrash?: string;
}

type Listener = () => void;

export function normalizeTrashTargets<TTarget extends WorkspaceTrashTarget>(
  targets: readonly TTarget[],
): readonly TTarget[] {
  if (targets.length <= 1) return targets;
  const map = new Map<string, TTarget>();
  for (const t of targets) {
    if (!map.has(t.workspacePath)) {
      map.set(t.workspacePath, t);
    }
  }
  const sorted = Array.from(map.values()).sort((a, b) =>
    a.workspacePath.length - b.workspacePath.length || a.workspacePath.localeCompare(b.workspacePath)
  );
  const result: TTarget[] = [];
  for (const target of sorted) {
    const isDescendant = result.some((parent) => {
      const parentPrefix = parent.workspacePath.endsWith("/")
        ? parent.workspacePath
        : `${parent.workspacePath}/`;
      return target.workspacePath.startsWith(parentPrefix);
    });
    if (!isDescendant) {
      result.push(target);
    }
  }
  return result;
}

/** One window-wide reviewed Trash workflow shared by feature-owned context targets. */
export class WorkspaceTrashController<TTarget extends WorkspaceTrashTarget> {
  private value: WorkspaceTrashState<TTarget> = { planningTarget: null, dialog: null };
  private readonly listeners = new Set<Listener>();
  private disposed = false;
  private readonly mutations: WorkspaceTrashMutationPort;
  private readonly runtime: WorkspaceTrashRuntime<TTarget>;
  private readonly messages: () => WorkspaceTrashMessages;

  constructor(
    mutations: WorkspaceTrashMutationPort,
    runtime: WorkspaceTrashRuntime<TTarget>,
    messages: () => WorkspaceTrashMessages,
  ) {
    this.mutations = mutations;
    this.runtime = runtime;
    this.messages = messages;
  }

  get state(): WorkspaceTrashState<TTarget> {
    return this.value;
  }

  get busy(): boolean {
    return this.value.planningTarget !== null || this.value.dialog !== null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(target: TTarget): Promise<void> {
    const identity = this.runtime.currentIdentity();
    if (this.disposed || this.busy || !identity || !this.runtime.isTargetCurrent(target)) return;
    const rawTargets = target.selectedTargets && target.selectedTargets.length > 0
      ? (target.selectedTargets as readonly TTarget[])
      : [target];
    const targets = normalizeTrashTargets(rawTargets);
    if (targets.length === 0 || !targets.every((t) => this.runtime.isTargetCurrent(t))) return;

    this.value = { planningTarget: target, dialog: null };
    this.emit();

    const isMultiple = targets.length > 1;
    const sourceWorkspacePaths = targets.map((t) => t.workspacePath);
    const planned = this.mutations.plan(
      identity,
      isMultiple
        ? { kind: "trash", sources: sourceWorkspacePaths }
        : { kind: "trash", source: targets[0]!.workspacePath },
      "cancel",
      isMultiple
        ? { kind: "trashMany", sourceWorkspacePaths }
        : { kind: "trash", sourceWorkspacePath: targets[0]!.workspacePath },
    );
    const result = await planned.completion;
    if (!this.sameIdentity(identity) || !targets.every((t) => this.runtime.isTargetCurrent(t))) {
      this.mutations.cancel();
      if (this.value.planningTarget === target) {
        this.value = { planningTarget: null, dialog: null };
        this.emit();
      }
      return;
    }
    if (this.value.planningTarget !== target) {
      this.mutations.cancel();
      return;
    }
    if (result.status !== "ready") {
      this.value = { planningTarget: null, dialog: null };
      this.emit();
      this.runtime.error(new Error(planFailure(result, this.messages())));
      return;
    }
    this.value = {
      planningTarget: null,
      dialog: {
        target,
        targets: isMultiple ? targets : undefined,
        planId: planned.planId,
        preview: result.preview,
        busy: false,
      },
    };
    this.emit();
  }

  async confirm(): Promise<void> {
    const dialog = this.value.dialog;
    const identity = this.runtime.currentIdentity();
    if (!dialog || dialog.busy || !identity) return;
    const targets = dialog.targets ?? [dialog.target];
    if (!targets.every((t) => this.runtime.isTargetCurrent(t))) {
      this.mutations.cancel();
      this.value = { planningTarget: null, dialog: null };
      this.emit();
      this.runtime.error(new Error(this.messages().targetChanged));
      return;
    }
    this.value = { ...this.value, dialog: { ...dialog, busy: true } };
    this.emit();
    const reconcileInBackground = this.mutations.reconcile !== undefined;
    const execution = await this.mutations.execute(
      identity,
      dialog.planId,
      reconcileInBackground ? { reconcile: false } : undefined,
    );
    const currentDialog = this.value.dialog;
    if (!currentDialog || currentDialog.planId !== dialog.planId) return;
    const outcome = completedMutationOutcome(execution);
    if (!outcome || execution.status !== "completed") {
      if (outcome && reconcileInBackground) {
        void this.reconcileCompleted(identity, outcome);
        this.runtime.completed(targets, outcome);
      }
      this.value = { planningTarget: null, dialog: null };
      this.emit();
      this.runtime.error(new Error(executionFailure(execution, this.messages())));
      return;
    }
    if (reconcileInBackground) void this.reconcileCompleted(identity, outcome);
    this.runtime.completed(targets, outcome);
    this.value = { planningTarget: null, dialog: null };
    this.emit();
    this.runtime.status(this.messages().trashed);
  }

  close(): void {
    if (!this.value.dialog || this.value.dialog.busy) return;
    this.mutations.cancel();
    this.value = { planningTarget: null, dialog: null };
    this.emit();
  }

  reset(): void {
    if (this.disposed) return;
    this.mutations.cancel();
    this.value = { planningTarget: null, dialog: null };
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mutations.cancel();
    this.value = { planningTarget: null, dialog: null };
    this.listeners.clear();
  }

  private sameIdentity(identity: WorkspaceMutationIdentity): boolean {
    const current = this.runtime.currentIdentity();
    return Boolean(current && current.root === identity.root && current.generation === identity.generation);
  }

  private async reconcileCompleted(
    identity: WorkspaceMutationIdentity,
    outcome: WorkspaceMutationOutcome,
  ): Promise<void> {
    try {
      const result = await this.mutations.reconcile?.(identity, outcome);
      if (result?.status !== "failure") return;
      this.reportReconciliationFailure(result.error);
    } catch (error) {
      this.reportReconciliationFailure(error);
    }
  }

  private reportReconciliationFailure(error: unknown): void {
    if (this.disposed) return;
    if (this.runtime.reconciliationFailed) {
      this.runtime.reconciliationFailed(error);
      return;
    }
    this.runtime.error(error);
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}

function completedMutationOutcome(
  result: WorkspaceMutationExecutionResult,
): WorkspaceMutationOutcome | null {
  return "outcome" in result &&
      (result.outcome.status === "completed" || result.outcome.status === "noOp")
    ? result.outcome
    : null;
}

function planFailure(result: WorkspaceMutationPlanResult, messages: WorkspaceTrashMessages): string {
  if (result.status === "blocked") {
    if (result.source === "editor" && result.reason === "dirtyDelete" && messages.saveBeforeTrash) {
      return messages.saveBeforeTrash;
    }
    return messages.blocked;
  }
  if (result.status === "failure" && result.error instanceof Error) return result.error.message;
  return messages.operationFailed;
}

function executionFailure(
  result: WorkspaceMutationExecutionResult,
  messages: WorkspaceTrashMessages,
): string {
  if ("outcome" in result && result.outcome.error) return result.outcome.error;
  if (result.status === "failure" && result.error instanceof Error) return result.error.message;
  return messages.operationFailed;
}
