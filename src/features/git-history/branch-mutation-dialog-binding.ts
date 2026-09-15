import type { BranchMutationCopy } from "../../localization/catalog.ts";
import { BranchMutationController } from "./branch-mutation-controller.ts";
import { renderBranchMutationDialog } from "./branch-mutation-view.ts";

export class BranchMutationDialogBinding {
  private readonly root: HTMLElement;
  private readonly controller: BranchMutationController;
  private readonly copy: () => BranchMutationCopy;
  private readonly release: () => void;
  private focusReturn: HTMLElement | null = null;
  private dialogWasOpen = false;
  private disposed = false;

  constructor(
    root: HTMLElement,
    controller: BranchMutationController,
    copy: () => BranchMutationCopy,
  ) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.release = controller.subscribe(() => this.render());
  }

  render(): void {
    if (this.disposed) return;
    const host = this.root.querySelector<HTMLElement>("#branch-mutation-dialog");
    if (!host) return;
    const open = this.controller.state.dialog !== null;
    if (open && !this.dialogWasOpen) {
      this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.dialogWasOpen = open;
    host.classList.toggle("hidden", !open);
    host.innerHTML = renderBranchMutationDialog(this.controller.state, this.copy());
    host.onclick = open ? (event) => {
      if (event.target === host) this.controller.close();
    } : null;
    if (!open) {
      this.restoreFocus();
      return;
    }
    host.querySelectorAll<HTMLButtonElement>("[data-branch-mutation-close]").forEach((button) =>
      button.addEventListener("click", () => this.controller.close())
    );
    host.querySelector<HTMLInputElement>("#branch-mutation-name")?.addEventListener("input", (event) => {
      this.controller.updateValue((event.currentTarget as HTMLInputElement).value);
    });
    host.querySelector<HTMLFormElement>("#branch-mutation-review-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.controller.review();
    });
    host.querySelector<HTMLButtonElement>("[data-branch-mutation-back]")?.addEventListener(
      "click", () => this.controller.back(),
    );
    host.querySelector<HTMLButtonElement>("#branch-mutation-execute")?.addEventListener(
      "click", () => void this.controller.execute(),
    );
    host.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.controller.close();
      } else if (event.key === "Tab") {
        trapFocus(host, event);
      }
    };
    queueMicrotask(() => {
      if (!host.contains(document.activeElement)) {
        (host.querySelector<HTMLInputElement>("#branch-mutation-name") ??
          host.querySelector<HTMLElement>("button:not([disabled])"))?.focus();
      }
    });
  }

  refreshCopy(): void {
    if (this.controller.state.dialog) this.render();
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
      else this.root.querySelector<HTMLElement>("#branch-navigation-body")?.focus();
    });
  }
}

function trapFocus(host: HTMLElement, event: KeyboardEvent): void {
  const focusable = Array.from(host.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
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
