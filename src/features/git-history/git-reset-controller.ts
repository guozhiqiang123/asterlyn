import type { GitResetMode, GitResetPlan } from "../../models.ts";

export interface GitResetTarget {
  readonly repositoryRoot: string;
  readonly oid: string;
  readonly shortOid: string;
  readonly subject: string;
}

export interface GitResetDialog {
  readonly target: GitResetTarget;
  plan: GitResetPlan | null;
  mode: GitResetMode;
  busy: boolean;
  error: string | null;
}

export interface GitResetGateway {
  prepare(repositoryRoot: string, targetOid: string): Promise<GitResetPlan>;
  execute(plan: GitResetPlan, mode: GitResetMode): Promise<boolean>;
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

  open(target: GitResetTarget): void {
    const dialog: GitResetDialog = { target: { ...target }, plan: null, mode: "mixed", busy: true, error: null };
    this.dialog = dialog; this.emit();
    void this.gateway.prepare(target.repositoryRoot, target.oid).then((plan) => {
      if (this.dialog === dialog) { dialog.plan = plan; dialog.busy = false; this.emit(); }
    }).catch((error) => {
      if (this.dialog === dialog) { dialog.error = this.gateway.errorMessage(error); dialog.busy = false; this.emit(); }
    });
  }

  selectMode(mode: GitResetMode): void {
    if (!this.dialog || this.dialog.busy) return;
    this.dialog.mode = mode; this.emit();
  }

  async execute(): Promise<void> {
    const dialog = this.dialog;
    if (!dialog?.plan || dialog.busy) return;
    dialog.busy = true; dialog.error = null; this.emit();
    try {
      if (await this.gateway.execute(dialog.plan, dialog.mode)) this.dialog = null;
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
