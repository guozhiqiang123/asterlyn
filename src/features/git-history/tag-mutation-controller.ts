import type { TagMutationKind, TagMutationRequest } from "../../models.ts";

export interface TagMutationTarget {
  readonly repositoryRoot: string;
  readonly commitOid: string;
  readonly commitSubject: string;
}

export interface TagMutationDialog {
  readonly target: TagMutationTarget;
  readonly kind: TagMutationKind;
  readonly remote: string | null;
  tagName: string;
  busy: boolean;
  error: string | null;
}

export interface TagMutationGateway {
  execute(request: TagMutationRequest): Promise<boolean>;
  errorMessage(error: unknown): string;
}

type Listener = () => void;

export class TagMutationController {
  private readonly gateway: TagMutationGateway;
  private readonly listeners = new Set<Listener>();
  private dialog: TagMutationDialog | null = null;
  private disposed = false;

  constructor(gateway: TagMutationGateway) { this.gateway = gateway; }

  get state(): Readonly<TagMutationDialog> | null { return this.dialog; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  open(
    target: TagMutationTarget,
    kind: TagMutationKind,
    tagName = "",
    remote: string | null = null,
  ): void {
    this.dialog = {
      target: { ...target }, kind, remote,
      tagName, busy: false, error: null,
    };
    this.emit();
  }

  updateTagName(tagName: string): void {
    if (!this.dialog || this.dialog.busy || this.dialog.kind !== "create") return;
    this.dialog.tagName = tagName;
    this.dialog.error = null;
  }

  async submit(): Promise<void> {
    const dialog = this.dialog;
    if (!dialog || dialog.busy) return;
    const tagName = dialog.tagName.trim();
    if (!tagName) {
      dialog.error = "tag-name-required";
      this.emit();
      return;
    }
    dialog.busy = true;
    dialog.error = null;
    this.emit();
    try {
      const succeeded = await this.gateway.execute({
        kind: dialog.kind,
        tagName,
        commitOid: dialog.target.commitOid,
        remote: dialog.remote,
      });
      if (this.dialog !== dialog) return;
      if (succeeded) this.dialog = null;
      else dialog.error = "tag-mutation-failed";
    } catch (error) {
      if (this.dialog === dialog) dialog.error = this.gateway.errorMessage(error);
    } finally {
      if (this.dialog === dialog) dialog.busy = false;
      this.emit();
    }
  }

  close(): boolean {
    if (!this.dialog || this.dialog.busy) return false;
    this.dialog = null;
    this.emit();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.dialog = null;
    this.listeners.clear();
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}
