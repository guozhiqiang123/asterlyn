# ADR-0027: Host notification center and bounded plugin notifications

Date: 2026-10-15

Status: accepted

## Context

Asterlyn already renders a bottom-right toast, but its state, timer, severity styling, and DOM updates
are owned directly by the application shell. Features call unrelated `showError`, `showWarning`, and
`showInformation` methods, so notifications have no typed lifecycle, queue, source identity, or
reusable host boundary.

Plugin task execution itself is not fire-and-forget. The native task session continues emitting
ordered progress and terminal events until it succeeds, fails, is cancelled, crashes, or is stopped
during application shutdown. The host task runtime already awaits that terminal result and retains
the Terminal transcript. The missing product behavior is that a failed or crashed user-started task
does not reliably enter the global notification channel.

Future plugins also need a normal output for informational, success, warning, and error messages.
Giving plugins access to toast DOM, CSS, arbitrary rendered text, duration, actions, or application
callbacks would bypass the host presentation and localization rules and would make notification
behavior impossible to govern.

## Decision

### Host-owned notification center

Introduce the host-private `host.notifications` contract. It owns a window-scoped, typed queue with
the severities `info`, `success`, `warning`, and `error`. The host exclusively owns positioning,
theme, icons, accessibility announcements, dismissal, timeout policy, queue bounds, duplicate
coalescing, and cleanup during window disposal.

Features publish plain, already-localized host messages through a narrow application port. They do
not query or mutate toast DOM. Informational and success messages dismiss automatically; warnings
and errors remain until explicitly dismissed or superseded according to the center's bounded queue
policy. The status bar remains a supplemental channel and is not the notification source of truth.

The first implementation keeps one visible notification at a time and a bounded pending queue.
Closing the visible item advances the queue. Exact duplicate messages from the same source and
severity are coalesced so a failing loop cannot flood the user or grow memory without bound.

### Plugin notification capability

Add the optional `plugin.notifications` capability to the Plugin SDK as an additive minor-version
contract. A plugin may publish only:

- one of the four semantic severities; and
- a localization key from its admitted, bounded localization catalog.

The activation scope binds source identity to the admitted plugin; plugins cannot impersonate the
host or another plugin. The host resolves the key using the current application locale and the
plugin's default-locale fallback, then submits the resolved plain text to `host.notifications`.
Unknown keys, invalid severity, over-limit text, stale activation scopes, and unavailable host
support fail closed and produce bounded diagnostics rather than visible raw keys.

Plugins cannot choose screen position, icon, CSS, markup, duration, persistence, sound, focus,
actions, or links. Interactive notifications require a later, separately reviewed capability.
Because the field is optional in the activation context, a plugin compiled against the additive SDK
minor can detect an older host and keep all unrelated contributions working.

### Task terminal-result feedback

The host task orchestration layer, not the plugin, converts a user-started plugin task's terminal
result into global feedback:

- `failed` and `crashed` publish one localized error notification naming the task;
- `succeeded` remains visible in the task row and retained Terminal transcript and does not add a
  global toast in this slice;
- `cancelled` remains a neutral terminal state and does not report an error;
- background discovery and cache refresh do not emit global task-failure notifications.

This rule prevents duplicate notifications when a plugin also uses its general notification
capability. A stale workspace generation or disposed runtime cannot publish a task result into the
new workspace.

### Ownership and lifecycle

- Native task supervision owns process lifetime and terminal result delivery.
- Task composition owns translating a current user task failure into a host notification.
- The notification center owns queue state and deterministic disposal.
- The notification presentation runtime owns toast DOM, timeout, accessibility, and theme classes.
- The plugin runtime owns scoped capability admission, localization resolution, source attribution,
  and revocation when an activation ends.

The notification center does not extend process lifetime. Application shutdown first revokes plugin
activation and task/session ownership through their existing lifecycle, then disposes presentation
listeners and timers. Late publishers become no-ops.

## Bounds and failure isolation

- Visible plus pending notifications are capped by the host; overflow drops the oldest pending
  low-severity item before rejecting a newer high-severity item.
- Plugin message keys and resolved values reuse the admitted localization catalog limits; the
  notification adapter applies a smaller visible-message limit before publication.
- Notification listeners are isolated so one presentation failure cannot stop queue cleanup.
- A plugin activation receives no history and cannot observe, dismiss, or enumerate notifications.
- No notification request grants filesystem, process, network, Terminal, panel, or command access.

## Consequences

Task monitoring remains continuous through terminal completion, while failures gain a consistent
bottom-right result even when the Tasks panel is hidden. Core features and future plugins share one
visual and accessibility policy without sharing implementation details or UI authority.

The SDK gains an additive optional capability and therefore requires current-host and oldest-host
fixtures. Rich actions, notification history, operating-system notifications, and per-plugin user
preferences remain out of scope.

## Rejected alternatives

- **Let each feature manipulate the existing toast.** This preserves duplicated timers and styling
  and offers no safe plugin boundary.
- **Let plugins pass arbitrary text or HTML.** This bypasses admitted localization, creates spoofing
  and markup risks, and produces inconsistent UI.
- **Make plugins report their own task failures.** The host already owns the authoritative terminal
  result; plugin reporting would be optional, duplicated, and vulnerable to stale workspace state.
- **Notify every terminal state globally.** Successful and cancelled tasks already have durable row
  and Terminal feedback; unconditional toasts would be noisy.
- **Use operating-system notifications.** They require separate permission, privacy, background, and
  platform policies and are not equivalent to in-window feedback.
