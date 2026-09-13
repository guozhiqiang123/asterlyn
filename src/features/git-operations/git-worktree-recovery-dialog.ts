import type { GitWorktreeRecovery } from "../../models.ts";

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

  constructor(private readonly actions: RecoveryActions) {}

  async open(root: string): Promise<void> {
    this.dispose();
    const generation = ++this.generation;
    const dialog = document.createElement("dialog");
    dialog.className = "dialog worktree-recovery-dialog";
    dialog.setAttribute("aria-labelledby", "worktree-recovery-title");
    dialog.innerHTML = '<div class="dialog-heading"><h2 id="worktree-recovery-title">Recover local changes</h2></div><p role="status">Loading recovery copies…</p><div class="dialog-actions"><button type="button" class="secondary-button" data-recovery-close>Close</button></div>';
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
        content.textContent = "No recovery copies are available for this project. New Restore and conflict-resolution operations create a copy automatically.";
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
        button.textContent = "Undo this operation";
        button.disabled = !recovery.canUndo;
        button.addEventListener("click", async () => {
          if (this.busy || this.actions.activeRoot() !== root) return;
          if (!window.confirm(`Undo ${recovery.operation}?\n\n${recovery.paths.join("\n")}\n\nRestores the previous file and staging state. If the files, index, or HEAD have changed since, Undo stops and preserves the recovery copy.`)) return;
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
          note.textContent = `This operation did not reach a verified completion. Inspect its retained original files and proposed result before restoring: ${recovery.backupPath}`;
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
