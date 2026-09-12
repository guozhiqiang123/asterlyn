import type {
  GitConflictContent,
  GitOperationAction,
  GitOperationKind,
  GitOperationMutationOutcome,
  GitOperationPlan,
  GitOperationSnapshot,
  RepositoryMutationOutcome,
  RepositorySnapshot,
} from "../../models.ts";

export type GitOperationDialog = "setup" | "review" | "conflict" | null;

export interface GitOperationState {
  repositoryRoot: string | null;
  operation: GitOperationSnapshot | null;
  dialog: GitOperationDialog;
  kind: GitOperationKind;
  targetText: string;
  message: string;
  plan: GitOperationPlan | null;
  conflict: GitConflictContent | null;
  conflictResult: string;
  loading: "prepare" | "execute" | "action" | "conflict" | "resolve" | null;
  error: string | null;
}

export interface GitOperationGateway {
  prepareGitOperation(
    repositoryRoot: string,
    kind: GitOperationKind,
    targetRefs: string[],
    message: string | null,
  ): Promise<GitOperationPlan>;
  executeGitOperation(
    repositoryRoot: string,
    plan: GitOperationPlan,
  ): Promise<RepositoryMutationOutcome>;
  runGitOperationAction(
    repositoryRoot: string,
    action: GitOperationAction,
  ): Promise<RepositoryMutationOutcome>;
  readConflictContent(repositoryRoot: string, path: string): Promise<GitConflictContent>;
  resolveConflict(
    repositoryRoot: string,
    path: string,
    expectedRevisionToken: string,
    content: string | null,
  ): Promise<GitOperationMutationOutcome>;
}

export type GitOperationChangeReason =
  | "snapshot"
  | "dialog"
  | "draft"
  | "request-start"
  | "request-complete"
  | "request-error";

export interface GitOperationChange {
  reason: GitOperationChangeReason;
  dialogChanged?: boolean;
  operationChanged?: boolean;
  error?: unknown;
}

export type GitOperationResult =
  | { status: "success"; outcome: RepositoryMutationOutcome | GitOperationMutationOutcome }
  | { status: "failure"; error: unknown }
  | { status: "stale" }
  | { status: "busy" };

type Listener = (change: GitOperationChange) => void;

export class GitOperationController {
  readonly state: GitOperationState = {
    repositoryRoot: null,
    operation: null,
    dialog: null,
    kind: "merge",
    targetText: "",
    message: "",
    plan: null,
    conflict: null,
    conflictResult: "",
    loading: null,
    error: null,
  };

  private readonly gateway: GitOperationGateway;
  private readonly listeners = new Set<Listener>();
  private generation = 0;
  private requestSequence = 0;
  private disposed = false;

