import {
  WorkspaceTrashController,
  type WorkspaceTrashTarget,
} from "../../application/workspace-trash-controller.ts";
import {
  renderWorkspaceTrashDialog,
  type WorkspaceTrashDialogCopy,
} from "./workspace-trash-dialog-view.ts";

export class WorkspaceTrashDialogBinding<TTarget extends WorkspaceTrashTarget> {
  private readonly root: HTMLElement;
  private readonly controller: WorkspaceTrashController<TTarget>;
  private readonly copy: () => WorkspaceTrashDialogCopy;
  private readonly focusTarget: (target: TTarget) => HTMLElement | null;
  private focusReturn: HTMLElement | null = null;
  private dialogWasOpen = false;
  private disposed = false;

  constructor(
    root: HTMLElement,
    controller: WorkspaceTrashController<TTarget>,
    copy: () => WorkspaceTrashDialogCopy,
    focusTarget: (target: TTarget) => HTMLElement | null,
  ) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.focusTarget = focusTarget;
  }

  render(): void {
    if (this.disposed) return;
    const host = this.root.querySelector<HTMLElement>("#workspace-trash-operation-dialog");
    if (!host) return;
    const dialog = this.controller.state.dialog;
    const open = dialog !== null;
    if (dialog && !this.dialogWasOpen) {
      this.focusReturn = this.focusTarget(dialog.target) ?? (
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      );
    }
    this.dialogWasOpen = open;
    host.classList.toggle("hidden", !open);
    host.innerHTML = renderWorkspaceTrashDialog(this.controller.state, this.copy());
    host.onclick = open ? (event) => {
      if (event.target === host) this.controller.close();
    } : null;
    if (!open) {
      this.restoreFocus();
      return;
    }
    host.querySelectorAll<HTMLButtonElement>("[data-workspace-trash-close]").forEach(
      (button) => button.addEventListener("click", () => this.controller.close()),
    );
    host.querySelector<HTMLButtonElement>("#workspace-trash-confirm")?.addEventListener(
      "click",
      () => void this.controller.confirm(),
    );
    host.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.controller.close();
        return;
      }
      if (event.key === "Tab") trapFocus(host, event);
    };
    queueMicrotask(() => {
      if (!host.contains(document.activeElement)) {
        host.querySelector<HTMLElement>("button:not([disabled])")?.focus();
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.focusReturn = null;
  }

  private restoreFocus(): void {
    const target = this.focusReturn;
    this.focusReturn = null;
    if (!target) return;
    queueMicrotask(() => {
      if (target.isConnected) target.focus();
      else this.root.querySelector<HTMLElement>("#navigator-body")?.focus();
    });
  }
}

function trapFocus(host: HTMLElement, event: KeyboardEvent): void {
  const focusable = Array.from(host.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [tabindex="0"]',
  ));
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
