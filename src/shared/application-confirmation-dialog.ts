export interface ApplicationConfirmationRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly destructive?: boolean;
}

interface QueuedConfirmation {
  readonly request: ApplicationConfirmationRequest;
  readonly resolve: (confirmed: boolean) => void;
}

/** One localized, application-owned replacement for browser-native confirmation prompts. */
export class ApplicationConfirmationDialog {
  private readonly root: HTMLElement;
  private readonly host: HTMLElement;
  private readonly queue: QueuedConfirmation[] = [];
  private active: QueuedConfirmation | null = null;
  private returnFocus: HTMLElement | null = null;
  private disposed = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.host = document.createElement("div");
    this.host.id = "application-confirmation-dialog";
    this.host.className = "dialog-backdrop application-confirmation-backdrop hidden";
    this.host.setAttribute("role", "presentation");
    this.root.append(this.host);
  }

  confirm(request: ApplicationConfirmationRequest): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.queue.push({ request, resolve });
      this.presentNext();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.resolve(false);
    this.active = null;
    for (const pending of this.queue.splice(0)) pending.resolve(false);
    this.host.remove();
    this.returnFocus = null;
  }

  private presentNext(): void {
    if (this.disposed || this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    if (!this.host.isConnected) this.root.append(this.host);
    this.active = next;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { request } = next;
    this.host.innerHTML = `<section class="dialog application-confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="application-confirmation-title" aria-describedby="application-confirmation-message">
      <div class="dialog-heading"><h2 id="application-confirmation-title"></h2></div>
      <div class="application-confirmation-message" id="application-confirmation-message"></div>
      <div class="dialog-actions"><button class="secondary-button" data-application-confirmation-cancel type="button"></button><button class="${request.destructive ? "danger-button" : "primary-button"}" data-application-confirmation-accept type="button"></button></div>
    </section>`;
    this.host.querySelector<HTMLElement>("#application-confirmation-title")!.textContent = request.title;
    this.host.querySelector<HTMLElement>("#application-confirmation-message")!.textContent = request.message;
    const cancel = this.host.querySelector<HTMLButtonElement>("[data-application-confirmation-cancel]")!;
    const accept = this.host.querySelector<HTMLButtonElement>("[data-application-confirmation-accept]")!;
    cancel.textContent = request.cancelLabel;
    accept.textContent = request.confirmLabel;
    cancel.addEventListener("click", () => this.finish(false));
    accept.addEventListener("click", () => this.finish(true));
    this.host.onclick = (event) => {
      if (event.target === this.host) this.finish(false);
    };
    this.host.onkeydown = (event) => this.keyDown(event);
    this.host.classList.remove("hidden");
    queueMicrotask(() => accept.focus());
  }

  private finish(confirmed: boolean): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    this.host.classList.add("hidden");
    this.host.innerHTML = "";
    this.host.onclick = null;
    this.host.onkeydown = null;
    active.resolve(confirmed);
    const returnFocus = this.returnFocus;
    this.returnFocus = null;
    if (this.queue.length > 0) {
      queueMicrotask(() => this.presentNext());
    } else if (returnFocus?.isConnected) {
      queueMicrotask(() => returnFocus.focus());
    }
  }

  private keyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.finish(false);
      return;
    }
    if (event.key !== "Tab") {
      if (!(event.target instanceof Element) || !event.target.closest("[data-dialog-drag-handle], [data-dialog-resize]")) {
        event.stopPropagation();
      }
      return;
    }
    const focusable = [...this.host.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hasAttribute("aria-hidden"));
    if (focusable.length === 0) return;
    const current = document.activeElement;
    const index = focusable.indexOf(current as HTMLElement);
    const next = event.shiftKey
      ? focusable[(index <= 0 ? focusable.length : index) - 1]
      : focusable[(index + 1) % focusable.length];
    next?.focus();
    event.preventDefault();
    event.stopPropagation();
  }
}
