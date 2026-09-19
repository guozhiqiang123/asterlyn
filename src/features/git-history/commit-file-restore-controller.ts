import type {
  CommitFileChange,
  CommitFileRestorePreview,
  FileRestoreApplyResult,
  FileRestoreRecoverySummary,
} from "../../models.ts";
import type { CommitDetailFileContextTarget } from "./commit-detail-context-binding.ts";

export interface CommitFileRestoreLease {
  current(): boolean;
}

export interface CommitFileRestoreGateway {
  prepare(
    repositoryRoot: string,
    planId: string,
    repositoryId: string,
    commitOid: string,
    selected: CommitFileChange,
  ): Promise<CommitFileRestorePreview>;
  execute(repositoryRoot: string, planId: string): Promise<FileRestoreApplyResult>;
  listRecoveries(repositoryRoot: string): Promise<FileRestoreRecoverySummary[]>;
  rollback(repositoryRoot: string, recoveryId: string): Promise<FileRestoreApplyResult>;
  finalize(repositoryRoot: string, recoveryId: string): Promise<void>;
  refresh(repositoryRoot: string, workspacePath: string): Promise<void>;
  lease(workspacePath: string): CommitFileRestoreLease | null;
  errorMessage(error: unknown): string;
}

export type CommitFileRestorePhase =
  | "preparing"
  | "review"
  | "executing"
  | "applied"
  | "recovery";

export interface CommitFileRestoreDialog {
  readonly repositoryRoot: string;
  readonly workspacePath: string | null;
  readonly planId: string | null;
  readonly selected: CommitFileChange | null;
  readonly lease: CommitFileRestoreLease | null;
  phase: CommitFileRestorePhase;
  preview: CommitFileRestorePreview | null;
  outcome: FileRestoreApplyResult | null;
  recoveries: FileRestoreRecoverySummary[];
  busyRecoveryId: string | null;
  error: string | null;
}

export interface CommitFileRestoreState {
  readonly dialog: CommitFileRestoreDialog | null;
}

type Listener = () => void;

export class CommitFileRestoreController {
  private readonly gateway: CommitFileRestoreGateway;
  private readonly listeners = new Set<Listener>();
  private value: CommitFileRestoreState = { dialog: null };
  private sequence = 0;
  private request = 0;
  private disposed = false;

  constructor(gateway: CommitFileRestoreGateway) {
    this.gateway = gateway;
  }

