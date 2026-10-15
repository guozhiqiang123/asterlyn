export type HostNotificationKind = "info" | "success" | "warning" | "error";

export interface HostNotificationRequest {
  readonly kind: HostNotificationKind;
  readonly message: string;
  readonly source?: string;
}

export interface HostNotification {
  readonly id: string;
  readonly kind: HostNotificationKind;
  readonly message: string;
  readonly source: string;
}

export interface HostNotificationSnapshot {
  readonly current: HostNotification | null;
  readonly pendingCount: number;
}

export const HOST_NOTIFICATION_LIMITS = Object.freeze({
  maxVisibleAndPending: 8,
  maxMessageLength: 1_024,
  maxSourceLength: 128,
});

export interface HostNotificationPublisher {
  publish(request: HostNotificationRequest): string | null;
}

/** Window-scoped notification state. Rendering and timers belong to presentation. */
export class HostNotificationCenter implements HostNotificationPublisher {
  private readonly notifications: HostNotification[] = [];
  private readonly listeners = new Set<(snapshot: HostNotificationSnapshot) => void>();
  private nextId = 1;
  private disposed = false;

  get snapshot(): HostNotificationSnapshot {
    return Object.freeze({
      current: this.notifications[0] ?? null,
      pendingCount: Math.max(0, this.notifications.length - 1),
    });
  }

  publish(request: HostNotificationRequest): string | null {
    if (this.disposed) return null;
    const normalized = normalizeRequest(request);
    const duplicate = this.notifications.find((notification) =>
      notification.kind === normalized.kind &&
      notification.message === normalized.message &&
      notification.source === normalized.source);
    if (duplicate) return duplicate.id;

    if (this.notifications.length >= HOST_NOTIFICATION_LIMITS.maxVisibleAndPending &&
      !this.makeRoom(normalized.kind)) return null;

    const notification = Object.freeze({
      id: `notification-${this.nextId++}`,
      ...normalized,
    });
    this.notifications.push(notification);
    this.emit();
    return notification.id;
  }

  dismiss(id?: string): boolean {
    if (this.disposed || this.notifications.length === 0) return false;
    const index = id === undefined
      ? 0
      : this.notifications.findIndex((notification) => notification.id === id);
    if (index < 0) return false;
    this.notifications.splice(index, 1);
    this.emit();
    return true;
  }

  subscribe(listener: (snapshot: HostNotificationSnapshot) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.notifications.splice(0);
    this.listeners.clear();
  }

  private makeRoom(incoming: HostNotificationKind): boolean {
    const lowPriorityPending = this.notifications.findIndex((notification, index) =>
      index > 0 && (notification.kind === "info" || notification.kind === "success"));
    if (lowPriorityPending >= 0) {
      this.notifications.splice(lowPriorityPending, 1);
      return true;
    }
    if ((incoming === "warning" || incoming === "error") && this.notifications.length > 1) {
      this.notifications.splice(1, 1);
      return true;
    }
    return false;
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* one observer cannot break queue ownership */ }
    }
  }
}

function normalizeRequest(request: HostNotificationRequest): {
  readonly kind: HostNotificationKind;
  readonly message: string;
  readonly source: string;
} {
  if (request.kind !== "info" && request.kind !== "success" &&
    request.kind !== "warning" && request.kind !== "error") {
    throw new Error("Invalid notification kind");
  }
  const message = request.message.trim();
  if (message.length === 0 || message.length > HOST_NOTIFICATION_LIMITS.maxMessageLength) {
    throw new Error("Invalid notification message");
  }
  const source = (request.source ?? "host").trim();
  if (source.length === 0 || source.length > HOST_NOTIFICATION_LIMITS.maxSourceLength) {
    throw new Error("Invalid notification source");
  }
  return Object.freeze({ kind: request.kind, message, source });
}
