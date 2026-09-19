import type { HistoryCommitFileContextMenuCopy } from "../../localization/catalog.ts";
import { CommitFileRestoreController } from "./commit-file-restore-controller.ts";
import { renderCommitFileRestoreDialog } from "./commit-file-restore-view.ts";

export class CommitFileRestoreDialogBinding {
  private readonly root: HTMLElement;
  private readonly controller: CommitFileRestoreController;
  private readonly copy: () => HistoryCommitFileContextMenuCopy;
  private readonly changed: (() => void) | undefined;
  private readonly release: () => void;
  private focusReturn: HTMLElement | null = null;
  private wasOpen = false;
  private disposed = false;

  constructor(
    root: HTMLElement,
    controller: CommitFileRestoreController,
    copy: () => HistoryCommitFileContextMenuCopy,
    changed?: () => void,
  ) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.changed = changed;
    this.release = controller.subscribe(() => {
      this.render();
      this.changed?.();
    });
  }

  render(): void {
    if (this.disposed) return;
    const host = this.root.querySelector<HTMLElement>("#commit-file-restore-dialog");
    if (!host) return;
    const open = this.controller.state.dialog !== null;
    if (open && !this.wasOpen) {
      this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.wasOpen = open;
    host.classList.toggle("hidden", !open);
    host.innerHTML = renderCommitFileRestoreDialog(this.controller.state, this.copy());
    host.onclick = open ? (event) => {
      if (event.target === host) this.controller.close();
    } : null;
    if (!open) {
      this.restoreFocus();
      return;
    }
    host.querySelectorAll<HTMLButtonElement>("[data-commit-file-restore-close]").forEach((button) =>
      button.addEventListener("click", () => this.controller.close())
    );
    host.querySelector<HTMLButtonElement>("#commit-file-restore-execute")?.addEventListener(
      "click",
      () => void this.controller.execute(),
    );
    host.querySelectorAll<HTMLButtonElement>("[data-commit-file-recovery]").forEach((button) =>
      button.addEventListener("click", () => {
        const recoveryId = button.dataset.recoveryId;
        const action = button.dataset.commitFileRecovery;
        if (recoveryId && (action === "rollback" || action === "finalize")) {
          void this.controller.resolveRecovery(recoveryId, action);
        }
      })
    );
    host.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.controller.close();
      } else if (event.key === "Tab") {
        trapFocus(host, event);
      }
    };
    queueMicrotask(() => {
      if (!host.contains(document.activeElement)) {
        host.querySelector<HTMLElement>("button:not([disabled])")?.focus();
      }
    });
  }

  refreshCopy(): void {
    if (this.controller.state.dialog) this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.release();
    this.focusReturn = null;
  }

  private restoreFocus(): void {
    const target = this.focusReturn;
    this.focusReturn = null;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
      else this.root.querySelector<HTMLElement>("#git-detail-body")?.focus();
    });
  }
}

function trapFocus(host: HTMLElement, event: KeyboardEvent): void {
  const focusable = Array.from(host.querySelectorAll<HTMLElement>("button:not([disabled])"));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
