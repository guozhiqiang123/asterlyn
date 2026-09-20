import { ChangesRestoreReviewController } from "./changes-restore-review-controller.ts";
import {
  renderChangesRestoreReview,
  type ChangesRestoreReviewCopy,
} from "./changes-restore-review-view.ts";

export class ChangesRestoreReviewDialogBinding {
  private readonly root: HTMLElement;
  private readonly controller: ChangesRestoreReviewController;
  private readonly copy: () => ChangesRestoreReviewCopy;
  private readonly release: () => void;
  private focusReturn: HTMLElement | null = null;
  private wasOpen = false;
  private disposed = false;

  constructor(
    root: HTMLElement,
    controller: ChangesRestoreReviewController,
    copy: () => ChangesRestoreReviewCopy,
  ) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.release = controller.subscribe(() => this.render());
  }

  render(): void {
    if (this.disposed) return;
    const host = this.root.querySelector<HTMLElement>("#changes-restore-review-dialog");
    if (!host) return;
    const open = this.controller.state.change !== null;
    if (open && !this.wasOpen) {
      this.focusReturn = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }
    this.wasOpen = open;
    host.classList.toggle("hidden", !open);
    host.innerHTML = renderChangesRestoreReview(this.controller.state, this.copy());
    host.onclick = open ? (event) => {
      if (event.target === host) this.controller.cancel();
    } : null;
    if (!open) {
      this.restoreFocus();
      return;
    }
    host.querySelectorAll<HTMLButtonElement>("[data-changes-restore-close]").forEach(
      (button) => button.addEventListener("click", () => this.controller.cancel()),
    );
    host.querySelector<HTMLButtonElement>("#changes-restore-confirm")?.addEventListener(
      "click",
      () => this.controller.confirm(),
    );
    host.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.controller.cancel();
        return;
      }
      if (event.key === "Tab") trapFocus(host, event);
    };
    queueMicrotask(() => {
      if (!host.contains(document.activeElement)) {
        host.querySelector<HTMLElement>("[data-changes-restore-close]")?.focus();
      }
    });
  }

  refreshCopy(): void {
    if (this.controller.state.change) this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
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
