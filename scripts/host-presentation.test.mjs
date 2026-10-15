import assert from "node:assert/strict";
import test from "node:test";

import {
  renderHostAction,
  renderHostDialog,
  renderHostInlineNotice,
  renderHostPanelState,
} from "../src/presentation/host-presentation.ts";

test("host actions map semantic intent to host styles and escape feature bindings", () => {
  const html = renderHostAction({
    id: "refresh",
    label: "Refresh <tasks>",
    intent: "recommended",
    defaultFocus: true,
    attributes: { "data-tasks-action": "refresh", "aria-label": 'Refresh "tasks"' },
  });
  assert.match(html, /class="primary-button"/u);
  assert.match(html, /data-host-action="refresh"/u);
  assert.match(html, /data-host-default-focus/u);
  assert.match(html, /data-tasks-action="refresh"/u);
  assert.match(html, /Refresh &lt;tasks&gt;/u);
  assert.match(html, /aria-label="Refresh &quot;tasks&quot;"/u);
});

test("host action groups reject competing recommended actions", () => {
  assert.throws(() => renderHostPanelState({
    kind: "empty",
    title: "Nothing here",
    actions: [
      { id: "first", label: "First", intent: "recommended" },
      { id: "second", label: "Second", intent: "recommended" },
    ],
  }), /only one recommended action/u);
});

test("panel states render centered semantic status with vertical actions", () => {
  const html = renderHostPanelState({
    kind: "stale",
    title: "Cached tasks are stale",
    detail: "Project configuration changed.",
    actions: [{ id: "refresh", label: "Refresh tasks", intent: "recommended" }],
    attributes: { "data-cache-state": "stale" },
  });
  assert.match(html, /empty-state host-panel-state host-panel-state-stale/u);
  assert.match(html, /role="status"/u);
  assert.match(html, /host-panel-state-actions/u);
  assert.match(html, /class="primary-button"/u);
  assert.match(html, /data-cache-state="stale"/u);
});

test("inline notices preserve content context and error announcements", () => {
  const html = renderHostInlineNotice({
    kind: "error",
    title: "Refresh failed",
    detail: "Previous tasks remain visible.",
    actions: [{ id: "retry", label: "Retry", intent: "recommended" }],
  });
  assert.match(html, /host-inline-notice-error/u);
  assert.match(html, /role="alert"/u);
  assert.match(html, /Previous tasks remain visible/u);
});

test("host dialogs own title hierarchy, backdrop, and separated action placement", () => {
  const html = renderHostDialog({
    id: "task-review",
    title: "Confirm task execution",
    className: "task-execution-review",
    bodyHtml: '<p id="task-review-detail">Trusted host content</p>',
    describedBy: "task-review-detail",
    actions: [
      { id: "deny", label: "Deny", intent: "destructive", placement: "leading" },
      { id: "cancel", label: "Cancel", intent: "neutral" },
      { id: "confirm", label: "Confirm", intent: "recommended", defaultFocus: true },
    ],
  });
  assert.match(html, /dialog-backdrop host-dialog-backdrop/u);
  assert.match(html, /class="dialog task-execution-review"/u);
  assert.match(html, /aria-labelledby="task-review-title"/u);
  assert.match(html, /aria-describedby="task-review-detail"/u);
  assert.match(html, /class="dialog-spacer"/u);
  assert.match(html, /class="danger-button"[^>]*>Deny/u);
  assert.match(html, /class="primary-button"[^>]*data-host-default-focus[^>]*>Confirm/u);
});