  constructor(gateway: GitOperationGateway) {
    this.gateway = gateway;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  installSnapshot(snapshot: RepositorySnapshot | null): void {
    const rootChanged = this.state.repositoryRoot !== snapshot?.root;
    const previous = this.state.operation;
    this.state.repositoryRoot = snapshot?.root ?? null;
    this.state.operation = snapshot?.operation ?? null;
    if (rootChanged) {
      this.generation += 1;
      this.requestSequence += 1;
      this.resetDialog();
    } else if (!this.state.operation && previous && this.state.dialog === "conflict") {
      this.resetDialog();
    } else if (this.state.operation && this.state.conflict) {
      const remains = this.state.operation.conflicts.some(
        (conflict) => conflict.path === this.state.conflict?.path,
      );
      if (!remains) {
        this.state.conflict = null;
        this.state.conflictResult = "";
        if (this.state.dialog === "conflict") this.state.dialog = null;
      }
    }
    this.emit({
      reason: "snapshot",
      operationChanged: previous !== this.state.operation,
      dialogChanged: rootChanged,
    });
  }

  openSetup(
    kind: GitOperationKind = "merge",
    targetRefs: string[] = [],
    message = "",
  ): void {
    if (!this.state.repositoryRoot || this.state.loading) return;
    this.state.kind = kind;
    this.state.targetText = targetRefs.join("\n");
    this.state.message = message;
    this.state.plan = null;
    this.state.error = null;
    this.state.dialog = "setup";
    this.emit({ reason: "dialog", dialogChanged: true });
  }

  closeDialog(): boolean {
    if (this.state.loading === "execute" || this.state.loading === "action" || this.state.loading === "resolve") {
      return false;
    }
    this.resetDialog();
    this.emit({ reason: "dialog", dialogChanged: true });
    return true;
  }

  updateDraft(kind: GitOperationKind, targetText: string, message: string): void {
    this.state.kind = kind;
    this.state.targetText = targetText;
    this.state.message = message;
    this.state.plan = null;
    this.state.error = null;
    this.emit({ reason: "draft" });
  }

  async prepare(): Promise<boolean> {
    const root = this.state.repositoryRoot;
    if (!root || this.state.loading) return false;
    const targets = operationTargets(this.state.targetText);
    const generation = this.generation;
    const request = ++this.requestSequence;
    this.state.loading = "prepare";
    this.state.error = null;
    this.emit({ reason: "request-start", dialogChanged: true });
    try {
      const plan = await this.gateway.prepareGitOperation(
        root,
        this.state.kind,
        targets,
        this.state.kind === "squash" ? this.state.message : null,
      );
      if (!this.matches(generation, request, root)) return false;
      this.state.plan = plan;
      this.state.dialog = "review";
      this.state.loading = null;
      this.emit({ reason: "request-complete", dialogChanged: true });
      return true;
    } catch (error) {
      if (!this.matches(generation, request, root)) return false;
      this.state.loading = null;
      this.state.error = errorMessage(error);
      this.emit({ reason: "request-error", dialogChanged: true, error });
      return false;
    }
  }

  async execute(): Promise<GitOperationResult> {
    const root = this.state.repositoryRoot;
    const plan = this.state.plan;
    if (!root || !plan) return { status: "stale" };
    if (this.state.loading) return { status: "busy" };
    return this.runMutation("execute", root, () => this.gateway.executeGitOperation(root, plan));
  }

  async runAction(action: GitOperationAction): Promise<GitOperationResult> {
    const root = this.state.repositoryRoot;
    if (!root || !this.state.operation?.allowedActions.includes(action)) {
      return { status: "stale" };
    }
    if (this.state.loading) return { status: "busy" };
    return this.runMutation("action", root, () => this.gateway.runGitOperationAction(root, action));
  }

  async openConflict(path: string): Promise<boolean> {
    const root = this.state.repositoryRoot;
    if (!root || this.state.loading) return false;
    if (!this.state.operation?.conflicts.some((conflict) => conflict.path === path)) return false;
    const generation = this.generation;
    const request = ++this.requestSequence;
    this.state.loading = "conflict";
    this.state.error = null;
    this.state.dialog = "conflict";
    this.state.conflict = null;
    this.emit({ reason: "request-start", dialogChanged: true });
    try {
      const conflict = await this.gateway.readConflictContent(root, path);
      if (!this.matches(generation, request, root)) return false;
      this.state.conflict = conflict;
      this.state.conflictResult = conflict.worktree ?? conflict.ours ?? conflict.theirs ?? "";
      this.state.loading = null;
      this.emit({ reason: "request-complete", dialogChanged: true });
      return true;
    } catch (error) {
      if (!this.matches(generation, request, root)) return false;
      this.state.loading = null;
      this.state.error = errorMessage(error);
      this.emit({ reason: "request-error", dialogChanged: true, error });
      return false;
    }
  }

  setConflictResult(value: string): void {
    if (!this.state.conflict || this.state.loading) return;
    this.state.conflictResult = value;
    this.emit({ reason: "draft" });
  }

  async resolveConflict(deleteFile = false): Promise<GitOperationResult> {
    const root = this.state.repositoryRoot;
    const conflict = this.state.conflict;
    if (!root || !conflict) return { status: "stale" };
    if (this.state.loading) return { status: "busy" };
    return this.runMutation("resolve", root, () =>
      this.gateway.resolveConflict(
        root,
        conflict.path,
        conflict.revisionToken,
        deleteFile ? null : this.state.conflictResult,
      ),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.requestSequence += 1;
    this.listeners.clear();
  }

  private async runMutation(
    loading: "execute" | "action" | "resolve",
    root: string,
    task: () => Promise<RepositoryMutationOutcome | GitOperationMutationOutcome>,
  ): Promise<GitOperationResult> {
    const generation = this.generation;
    const request = ++this.requestSequence;
    this.state.loading = loading;
    this.state.error = null;
    this.emit({ reason: "request-start", dialogChanged: true });
    try {
      const outcome = await task();
      if (!this.matches(generation, request, root)) return { status: "stale" };
      this.state.loading = null;
      if (loading === "execute") this.state.dialog = null;
      if (loading === "resolve") {
        this.state.dialog = null;
        this.state.conflict = null;
        this.state.conflictResult = "";
      }
      this.emit({ reason: "request-complete", dialogChanged: true });
      return { status: "success", outcome };
    } catch (error) {
      if (!this.matches(generation, request, root)) return { status: "stale" };
      this.state.loading = null;
      this.state.error = errorMessage(error);
      this.emit({ reason: "request-error", dialogChanged: true, error });
      return { status: "failure", error };
    }
  }

  private matches(generation: number, request: number, root: string): boolean {
    return !this.disposed &&
      this.generation === generation &&
      this.requestSequence === request &&
      this.state.repositoryRoot === root;
  }

  private resetDialog(): void {
    this.state.dialog = null;
    this.state.plan = null;
    this.state.conflict = null;
    this.state.conflictResult = "";
    this.state.loading = null;
    this.state.error = null;
  }

  private emit(change: GitOperationChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}

export function operationTargets(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((target) => target.trim())
    .filter(Boolean);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    if (typeof value.message === "string") return value.message;
  }
  return "The Git operation could not complete.";
}
