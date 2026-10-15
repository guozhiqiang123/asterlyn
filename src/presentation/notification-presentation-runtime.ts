import type {
  HostNotification,
  HostNotificationCenter,
  HostNotificationSnapshot,
} from "../application/notifications/index.ts";

export interface NotificationTimerPort {
  setTimeout(handler: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

const AUTO_DISMISS_MS = 4_000;
const TOAST_KIND_CLASSES = ["information", "success", "warning"] as const;

/** Owns the one host toast surface; features and plugins never manipulate its DOM. */
export class NotificationPresentationRuntime {
  private readonly root: HTMLElement;
  private readonly center: HostNotificationCenter;
  private readonly timers: NotificationTimerPort;
  private readonly release: () => void;
  private timer: number | null = null;
  private disposed = false;

  constructor(
    root: HTMLElement,
    center: HostNotificationCenter,
    timers: NotificationTimerPort,
  ) {
    this.root = root;
    this.center = center;
    this.timers = timers;
    this.release = center.subscribe((snapshot) => this.render(snapshot));
  }

  refresh(): void {
    if (!this.disposed) this.render(this.center.snapshot);
  }

  dismiss(): void {
    const current = this.center.snapshot.current;
    if (current) this.center.dismiss(current.id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.clearTimer();
  }

  private render(snapshot: HostNotificationSnapshot): void {
    this.clearTimer();
    const toast = this.root.querySelector<HTMLElement>("#toast");
    if (!toast) return;
    for (const className of TOAST_KIND_CLASSES) toast.classList.remove(className);
    const notification = snapshot.current;
    if (!notification) {
      toast.classList.add("hidden");
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      return;
    }

    this.renderCurrent(toast, notification);
    if (notification.kind === "info" || notification.kind === "success") {
      this.timer = this.timers.setTimeout(() => {
        this.timer = null;
        this.center.dismiss(notification.id);
      }, AUTO_DISMISS_MS);
    }
  }

  private renderCurrent(toast: HTMLElement, notification: HostNotification): void {
    const message = toast.querySelector<HTMLElement>("#toast-message");
    const icon = toast.querySelector<HTMLElement>(".toast-icon");
    if (message) message.textContent = notification.message;
    if (icon) icon.textContent = notificationIcon(notification.kind);
    if (notification.kind === "info") toast.classList.add("information");
    if (notification.kind === "success") toast.classList.add("success");
    if (notification.kind === "warning") toast.classList.add("warning");
    toast.classList.remove("hidden");
    toast.setAttribute("role", notification.kind === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", notification.kind === "error" ? "assertive" : "polite");
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}

function notificationIcon(kind: HostNotification["kind"]): string {
  if (kind === "info") return "i";
  if (kind === "success") return "✓";
  return "!";
}
