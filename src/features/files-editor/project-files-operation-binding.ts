import type { ProjectFilesCopy } from "../../localization/catalog.ts";
import { ProjectFilesOperationController } from "./project-files-operation-controller.ts";
import { renderProjectFilesOperationDialog } from "./project-files-operation-view.ts";

/** Owns Files inline-edit and confirmation DOM listeners across tree rerenders. */
export class ProjectFilesOperationBinding {
  private readonly root: HTMLElement;
  private readonly controller: ProjectFilesOperationController;
  private readonly copy: () => ProjectFilesCopy;
  private focusReturn: HTMLElement | null = null;
  private dialogWasOpen = false;
  private disposed = false;

  constructor(
    root: HTMLElement,
    controller: ProjectFilesOperationController,
    copy: () => ProjectFilesCopy,
  ) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
  }

  bindInline(): void {
    if (this.disposed) return;
    const form = this.root.querySelector<HTMLFormElement>("[data-project-entry-edit]");
    const input = form?.querySelector<HTMLInputElement>("#project-entry-name");
    if (!form || !input) return;
    input.addEventListener("input", () => this.controller.updateInlineValue(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.controller.cancelInline();
    });
    input.addEventListener("blur", () => {
      queueMicrotask(() => {
        if (input.isConnected) void this.controller.blurInline(input.value);
      });
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.controller.updateInlineValue(input.value);
      void this.controller.submitInline();
    });
    queueMicrotask(() => {
      if (!input.isConnected || input.disabled) return;
      input.focus();
      if (form.dataset.projectEntryEdit === "rename") {
        const dot = input.value.lastIndexOf(".");
        input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
      } else {
        input.select();
      }
    });
  }

  renderDialog(): void {
    if (this.disposed) return;
    const host = this.root.querySelector<HTMLElement>("#project-files-operation-dialog");
    if (!host) return;
    const open = this.controller.state.dialog !== null;
    if (open && !this.dialogWasOpen) {
      const target = this.controller.state.dialog?.target;
      const targetRow = target
        ? Array.from(this.root.querySelectorAll<HTMLElement>("[data-project-node]"))
          .find((element) => element.dataset.projectNode === target.workspacePath) ?? null
        : null;
      this.focusReturn = targetRow ?? (
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      );
    }
    this.dialogWasOpen = open;
    host.classList.toggle("hidden", !open);
    host.innerHTML = renderProjectFilesOperationDialog(this.controller.state, this.copy());
    host.onclick = open ? (event) => {
      if (event.target === host) this.controller.closeDialog();
    } : null;
    if (!open) {
      this.restoreFocus();
      return;
    }
    host.querySelectorAll<HTMLButtonElement>("[data-project-files-dialog-close]").forEach(
      (button) => button.addEventListener("click", () => this.controller.closeDialog()),
    );
    const input = host.querySelector<HTMLInputElement>("#project-files-paste-name");
    input?.addEventListener("input", () => this.controller.updateDialogValue(input.value));
    host.querySelector<HTMLFormElement>("#project-files-paste-name-form")?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        if (!input) return;
        this.controller.updateDialogValue(input.value);
        const target = this.controller.state.dialog?.kind === "paste-name"
          ? this.controller.state.dialog.target
          : null;
        if (target) void this.controller.paste(target, input.value);
      },
    );
    host.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.controller.closeDialog();
        return;
      }
      if (event.key === "Tab") trapFocus(host, event);
    };
    queueMicrotask(() => {
      if (!host.contains(document.activeElement)) {
        (input ?? host.querySelector<HTMLElement>("button:not([disabled])"))?.focus();
      }
      input?.select();
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
