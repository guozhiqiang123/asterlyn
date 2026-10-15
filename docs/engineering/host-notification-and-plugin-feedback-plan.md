# Host notification and plugin feedback implementation plan

Date: 2026-10-15

Status: implemented

Governing decision: [ADR-0027](../architecture/decisions/0027-host-notification-center-and-plugin-notifications.md)

## Outcome

Keep plugin tasks observed through their terminal result, report failed or crashed user tasks in the
host's bottom-right notification surface, and expose a bounded localization-key notification
capability for future plugins. The host continues to own all rendering and interaction.

## Delivery slices

### NF0 — Record the contracts

- Add ADR-0027, this plan, and registry entries for `host.notifications` and
  `plugin.notifications`.
- Update the interaction-feedback standard with queue, severity, task-result, and plugin-boundary
  rules.
- Record the additive SDK minor and deterministic older-host fallback.

Commit boundary: documentation only.

### NF1 — Extract the host notification center

- Add a window-scoped typed notification queue with stable IDs, severity, source, duplicate
  coalescing, capacity policy, subscriptions, dismissal, and disposal.
- Move toast DOM, icon/class mapping, polite/assertive live semantics, and auto-dismiss timers into
  a presentation runtime.
- Keep existing application call sites working through narrow publish wrappers while removing
  direct toast mutation and application-owned timers.
- Add focused lifecycle, ordering, overflow, deduplication, timer, and disposal tests.

Commit boundary: host-only notification infrastructure; no Plugin SDK change.

### NF2 — Add the optional plugin capability

- Advance the Plugin SDK additive minor and declare the optional `notifications` activation
  capability plus its semantic request and limits.
- Bind each capability to the admitted plugin and active workspace generation.
- Resolve only keys present in the plugin's validated current/default localization catalog; reject
  stale, unknown, malformed, or over-limit requests without exposing raw keys.
- Keep a plugin built for the previous SDK minor functional and add current/oldest-host fixtures.

Commit boundary: SDK declarations, host adapter, registry/runtime wiring, and focused tests.

### NF3 — Publish authoritative task failures

- After a user-started plugin task reaches `failed` or `crashed`, publish one localized host error
  naming the exact task.
- Do not emit duplicate global notifications for success, cancellation, discovery, cache refresh,
  stale workspace generations, or disposed sessions.
- Preserve task-row terminal state and the retained Terminal transcript as the detailed output.
- Add result-matrix and stale-workspace regression tests.

Commit boundary: task composition wiring, localized copy, and tests.

### NF4 — Acceptance and local delivery

- Validate English and Chinese copy, dark/light/system themes, keyboard dismissal, live-region
  behavior, queue progression, and application shutdown cleanup.
- Run focused notification/plugin/task tests, full script tests, type checks, and the production
  frontend build.
- Exercise a real FilesRecovery Gradle failure and verify that its Terminal transcript remains
  available while one error tip appears at bottom right.
- Build a fresh macOS application, preserve the previous local installation, replace it, and relaunch
  for manual acceptance.

Commit boundary: acceptance evidence and packaging metadata only when tracked evidence changes.

## Acceptance matrix

| Scenario | Required result |
| --- | --- |
| User Gradle task succeeds | Terminal and task row show success; no redundant global tip |
| User Gradle task exits non-zero | Task row reaches failed, Terminal is retained, one error tip names the task |
| User Gradle task runtime crashes | Task row reaches crashed, Terminal is retained, one error tip names the task |
| User cancels a task | Cancelled terminal state; no failure tip |
| Discovery/cache refresh fails | Owning Tasks state explains it; no user-task completion tip |
| Workspace changes before a result | Old result cannot notify or mutate the new workspace |
| Plugin publishes an admitted key | Host resolves locale and renders the semantic severity consistently |
| Plugin publishes an unknown key | No raw key is shown; one bounded diagnostic is recorded |
| Plugin lacks the optional capability | Its commands, settings, cache, and tasks continue to work |
| Repeated identical publication | One visible item is retained; queue and memory remain bounded |
| Multiple different publications | One is visible; dismissal/timeout advances the bounded queue in order |
| Window closes with pending notifications | Listeners and timers are released; no late DOM updates occur |

## Rollback

NF3 can be removed independently without changing native task supervision or Terminal retention.
NF2 is an optional SDK capability and can be disabled at its factory while older plugin contracts
remain active. NF1 has no persisted schema; existing feature wrappers can temporarily route to one
direct host notification if the queue must be reverted. Local installation replacement remains
recoverable through the dated application backup.
