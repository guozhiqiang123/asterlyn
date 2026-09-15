import type {
  BranchMutationKind,
  BranchMutationPlan,
  BranchMutationRequest,
} from "../../models.ts";

export interface BranchMutationSource {
  readonly repositoryId: string;
  readonly fullName: string;
  readonly name: string;
  readonly oid: string;
}

export interface BranchMutationDialog {
  readonly repositoryRoot: string;
  readonly source: BranchMutationSource;
  readonly request: BranchMutationRequest;
  value: string;
  plan: BranchMutationPlan | null;
  busy: boolean;
  error: string | null;
}

export interface BranchMutationState {
  readonly dialog: BranchMutationDialog | null;
}

export interface BranchMutationGateway {
  prepare(repositoryRoot: string, request: BranchMutationRequest): Promise<BranchMutationPlan>;
  execute(plan: BranchMutationPlan): Promise<boolean>;
  errorMessage(error: unknown): string;
}

type Listener = () => void;

export class BranchMutationController {
  private readonly gateway: BranchMutationGateway;
  private value: BranchMutationState = { dialog: null };
  private readonly listeners = new Set<Listener>();
  private disposed = false;

  constructor(gateway: BranchMutationGateway) {
    this.gateway = gateway;
  }

  get state(): BranchMutationState {
    return this.value;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  open(
    repositoryRoot: string,
    kind: BranchMutationKind,
    source: BranchMutationSource,
    suggestedName = "",
  ): void {
    const dialog: BranchMutationDialog = {
      repositoryRoot,
      source: { ...source },
      request: {
        kind,
        sourceFullName: source.fullName,
        sourceOid: source.oid,
        newName: mutationNeedsName(kind) ? suggestedName.trim() || null : null,
      },
      value: suggestedName,
      plan: null,
      busy: false,
      error: null,
    };
    this.value = { dialog };
    this.emit();
    if (!mutationNeedsName(kind)) void this.review();
  }

  updateValue(value: string): void {
    const dialog = this.value.dialog;
    if (!dialog || dialog.busy || dialog.plan) return;
    dialog.value = value;
    dialog.error = null;
    this.emit();
  }

  async review(): Promise<void> {
    const dialog = this.value.dialog;
    if (!dialog || dialog.busy) return;
    const name = mutationNeedsName(dialog.request.kind) ? dialog.value.trim() : null;
    if (mutationNeedsName(dialog.request.kind) && !name) {
      dialog.error = "branch-name-required";
      this.emit();
      return;
    }
    dialog.request.newName = name;
    dialog.busy = true;
    dialog.error = null;
    this.emit();
    try {
      const plan = await this.gateway.prepare(dialog.repositoryRoot, dialog.request);
      if (this.value.dialog !== dialog) return;
      dialog.plan = plan;
    } catch (error) {
      if (this.value.dialog !== dialog) return;
      dialog.error = this.gateway.errorMessage(error);
    } finally {
      if (this.value.dialog === dialog) {
        dialog.busy = false;
        this.emit();
      }
    }
  }

  back(): void {
    const dialog = this.value.dialog;
    if (!dialog || dialog.busy || !dialog.plan || !mutationNeedsName(dialog.request.kind)) return;
    dialog.plan = null;
    dialog.error = null;
    this.emit();
  }

  async execute(): Promise<void> {
    const dialog = this.value.dialog;
    if (!dialog || dialog.busy || !dialog.plan) return;
    dialog.busy = true;
    dialog.error = null;
    this.emit();
    try {
      const succeeded = await this.gateway.execute(dialog.plan);
      if (this.value.dialog !== dialog) return;
      if (succeeded) {
        this.value = { dialog: null };
      } else {
        dialog.error = "branch-mutation-failed";
      }
    } catch (error) {
      if (this.value.dialog === dialog) dialog.error = this.gateway.errorMessage(error);
    } finally {
      if (this.value.dialog === dialog) dialog.busy = false;
      this.emit();
    }
  }

  close(): boolean {
    const dialog = this.value.dialog;
    if (!dialog || dialog.busy) return false;
    this.value = { dialog: null };
    this.emit();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.value = { dialog: null };
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}

export function mutationNeedsName(kind: BranchMutationKind): boolean {
  return kind === "create" || kind === "checkoutRemote" || kind === "rename";
}
