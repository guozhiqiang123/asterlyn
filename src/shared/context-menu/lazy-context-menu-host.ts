import type {
  ContextMenuAnchor,
  ContextMenuPort,
  ContextMenuSession,
} from "./context-menu-model.ts";
import type { ContextMenuHost } from "./context-menu-host.ts";

/** Starts loading the per-window host without placing its implementation in the startup chunk. */
export class LazyContextMenuHost implements ContextMenuPort {
  private delegate: ContextMenuHost | null = null;
  private pending: { anchor: ContextMenuAnchor; session: ContextMenuSession } | null = null;
  private disposed = false;

  constructor(document: Document, window: Window) {
    void import("./context-menu-host.ts")
      .then(({ ContextMenuHost }) => {
        if (this.disposed) return;
        this.delegate = new ContextMenuHost(document, window);
        const pending = this.pending;
        this.pending = null;
        if (pending?.session.isCurrent()) {
          this.delegate.open(pending.anchor, pending.session);
        } else {
          pending?.session.dismissed?.();
        }
      })
      .catch((error) => {
        this.pending?.session.dismissed?.();
        this.pending = null;
        console.error(error);
      });
  }

  open(anchor: ContextMenuAnchor, session: ContextMenuSession): void {
    if (this.disposed || !session.isCurrent()) {
      session.dismissed?.();
      return;
    }
    if (this.delegate) {
      this.delegate.open(anchor, session);
      return;
    }
    this.pending?.session.dismissed?.();
    this.pending = { anchor, session };
  }

  close(ownerId?: string): void {
    if (!ownerId || this.pending?.session.ownerId === ownerId) {
      this.pending?.session.dismissed?.();
      this.pending = null;
    }
    this.delegate?.close(ownerId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending?.session.dismissed?.();
    this.pending = null;
    this.delegate?.dispose();
    this.delegate = null;
  }
}
