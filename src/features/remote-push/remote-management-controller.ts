import type {
  RemoteMutationPlan,
  RemoteMutationRequest,
  RemoteSummary,
  RepositorySnapshot,
} from "../../models.ts";

export interface RemoteManagementGateway {
  snapshot(): RepositorySnapshot | null;
  prepare(repositoryRoot: string, request: RemoteMutationRequest): Promise<RemoteMutationPlan>;
  execute(plan: RemoteMutationPlan): Promise<boolean>;
  fetch(repositoryRoot: string, remote: string): Promise<boolean>;
  errorMessage(error: unknown): string;
}

export type RemoteManagementDialog =
  | { readonly kind: "list"; readonly repositoryRoot: string; remotes: RemoteSummary[]; selected: string | null; busy: boolean; error: string | null }
  | { readonly kind: "define"; readonly repositoryRoot: string; readonly sourceName: string | null; name: string; url: string; fetch: boolean; busy: boolean; error: string | null }
  | { readonly kind: "delete"; readonly repositoryRoot: string; readonly remote: RemoteSummary; busy: boolean; error: string | null };

export interface RemoteManagementState { readonly dialog: RemoteManagementDialog | null }
type Listener = () => void;

export class RemoteManagementController {
  private readonly gateway: RemoteManagementGateway;
  private value: RemoteManagementState = { dialog: null };
  private readonly listeners = new Set<Listener>();
  private disposed = false;

  constructor(gateway: RemoteManagementGateway) { this.gateway = gateway; }

  get state(): RemoteManagementState { return this.value; }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  open(): boolean {
    const snapshot = this.gateway.snapshot();
    if (!snapshot) return false;
    this.value = { dialog: listDialog(snapshot) };
    this.emit();
    return true;
  }

  select(name: string): void {
    const dialog = this.value.dialog;
    if (dialog?.kind !== "list" || dialog.busy || !dialog.remotes.some((remote) => remote.name === name)) return;
    dialog.selected = name;
    this.emit();
  }

  add(): void {
    const dialog = this.value.dialog;
    if (dialog?.kind !== "list" || dialog.busy) return;
    this.value = { dialog: { kind: "define", repositoryRoot: dialog.repositoryRoot, sourceName: null, name: "", url: "", fetch: true, busy: false, error: null } };
    this.emit();
  }

  edit(): void {
    const dialog = this.value.dialog;
    if (dialog?.kind !== "list" || dialog.busy || !dialog.selected) return;
    const remote = dialog.remotes.find((candidate) => candidate.name === dialog.selected);
    if (!remote) return;
    this.value = { dialog: { kind: "define", repositoryRoot: dialog.repositoryRoot, sourceName: remote.name, name: remote.name, url: remote.url ?? "", fetch: false, busy: false, error: null } };
    this.emit();
  }

  requestDelete(): void {
    const dialog = this.value.dialog;
    if (dialog?.kind !== "list" || dialog.busy || !dialog.selected) return;
    const remote = dialog.remotes.find((candidate) => candidate.name === dialog.selected);
    if (!remote) return;
    this.value = { dialog: { kind: "delete", repositoryRoot: dialog.repositoryRoot, remote: { ...remote }, busy: false, error: null } };
    this.emit();
  }

  update(field: "name" | "url" | "fetch", value: string | boolean): void {
    const dialog = this.value.dialog;
    if (dialog?.kind !== "define" || dialog.busy) return;
    if (field === "fetch") dialog.fetch = Boolean(value);
    else dialog[field] = String(value);
    dialog.error = null;
  }

  async save(): Promise<void> {
    const dialog = this.value.dialog;
    if (dialog?.kind !== "define" || dialog.busy) return;
    const name = dialog.name.trim();
    const url = dialog.url.trim();
    if (!name || !url) { dialog.error = "fields-required"; this.emit(); return; }
    dialog.busy = true; dialog.error = null; this.emit();
    try {
      const plan = await this.gateway.prepare(dialog.repositoryRoot, {
        kind: dialog.sourceName ? "edit" : "add", sourceName: dialog.sourceName, name, url,
      });
      if (this.value.dialog !== dialog) return;
      if (!(await this.gateway.execute(plan))) { dialog.error = "mutation-failed"; return; }
      if (dialog.fetch) await this.gateway.fetch(dialog.repositoryRoot, plan.targetName);
      this.open();
    } catch (error) {
      if (this.value.dialog === dialog) dialog.error = this.gateway.errorMessage(error);
    } finally {
      if (this.value.dialog === dialog) dialog.busy = false;
      this.emit();
    }
  }

  async delete(): Promise<void> {
    const dialog = this.value.dialog;
    if (dialog?.kind !== "delete" || dialog.busy) return;
    dialog.busy = true; dialog.error = null; this.emit();
    try {
      const plan = await this.gateway.prepare(dialog.repositoryRoot, {
        kind: "delete", sourceName: dialog.remote.name, name: dialog.remote.name, url: null,
      });
      if (this.value.dialog !== dialog) return;
      if (await this.gateway.execute(plan)) this.open();
      else dialog.error = "mutation-failed";
    } catch (error) {
      if (this.value.dialog === dialog) dialog.error = this.gateway.errorMessage(error);
    } finally {
      if (this.value.dialog === dialog) dialog.busy = false;
      this.emit();
    }
  }

  back(): void {
    const dialog = this.value.dialog;
    if (!dialog || dialog.busy) return;
    const snapshot = this.gateway.snapshot();
    this.value = { dialog: snapshot ? listDialog(snapshot) : null };
    this.emit();
  }

  close(): boolean {
    if (this.value.dialog?.busy) return false;
    this.value = { dialog: null }; this.emit(); return true;
  }

  dispose(): void { this.disposed = true; this.listeners.clear(); this.value = { dialog: null }; }
  private emit(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
}

function listDialog(snapshot: RepositorySnapshot): Extract<RemoteManagementDialog, { kind: "list" }> {
  const remotes = snapshot.remotes.map((remote) => ({ ...remote }));
  return { kind: "list", repositoryRoot: snapshot.root, remotes, selected: remotes[0]?.name ?? null, busy: false, error: null };
}
