import type { FileChange } from "../../models.ts";

export interface ChangesRestoreReviewState {
  readonly change: FileChange | null;
}

type Listener = () => void;

/** Owns the explicit user authorization boundary before a destructive working-tree restore. */
export class ChangesRestoreReviewController {
  private value: ChangesRestoreReviewState = { change: null };
  private readonly listeners = new Set<Listener>();
  private resolve: ((confirmed: boolean) => void) | null = null;
  private disposed = false;

  get state(): ChangesRestoreReviewState {
    return this.value;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(change: FileChange): Promise<boolean> {
    if (this.disposed || this.resolve) return Promise.resolve(false);
    this.value = { change: { ...change } };
    this.emit();
    return new Promise<boolean>((resolve) => {
      this.resolve = resolve;
    });
  }

  confirm(): void {
    this.settle(true);
  }

  cancel(): void {
    this.settle(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.settle(false);
    this.listeners.clear();
  }

  private settle(confirmed: boolean): void {
    const resolve = this.resolve;
    if (!resolve) return;
    this.resolve = null;
    this.value = { change: null };
    this.emit();
    resolve(confirmed);
  }

  private emit(): void {
    if (this.disposed && !this.resolve) return;
    for (const listener of this.listeners) listener();
  }
}
