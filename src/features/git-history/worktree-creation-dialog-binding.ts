import type { WorktreeCreationCopy } from "../../localization/worktree-creation-copy.ts";
import { WorktreeCreationController } from "./worktree-creation-controller.ts";
import { worktreeDestination } from "./worktree-creation-controller.ts";
import { renderWorktreeCreationDialog } from "./worktree-creation-view.ts";

export class WorktreeCreationDialogBinding {
  private readonly release: () => void;
  private readonly root: HTMLElement;
  private readonly controller: WorktreeCreationController;
  private readonly copy: () => WorktreeCreationCopy;
  private focusReturn: HTMLElement | null = null;
  private wasOpen = false;

  constructor(
    root: HTMLElement,
    controller: WorktreeCreationController,
    copy: () => WorktreeCreationCopy,
  ) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.release = controller.subscribe(() => this.render());
  }

  render(): void {
    const host = this.root.querySelector<HTMLElement>("#worktree-creation-dialog");
    if (!host) return;
    const open = this.controller.state.dialog !== null;
    if (open && !this.wasOpen) {
      this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.wasOpen = open;
    host.classList.toggle("hidden", !open);
    host.innerHTML = renderWorktreeCreationDialog(this.controller.state, this.copy());
    host.onclick = open ? (event) => { if (event.target === host) this.controller.close(); } : null;
    if (!open) return this.restoreFocus();
    host.querySelectorAll<HTMLButtonElement>("[data-worktree-creation-close]").forEach((button) =>
      button.addEventListener("click", () => this.controller.close())
    );
    host.querySelector<HTMLSelectElement>("#worktree-source")?.addEventListener("change", (event) =>
      this.controller.updateSource((event.currentTarget as HTMLSelectElement).value)
    );
    host.querySelector<HTMLInputElement>("#worktree-new-branch-enabled")?.addEventListener("change", (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      this.controller.updateNewBranchEnabled(enabled);
      if (enabled) queueMicrotask(() => host.querySelector<HTMLInputElement>("#worktree-new-branch")?.focus());
    });
    bindInput(host, "#worktree-new-branch", (value) => this.controller.updateNewBranch(value));
    bindInput(host, "#worktree-project-name", (value) => {
      this.controller.updateProjectName(value);
      const dialog = this.controller.state.dialog;
      const preview = host.querySelector<HTMLElement>("#worktree-destination-path");
      if (dialog && preview) preview.textContent = worktreeDestination(dialog.parentDirectory, value);
    });
    host.querySelector<HTMLButtonElement>("#worktree-location-choose")?.addEventListener(
      "click", () => void this.controller.chooseDirectory(),
    );
    host.querySelector<HTMLFormElement>("#worktree-creation-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.controller.submit();
    });
    host.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.controller.close();
      }
    };
    queueMicrotask(() => {
      if (!host.contains(document.activeElement)) {
        host.querySelector<HTMLElement>("#worktree-source, button:not([disabled])")?.focus();
      }
    });
  }

  refreshCopy(): void { if (this.controller.state.dialog) this.render(); }

  dispose(): void {
    this.release();
    this.focusReturn = null;
  }

  private restoreFocus(): void {
    const target = this.focusReturn;
    this.focusReturn = null;
    if (target) queueMicrotask(() => target.isConnected && target.focus());
  }
}

function bindInput(host: HTMLElement, selector: string, update: (value: string) => void): void {
  host.querySelector<HTMLInputElement>(selector)?.addEventListener("input", (event) => {
    update((event.currentTarget as HTMLInputElement).value);
    host.querySelector(".branch-mutation-error")?.remove();
  });
}
