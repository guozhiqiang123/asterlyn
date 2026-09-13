import type { GitWorktreeRecovery } from "../../models.ts";
import type { RecoveryCopy } from "../../localization/catalog.ts";
import { DEFAULT_LOCALIZATION } from "../../localization/localization.ts";

interface RecoveryActions {
  activeRoot(): string | null;
  list(root: string): Promise<GitWorktreeRecovery[]>;
  undo(root: string, recovery: GitWorktreeRecovery): Promise<void>;
}

/** A native modal keeps focus inside the recovery review, including during an asynchronous undo. */
export class GitWorktreeRecoveryDialog {
  private dialog: HTMLDialogElement | null = null;
  private generation = 0;
  private busy = false;

  constructor(
    private readonly actions: RecoveryActions,
    private readonly copy: () => RecoveryCopy = () => DEFAULT_LOCALIZATION.catalog.recovery,
  ) {}

  async open(root: string): Promise<void> {
    this.dispose();
    const generation = ++this.generation;
    const dialog = document.createElement("dialog");
    const copy = this.copy();
    dialog.className = "dialog worktree-recovery-dialog";
    dialog.setAttribute("aria-labelledby", "worktree-recovery-title");
    dialog.innerHTML = `<div class="dialog-heading"><h2 id="worktree-recovery-title">${escapeHtml(copy.title)}</h2></div><p role="status">${escapeHtml(copy.loading)}</p><div class="dialog-actions"><button type="button" class="secondary-button" data-recovery-close>${escapeHtml(copy.close)}</button></div>`;
    document.body.append(dialog);
    this.dialog = dialog;
    dialog.addEventListener("cancel", (event) => { if (this.busy) event.preventDefault(); });
    dialog.addEventListener("close", () => { if (this.dialog === dialog) this.dispose(); });
    dialog.querySelector("[data-recovery-close]")?.addEventListener("click", () => dialog.close());
    dialog.showModal();
    try {
      const recoveries = await this.actions.list(root);
      if (generation !== this.generation || this.actions.activeRoot() !== root) { if (this.dialog === dialog) this.dispose(); return; }
      const content = document.createElement("div");
      content.className = "worktree-recovery-list";
      if (recoveries.length === 0) {
        content.dataset.recoveryEmpty = "true";
        content.textContent = this.copy().noneAvailable;
      }
      for (const recovery of recoveries) {
        const item = document.createElement("section");
        const heading = document.createElement("h3");
        heading.textContent = recovery.operation;
        const paths = document.createElement("pre");
        paths.textContent = recovery.paths.join("\n");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button";
        button.textContent = this.copy().undoOperation;
        button.dataset.recoveryUndo = "true";
        button.disabled = !recovery.canUndo;
        button.addEventListener("click", async () => {
          if (this.busy || this.actions.activeRoot() !== root) return;
          if (!window.confirm(this.copy().confirmUndo(recovery.operation, recovery.paths.join("\n")))) return;
          this.busy = true;
          for (const control of dialog.querySelectorAll<HTMLButtonElement>("button")) control.disabled = true;
          try {
            await this.actions.undo(root, recovery);
            if (generation === this.generation) dialog.close();
          } catch (error) {
            if (generation !== this.generation) return;
            showError(item, error);
            for (const control of dialog.querySelectorAll<HTMLButtonElement>("button")) control.disabled = control.dataset.unavailable === "true";
          } finally { this.busy = false; }
        });
        button.dataset.unavailable = String(!recovery.canUndo);
        item.append(heading, paths, button);
        if (!recovery.canUndo) {
          const note = document.createElement("p");
          note.dataset.recoveryIncomplete = recovery.backupPath;
          note.textContent = this.copy().incomplete(recovery.backupPath);
          item.append(note);
        }
        content.append(item);
      }
      dialog.querySelector('[role="status"]')?.replaceWith(content);
    } catch (error) {
      if (generation === this.generation) showError(dialog, error);
    }
  }

  dispose(): void {
    this.generation += 1;
    const dialog = this.dialog;
    this.dialog = null;
    dialog?.remove();
    this.busy = false;
  }

  refreshCopy(): void {
    const dialog = this.dialog;
    if (!dialog) return;
    const copy = this.copy();
    const title = dialog.querySelector<HTMLElement>("#worktree-recovery-title");
    if (title) title.textContent = copy.title;
    const loading = dialog.querySelector<HTMLElement>('[role="status"]');
    if (loading) loading.textContent = copy.loading;
    const close = dialog.querySelector<HTMLButtonElement>("[data-recovery-close]");
    if (close) close.textContent = copy.close;
    const empty = dialog.querySelector<HTMLElement>("[data-recovery-empty]");
    if (empty) empty.textContent = copy.noneAvailable;
    dialog.querySelectorAll<HTMLButtonElement>("[data-recovery-undo]").forEach((button) => { button.textContent = copy.undoOperation; });
    dialog.querySelectorAll<HTMLElement>("[data-recovery-incomplete]").forEach((note) => { note.textContent = copy.incomplete(note.dataset.recoveryIncomplete ?? ""); });
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function showError(host: HTMLElement, error: unknown): void {
  host.querySelector('[role="alert"]')?.remove();
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.className = "git-operation-error";
  message.textContent = error instanceof Error ? error.message :
    error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
  host.append(message);
}