  get state(): CommitFileRestoreState {
    return this.value;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async open(
    target: CommitDetailFileContextTarget,
    lease: CommitFileRestoreLease,
  ): Promise<void> {
    if (this.disposed) return;
    const request = ++this.request;
    const planId = `commit-file-restore-${Date.now()}-${++this.sequence}`;
    const dialog: CommitFileRestoreDialog = {
      repositoryRoot: target.workspaceRoot,
      workspacePath: target.workspacePath,
      planId,
      selected: { ...target.file },
      lease,
      phase: "preparing",
      preview: null,
      outcome: null,
      recoveries: [],
      busyRecoveryId: null,
      error: null,
    };
    this.value = { dialog };
    this.emit();
    try {
      const preview = await this.gateway.prepare(
        target.workspaceRoot,
        planId,
        target.repositoryId,
        target.oid,
        target.file,
      );
      if (!this.current(request, dialog)) return;
      if (
        preview.planId !== planId ||
        preview.workspacePath !== target.workspacePath ||
        preview.repositoryId !== target.repositoryId ||
        preview.commitOid !== target.oid
      ) throw new Error("The historical-file restore preview did not match its request");
      dialog.preview = structuredClone(preview);
      dialog.phase = "review";
    } catch (error) {
      if (!this.current(request, dialog)) return;
      dialog.phase = "review";
      dialog.error = this.gateway.errorMessage(error);
    }
    this.emit();
  }

  async execute(): Promise<void> {
    const dialog = this.value.dialog;
    if (!dialog || dialog.phase !== "review" || !dialog.preview || !dialog.planId) return;
    if (!dialog.lease?.current()) {
      dialog.error = "editor-changed";
      this.emit();
      return;
    }
    dialog.phase = "executing";
    dialog.error = null;
    this.emit();
    let result: FileRestoreApplyResult;
    try {
      result = await this.gateway.execute(dialog.repositoryRoot, dialog.planId);
      if (this.value.dialog !== dialog) return;
      if (result.workspacePath !== dialog.preview.workspacePath) {
        throw new Error("The historical-file restore result did not match its preview");
      }
    } catch (error) {
      if (this.value.dialog === dialog) {
        dialog.phase = "review";
        dialog.error = this.gateway.errorMessage(error);
        await this.refreshRecoveries(dialog);
      }
      if (this.value.dialog === dialog) this.emit();
      return;
    }
    dialog.outcome = structuredClone(result);
    dialog.phase = "applied";
    try {
      await this.gateway.refresh(dialog.repositoryRoot, result.workspacePath);
    } catch (error) {
      if (this.value.dialog === dialog) dialog.error = this.gateway.errorMessage(error);
    }
    await this.refreshRecoveries(dialog);
    if (this.value.dialog === dialog) this.emit();
  }

  async loadRecoveries(repositoryRoot: string, openWhenPresent: boolean): Promise<void> {
    const request = ++this.request;
    try {
      const recoveries = await this.gateway.listRecoveries(repositoryRoot);
      if (this.disposed || request !== this.request) return;
      if (recoveries.length === 0) return;
      const dialog = this.value.dialog;
      if (dialog?.repositoryRoot === repositoryRoot) {
        dialog.recoveries = structuredClone(recoveries);
        this.emit();
      } else if (openWhenPresent) {
        this.value = {
          dialog: {
            repositoryRoot,
            workspacePath: null,
            planId: null,
            selected: null,
            lease: null,
            phase: "recovery",
            preview: null,
            outcome: null,
            recoveries: structuredClone(recoveries),
            busyRecoveryId: null,
            error: null,
          },
        };
        this.emit();
      }
    } catch {
      // Recovery discovery is retried on the next project activation or restore operation.
    }
  }

  async resolveRecovery(recoveryId: string, action: "rollback" | "finalize"): Promise<void> {
    const dialog = this.value.dialog;
    const recovery = dialog?.recoveries.find((candidate) => candidate.recoveryId === recoveryId);
    if (!dialog || !recovery || dialog.busyRecoveryId) return;
    const lease = action === "rollback" ? this.gateway.lease(recovery.workspacePath) : null;
    if (action === "rollback" && (!lease || !lease.current())) {
      dialog.error = "editor-changed";
      this.emit();
      return;
    }
    dialog.busyRecoveryId = recoveryId;
    dialog.error = null;
    this.emit();
    try {
      if (action === "rollback") {
        await this.gateway.rollback(dialog.repositoryRoot, recoveryId);
        await this.gateway.refresh(dialog.repositoryRoot, recovery.workspacePath);
      } else {
        await this.gateway.finalize(dialog.repositoryRoot, recoveryId);
      }
      await this.refreshRecoveries(dialog);
      if (dialog.recoveries.length === 0) this.value = { dialog: null };
    } catch (error) {
      if (this.value.dialog === dialog) dialog.error = this.gateway.errorMessage(error);
    } finally {
      if (this.value.dialog === dialog) dialog.busyRecoveryId = null;
      this.emit();
    }
  }

  isExecuting(workspacePath: string): boolean {
    const dialog = this.value.dialog;
    return dialog?.workspacePath === workspacePath && dialog.phase === "executing";
  }

  close(): boolean {
    const dialog = this.value.dialog;
    if (!dialog || dialog.phase === "preparing" || dialog.phase === "executing" || dialog.busyRecoveryId) {
      return false;
    }
    this.request += 1;
    this.value = { dialog: null };
    this.emit();
    return true;
  }

  reset(): void {
    if (this.disposed) return;
    this.request += 1;
    this.value = { dialog: null };
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.request += 1;
    this.value = { dialog: null };
    this.listeners.clear();
  }

  private async refreshRecoveries(dialog: CommitFileRestoreDialog): Promise<void> {
    try {
      dialog.recoveries = await this.gateway.listRecoveries(dialog.repositoryRoot);
    } catch {
      // Preserve the primary operation error; recovery discovery will retry later.
    }
  }

  private current(request: number, dialog: CommitFileRestoreDialog): boolean {
    return !this.disposed && request === this.request && this.value.dialog === dialog;
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}
