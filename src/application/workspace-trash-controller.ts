import type {
  WorkspaceMutationOutcome,
  WorkspaceMutationPreview,
} from "../models.ts";
import type {
  WorkspaceMutationExecutionResult,
  WorkspaceMutationIdentity,
  WorkspaceMutationPlanResult,
} from "./workspace-mutation-coordinator.ts";
import type { WorkspaceEntryIdentity } from "./workbench-navigation.ts";

export interface WorkspaceTrashTarget extends WorkspaceEntryIdentity {}

export interface WorkspaceTrashState<TTarget extends WorkspaceTrashTarget> {
  readonly planningTarget: TTarget | null;
  readonly dialog: {
    readonly target: TTarget;
    readonly planId: string;
    readonly preview: WorkspaceMutationPreview;
    readonly busy: boolean;
  } | null;
}

export interface WorkspaceTrashMutationPort {
  plan(
    identity: WorkspaceMutationIdentity,
    operation: { readonly kind: "trash"; readonly source: string },
    collisionPolicy: "cancel",
    editorRequest: { readonly kind: "trash"; readonly sourceWorkspacePath: string },
  ): { planId: string; completion: Promise<WorkspaceMutationPlanResult> };
  execute(
    identity: WorkspaceMutationIdentity,
    planId: string,
  ): Promise<WorkspaceMutationExecutionResult>;
  cancel(): void;
}

export interface WorkspaceTrashRuntime<TTarget extends WorkspaceTrashTarget> {
  currentIdentity(): WorkspaceMutationIdentity | null;
  isTargetCurrent(target: TTarget): boolean;
  completed(target: TTarget, outcome: WorkspaceMutationOutcome): void;
  status(message: string): void;
  error(error: unknown): void;
}

export interface WorkspaceTrashMessages {
  readonly targetChanged: string;
  readonly operationFailed: string;
  readonly trashed: string;
}

type Listener = () => void;

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
    this.value = { planningTarget: target, dialog: null };
    this.emit();
    const planned = this.mutations.plan(
      identity,
      { kind: "trash", source: target.workspacePath },
      "cancel",
      { kind: "trash", sourceWorkspacePath: target.workspacePath },
    );
    const result = await planned.completion;
    if (!this.sameIdentity(identity) || !this.runtime.isTargetCurrent(target)) {
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
      dialog: { target, planId: planned.planId, preview: result.preview, busy: false },
    };
    this.emit();
  }

  async confirm(): Promise<void> {
    const dialog = this.value.dialog;
    const identity = this.runtime.currentIdentity();
    if (!dialog || dialog.busy || !identity) return;
    if (!this.runtime.isTargetCurrent(dialog.target)) {
      this.mutations.cancel();
      this.value = { planningTarget: null, dialog: null };
      this.emit();
      this.runtime.error(new Error(this.messages().targetChanged));
      return;
    }
    this.value = { ...this.value, dialog: { ...dialog, busy: true } };
    this.emit();
    const execution = await this.mutations.execute(identity, dialog.planId);
    const currentDialog = this.value.dialog;
    if (!currentDialog || currentDialog.planId !== dialog.planId) return;
    const outcome = completedOutcome(execution);
    this.value = { planningTarget: null, dialog: null };
    this.emit();
    if (!outcome) {
      this.runtime.error(new Error(executionFailure(execution, this.messages())));
      return;
    }
    this.runtime.completed(dialog.target, outcome);
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

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}

function completedOutcome(result: WorkspaceMutationExecutionResult): WorkspaceMutationOutcome | null {
  return result.status === "completed" &&
      (result.outcome.status === "completed" || result.outcome.status === "noOp")
    ? result.outcome
    : null;
}

function planFailure(result: WorkspaceMutationPlanResult, messages: WorkspaceTrashMessages): string {
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
