import assert from "node:assert/strict";
import test from "node:test";

import {
  HOST_NOTIFICATION_LIMITS,
  HostNotificationCenter,
} from "../src/application/notifications/notification-center.ts";
import { NotificationPresentationRuntime } from "../src/presentation/notification-presentation-runtime.ts";

test("notification center orders, deduplicates, and dismisses bounded messages", () => {
  const center = new HostNotificationCenter();
  const snapshots = [];
  center.subscribe((snapshot) => snapshots.push(snapshot));

  const first = center.publish({ kind: "info", message: " Ready ", source: "feature" });
  const duplicate = center.publish({ kind: "info", message: "Ready", source: "feature" });
  const second = center.publish({ kind: "error", message: "Failed", source: "feature" });

  assert.equal(duplicate, first);
  assert.equal(center.snapshot.current?.message, "Ready");
  assert.equal(center.snapshot.pendingCount, 1);
  assert.equal(snapshots.length, 2);
  assert.equal(center.dismiss(first ?? undefined), true);
  assert.equal(center.snapshot.current?.id, second);
  assert.equal(center.dismiss("missing"), false);
});

test("notification center preserves capacity for high severity and isolates observers", () => {
  const center = new HostNotificationCenter();
  center.subscribe(() => { throw new Error("observer failed"); });
  center.publish({ kind: "error", message: "visible" });
  for (let index = 1; index < HOST_NOTIFICATION_LIMITS.maxVisibleAndPending; index += 1) {
    center.publish({ kind: "info", message: `pending-${index}` });
  }
  assert.equal(center.snapshot.pendingCount, HOST_NOTIFICATION_LIMITS.maxVisibleAndPending - 1);
  assert.notEqual(center.publish({ kind: "info", message: "new-low" }), null);
  assert.notEqual(center.publish({ kind: "error", message: "new-high" }), null);
  assert.equal(center.snapshot.pendingCount, HOST_NOTIFICATION_LIMITS.maxVisibleAndPending - 1);
});

test("notification center validates requests and ignores late publication after disposal", () => {
  const center = new HostNotificationCenter();
  assert.throws(() => center.publish({ kind: "info", message: "   " }), /message/u);
  assert.throws(() => center.publish({ kind: "other", message: "x" }), /kind/u);
  assert.throws(() => center.publish({ kind: "info", message: "x", source: "s".repeat(129) }), /source/u);
  center.publish({ kind: "warning", message: "before" });
  center.dispose();
  assert.equal(center.snapshot.current, null);
  assert.equal(center.publish({ kind: "error", message: "late" }), null);
});

test("notification presentation owns severity, auto-dismiss, and queue progression", () => {
  const center = new HostNotificationCenter();
  const fixture = toastFixture();
  const scheduled = new Map();
  let nextTimer = 1;
  const cleared = [];
  const runtime = new NotificationPresentationRuntime(fixture.root, center, {
    setTimeout: (handler, delayMs) => {
      assert.equal(delayMs, 4_000);
      const id = nextTimer++;
      scheduled.set(id, handler);
      return id;
    },
    clearTimeout: (id) => { cleared.push(id); scheduled.delete(id); },
  });

  center.publish({ kind: "info", message: "Started", source: "test" });
  center.publish({ kind: "error", message: "Failed", source: "test" });
  assert.equal(fixture.message.textContent, "Started");
  assert.equal(fixture.toast.attributes.get("role"), "status");
  assert.equal(fixture.toast.classList.contains("information"), true);
  const [timerId, timer] = [...scheduled.entries()][0] ?? [];
  assert.ok(timer);
  scheduled.delete(timerId);
  timer();
  assert.equal(fixture.message.textContent, "Failed");
  assert.equal(fixture.toast.attributes.get("role"), "alert");
  assert.equal(fixture.toast.attributes.get("aria-live"), "assertive");
  assert.equal(scheduled.size, 0);

  runtime.dismiss();
  assert.equal(fixture.toast.classList.contains("hidden"), true);
  runtime.dispose();
  assert.ok(cleared.length >= 0);
});

function toastFixture() {
  const message = element();
  const icon = element();
  const toast = element({ hidden: true });
  toast.querySelector = (selector) => selector === "#toast-message" ? message : selector === ".toast-icon" ? icon : null;
  const root = { querySelector: (selector) => selector === "#toast" ? toast : null };
  return { root, toast, message, icon };
}

function element(initial = {}) {
  const classes = new Set(Object.entries(initial).filter(([, enabled]) => enabled).map(([name]) => name));
  return {
    textContent: "",
    attributes: new Map(),
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    setAttribute(name, value) { this.attributes.set(name, value); },
    querySelector: () => null,
  };
}
