import type { ChangesGroupContextTarget } from "./changes-navigation-binding.ts";

export interface UnversionedTrashCopy {
  readonly title: string;
  readonly cancel: string;
  readonly confirm: string;
  description(count: number): string;
  warning(count: number): string;
  progress(completed: number, total: number): string;
}

export interface UnversionedTrashGateway {
  current(target: ChangesGroupContextTarget): boolean;
  execute(
    target: ChangesGroupContextTarget,
    progress: (completed: number) => void,
  ): Promise<void>;
  errorMessage(error: unknown): string;
}

interface DialogState {
  readonly target: ChangesGroupContextTarget;
  readonly busy: boolean;
  readonly completed: number;
  readonly error: string | null;
}

/** Owns the one-review, exact-path bulk Trash workflow for unversioned files. */
export class UnversionedTrashRuntime {
  private readonly host: HTMLElement;
  private readonly gateway: UnversionedTrashGateway;
  private readonly copy: () => UnversionedTrashCopy;
  private dialog: DialogState | null = null;
  private focusReturn: HTMLElement | null = null;
  private disposed = false;

  constructor(
    root: HTMLElement,
    gateway: UnversionedTrashGateway,
    copy: () => UnversionedTrashCopy,
  ) {
    this.gateway = gateway;
    this.copy = copy;
    this.host = document.createElement("div");
    this.host.id = "unversioned-trash-dialog";
    this.host.className = "dialog-backdrop hidden";
    this.host.setAttribute("role", "presentation");
    root.append(this.host);
  }

  get busy(): boolean { return this.dialog?.busy === true; }

  open(target: ChangesGroupContextTarget): boolean {
    if (this.disposed || this.dialog || !this.gateway.current(target)) return false;
    this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.dialog = { target, busy: false, completed: 0, error: null };
    this.render();
    return true;
  }

  close(): void {
    if (!this.dialog || this.dialog.busy) return;
    this.dialog = null;
    this.render();
  }

  async confirm(): Promise<void> {
    const dialog = this.dialog;
    if (!dialog || dialog.busy) return;
    if (!this.gateway.current(dialog.target)) {
      this.dialog = { ...dialog, error: this.gateway.errorMessage(new Error("target-changed")) };
      this.render();
      return;
    }
    this.dialog = { ...dialog, busy: true, completed: 0, error: null };
    this.render();
    try {
      await this.gateway.execute(dialog.target, (completed) => {
        if (this.dialog?.target !== dialog.target) return;
        this.dialog = { ...this.dialog, completed };
        this.render();
      });
      if (this.dialog?.target === dialog.target) {
        this.dialog = null;
        this.render();
      }
    } catch (error) {
      if (this.dialog?.target === dialog.target) {
        this.dialog = { ...this.dialog, busy: false, error: this.gateway.errorMessage(error) };
        this.render();
      }
    }
  }

  refreshCopy(): void { if (this.dialog) this.render(); }

  dispose(): void {
    this.disposed = true;
    this.dialog = null;
    this.focusReturn = null;
    this.host.remove();
  }

  private render(): void {
    const dialog = this.dialog;
    this.host.classList.toggle("hidden", !dialog);
    if (!dialog) {
      this.host.innerHTML = "";
      const target = this.focusReturn;
      this.focusReturn = null;
      if (target?.isConnected) queueMicrotask(() => target.focus());
      return;
    }
    const copy = this.copy();
    const total = dialog.target.paths.length;
    this.host.innerHTML = `<section class="dialog unversioned-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unversioned-trash-title" aria-describedby="unversioned-trash-description">
      <div class="dialog-heading"><h2 id="unversioned-trash-title">${escapeHtml(copy.title)}</h2><button class="icon-button" data-unversioned-trash-close type="button" aria-label="${escapeAttribute(copy.cancel)}" ${dialog.busy ? "disabled" : ""}>×</button></div>
      <p id="unversioned-trash-description">${escapeHtml(copy.description(total))}</p>
      <p class="unversioned-trash-warning">${escapeHtml(copy.warning(total))}</p>
      ${dialog.busy ? `<p role="status">${escapeHtml(copy.progress(dialog.completed, total))}</p>` : ""}
      ${dialog.error ? `<div class="remote-management-error" role="alert">${escapeHtml(dialog.error)}</div>` : ""}
      <div class="dialog-actions"><button class="secondary-button" data-unversioned-trash-close type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="danger-button" id="unversioned-trash-confirm" type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy ? copy.progress(dialog.completed, total) : copy.confirm)}</button></div>
    </section>`;
    this.host.onclick = (event) => {
      if (event.target === this.host) this.close();
    };
    this.host.querySelectorAll<HTMLButtonElement>("[data-unversioned-trash-close]").forEach(
      (button) => button.addEventListener("click", () => this.close()),
    );
    this.host.querySelector<HTMLButtonElement>("#unversioned-trash-confirm")?.addEventListener(
      "click", () => void this.confirm(),
    );
    this.host.onkeydown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); this.close(); }
    };
    queueMicrotask(() => {
      if (!this.host.contains(document.activeElement)) {
        this.host.querySelector<HTMLElement>("button:not([disabled])")?.focus();
      }
    });
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/gu, "&#96;");
}
