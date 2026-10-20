import type { GitResetMode, GitResetPlan, HeadCommitMutationKind } from "../../models.ts";

export type GitResetIntent = "reset" | HeadCommitMutationKind;

export interface GitResetTarget {
  readonly repositoryRoot: string;
  readonly repositoryId: string;
  readonly oid: string;
  readonly shortOid: string;
  readonly subject: string;
}

export interface GitResetDialog {
  readonly target: GitResetTarget;
  readonly intent: GitResetIntent;
  plan: GitResetPlan | null;
  mode: GitResetMode;
  busy: boolean;
  error: string | null;
}

export interface GitResetGateway {
  prepare(repositoryRoot: string, repositoryId: string, targetOid: string, intent: GitResetIntent): Promise<GitResetPlan>;
  execute(repositoryId: string, plan: GitResetPlan, mode: GitResetMode, intent: GitResetIntent): Promise<boolean>;
  errorMessage(error: unknown): string;
}

type Listener = () => void;

export class GitResetController {
  private readonly gateway: GitResetGateway;
  private dialog: GitResetDialog | null = null;
  private readonly listeners = new Set<Listener>();
  private disposed = false;

  constructor(gateway: GitResetGateway) { this.gateway = gateway; }
  get state(): { readonly dialog: GitResetDialog | null } { return { dialog: this.dialog }; }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  open(target: GitResetTarget, intent: GitResetIntent = "reset"): void {
    const mode = intent === "dropCommit" ? "hard" : "mixed";
    const dialog: GitResetDialog = { target: { ...target }, intent, plan: null, mode, busy: true, error: null };
    this.dialog = dialog; this.emit();
    void this.gateway.prepare(target.repositoryRoot, target.repositoryId, target.oid, intent).then((plan) => {
      if (this.dialog === dialog) { dialog.plan = plan; dialog.busy = false; this.emit(); }
    }).catch((error) => {
      if (this.dialog === dialog) { dialog.error = this.gateway.errorMessage(error); dialog.busy = false; this.emit(); }
    });
  }

  selectMode(mode: GitResetMode): void {
    if (!this.dialog || this.dialog.busy || this.dialog.intent !== "reset") return;
    this.dialog.mode = mode; this.emit();
  }

  async execute(): Promise<void> {
    const dialog = this.dialog;
    if (!dialog?.plan || dialog.busy) return;
    dialog.busy = true; dialog.error = null; this.emit();
    try {
      if (await this.gateway.execute(dialog.target.repositoryId, dialog.plan, dialog.mode, dialog.intent)) this.dialog = null;
      else dialog.error = "reset-failed";
    } catch (error) {
      if (this.dialog === dialog) dialog.error = this.gateway.errorMessage(error);
    } finally {
      if (this.dialog === dialog) dialog.busy = false;
      this.emit();
    }
  }

  close(): boolean { if (this.dialog?.busy) return false; this.dialog = null; this.emit(); return true; }
  dispose(): void { this.disposed = true; this.listeners.clear(); this.dialog = null; }
  private emit(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
}
