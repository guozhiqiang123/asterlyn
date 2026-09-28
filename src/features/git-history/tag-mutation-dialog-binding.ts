import type { TagMutationCopy } from "../../localization/tag-mutation-copy.ts";
import { TagMutationController } from "./tag-mutation-controller.ts";
import { renderTagMutationDialog } from "./tag-mutation-view.ts";

export class TagMutationDialogBinding {
  private readonly root: HTMLElement;
  private readonly controller: TagMutationController;
  private readonly copy: () => TagMutationCopy;
  private readonly release: () => void;
  private focusReturn: HTMLElement | null = null;
  private open = false;
  private disposed = false;

  constructor(
    root: HTMLElement,
    controller: TagMutationController,
    copy: () => TagMutationCopy,
  ) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.release = controller.subscribe(() => this.render());
  }

  render(): void {
    if (this.disposed) return;
    const host = this.root.querySelector<HTMLElement>("#tag-mutation-dialog");
    if (!host) return;
    const open = this.controller.state !== null;
    if (open && !this.open) {
      this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.open = open;
    host.classList.toggle("hidden", !open);
    host.innerHTML = renderTagMutationDialog(this.controller.state, this.copy());
    host.onclick = open ? (event) => { if (event.target === host) this.controller.close(); } : null;
    if (!open) { this.restoreFocus(); return; }
    host.querySelectorAll<HTMLButtonElement>("[data-tag-mutation-close]").forEach((button) =>
      button.addEventListener("click", () => this.controller.close())
    );
    host.querySelector<HTMLInputElement>("#tag-mutation-name")?.addEventListener("input", (event) => {
      this.controller.updateTagName((event.currentTarget as HTMLInputElement).value);
    });
    host.querySelector<HTMLFormElement>("#tag-mutation-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.controller.submit();
    });
    host.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); this.controller.close();
      } else if (event.key === "Tab") trapFocus(host, event);
    };
    queueMicrotask(() => {
      if (!host.contains(document.activeElement)) {
        (host.querySelector<HTMLElement>("#tag-mutation-name") ??
          host.querySelector<HTMLElement>("button:not([disabled])"))?.focus();
      }
    });
  }

  refreshCopy(): void { if (this.controller.state) this.render(); }

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
      else this.root.querySelector<HTMLElement>("#history-navigation-body")?.focus();
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
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
