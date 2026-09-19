import type { GitOperationKind } from "../../models.ts";
import type { GitOperationCopy } from "../../localization/catalog.ts";
import { DEFAULT_LOCALIZATION } from "../../localization/localization.ts";
import {
  GitOperationController,
  canReviewGitOperation,
} from "./git-operation-controller.ts";

export interface GitOperationDialogActions {
  prepare(): void;
  execute(): void;
  resolve(deleteFile: boolean): void;
  reportError(error: unknown): void;
}

/** Owns the lazy Git-operation dialog DOM and its complete listener/focus lifecycle. */
export class GitOperationDialogBinding {
  private readonly root: HTMLElement;
  private readonly controller: GitOperationController;
  private readonly actions: GitOperationDialogActions;
  private readonly copy: () => GitOperationCopy;
  private dialogModule: Promise<
    typeof import("./git-operation-dialog-entry.ts")
  > | null = null;
  private renderGeneration = 0;
  private focusReturn: HTMLElement | null = null;
  private disposed = false;

  constructor(
    root: HTMLElement,
    controller: GitOperationController,
    actions: GitOperationDialogActions,
    copy: () => GitOperationCopy = () => DEFAULT_LOCALIZATION.catalog.gitOperations,
  ) {
    this.root = root;
    this.controller = controller;
    this.actions = actions;
    this.copy = copy;
  }

  openSetup(kind: GitOperationKind, targets: string[], message = ""): void {
    this.captureReturnFocus();
    this.controller.openSetup(kind, targets, message);
  }

  openConflict(path: string): void {
    this.captureReturnFocus();
    void this.controller.openConflict(path);
  }

  close(): boolean {
    const dirty = this.controller.hasUnsavedConflict();
    if (dirty && !window.confirm(this.copy().discardConflict)) return false;
    return this.controller.closeDialog(dirty);
  }

  render(): void {
    if (this.disposed) return;
    const host = this.root.querySelector<HTMLElement>("#git-operation-dialog");
    if (!host) return;
    const state = this.controller.state;
    host.classList.toggle("hidden", !state.dialog);
    const generation = ++this.renderGeneration;
    if (!state.dialog) {
      host.innerHTML = "";
      host.onclick = null;
      this.restoreFocus();
      return;
    }
    if (!this.dialogModule) {
      host.innerHTML = `<section class="dialog git-operation-dialog"><div class="git-operation-loading"><span class="spinner"></span><span>${escapeHtml(this.copy().loadingReview)}</span></div></section>`;
      this.dialogModule = import("./git-operation-dialog-entry.ts");
    }
    void this.dialogModule.then((view) => {
      if (!this.matches(generation) || !this.controller.state.dialog) return;
      host.innerHTML = view.renderGitOperationDialog(this.controller.state, this.copy());
      this.bindEvents(host);
    }).catch((error) => {
      if (!this.matches(generation)) return;
      this.dialogModule = null;
      host.classList.add("hidden");
      host.innerHTML = "";
      this.actions.reportError(error);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderGeneration += 1;
    this.focusReturn = null;
  }

  private bindEvents(host: HTMLElement): void {
    host.onclick = (event) => {
      if (event.target === host) this.close();
    };
    host.querySelectorAll<HTMLButtonElement>("[data-git-operation-close]").forEach((button) => {
      button.addEventListener("click", () => this.close());
    });
    host.querySelector<HTMLButtonElement>("[data-git-operation-back]")?.addEventListener(
      "click",
      () => {
        const plan = this.controller.state.plan;
        if (plan) this.controller.openSetup(plan.kind, plan.targetRefs, plan.message ?? "");
      },
    );

    const kind = host.querySelector<HTMLSelectElement>("#git-operation-kind");
    const targets = host.querySelector<HTMLTextAreaElement>("#git-operation-targets");
    const message = host.querySelector<HTMLTextAreaElement>("#git-operation-message");
    const updateDraft = () => {
      if (!kind || !targets) return;
      this.controller.updateDraft(kind.value as GitOperationKind, targets.value, message?.value ?? "");
      const review = host.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (review) review.disabled = !canReviewGitOperation(this.controller.state);
      host.querySelector(".git-operation-error")?.remove();
    };
    kind?.addEventListener("change", () => {
      updateDraft();
      this.render();
    });
    targets?.addEventListener("input", updateDraft);
    message?.addEventListener("input", updateDraft);
    host.querySelector<HTMLFormElement>("#git-operation-setup-form")?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        updateDraft();
        this.actions.prepare();
      },
    );
    host.querySelector<HTMLButtonElement>("#git-operation-execute")?.addEventListener(
      "click",
      () => this.actions.execute(),
    );
    const result = host.querySelector<HTMLTextAreaElement>("#conflict-result");
    result?.addEventListener("input", () => this.controller.setConflictResult(result.value));
    host.querySelector<HTMLButtonElement>("#git-conflict-resolve")?.addEventListener(
      "click",
      () => this.actions.resolve(false),
    );
    host.querySelector<HTMLButtonElement>("#git-conflict-delete")?.addEventListener(
      "click",
      () => this.actions.resolve(true),
    );
    queueMicrotask(() => {
      const preferred = host.querySelector<HTMLElement>(
        "textarea:not([disabled]), select:not([disabled]), button:not([disabled])",
      );
      if (document.activeElement === document.body || !host.contains(document.activeElement)) {
        preferred?.focus();
      }
    });
  }

  private captureReturnFocus(): void {
    if (!this.controller.state.dialog && document.activeElement instanceof HTMLElement) {
      this.focusReturn = document.activeElement;
    }
  }

  private restoreFocus(): void {
    const target = this.focusReturn;
    this.focusReturn = null;
    if (!target) return;
    queueMicrotask(() => {
      if (target.isConnected) target.focus();
      else this.root.querySelector<HTMLButtonElement>("#git-operation-open")?.focus();
    });
  }

  private matches(generation: number): boolean {
    return !this.disposed && generation === this.renderGeneration;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
