# User-action feedback standard

## Purpose

No Asterlyn command may make the user guess whether activation was received. This standard applies
to buttons, menu items, keyboard commands, context actions, and equivalent accessible activations.
It governs presentation feedback only; domain and Git truth still come from their owning capability.

## Required feedback

Every accepted activation must satisfy exactly one of these observable paths:

1. An immediate presentation action changes its visible state by the next paint. Selection,
   disclosure, pressed state, navigation, and opening a dialog are sufficient feedback when their
   result is unambiguous.
2. An asynchronous read or mutation shows a named busy state promptly, retains a cancel affordance
   when cancellation is supported, and ends with one explicit success, no-op, cancellation, or
   failure result.
3. An unavailable or rejected action explains the current blocking reason without starting the
   operation. A control that is intentionally focusable while semantically unavailable must remain
   activatable for this explanation.

Persistent list selection uses one solid `--selection-bg`/`--selection-text` treatment. The active
member of a multi-selection does not add a leading stripe, dot, inset shadow, or second background;
keyboard focus may still use the shared focus outline required for accessibility. A branch click
commits this visual selection synchronously before any filtered History read starts, so network,
Git, or remote-reconciliation latency cannot delay acknowledgement or let an older request restore
the previous visible row.

A status-bar message may supplement every path. It is not sufficient by itself when the current
surface, control, and content remain visually unchanged. In that case Asterlyn presents a transient
contextual or global notification. Successful no-op results use an informational message rather
than pretending that repository content changed. Failures identify the failed action and preserve
the most specific safe recovery guidance available from the owning capability.

The compact status indicator uses stable semantics: green accompanies the initial and restored
`Ready` state, blue denotes active work, yellow denotes a warning, and neutral gray accompanies
ordinary informational text. Returning from a named busy operation to `Ready` restores green rather
than leaving the indicator visually indistinguishable from an idle message.

## Lifecycle and ownership

The feature controller owns whether an action was accepted and its typed progress or terminal
result. The composition/presentation layer chooses the appropriate dialog, inline state, status, or
notification; it must not infer Git success from a click or elapsed time.

A rejected action reports the reason from the current canonical state. A generic fallback may say
that state changed before the action opened, but it must not invent a specific cause such as “not a
Git repository.” That cause is valid only when the current repository session is actually absent.
Concurrent work such as Fetch, scanning, or another Git operation is named directly.

Controls inside a replaceable render region must use event delegation from a stable owner or bind
and dispose listeners as part of that region's explicit mount lifecycle. Replacing a button cannot
leave a visually enabled control without its command route. A dialog-opening request that loses a
race or is rejected by its controller must fall back to the current blocking reason instead of
returning silently.

Programmatic background reconciliation is different from a user command: it may use non-blocking
status feedback and avoid stealing focus. A later explicit user activation must still receive its
own feedback and cannot inherit an earlier background message as evidence that it ran.

A destructive working-tree action requires an application-owned review surface rather than a
WebView-native `confirm`. The review names the exact path and consequence, describes available
recovery, defaults focus to Cancel, and fails closed on Escape, backdrop dismissal, disposal, or a
concurrent review request. Preparing a restore plan is read-only; the Git mutation may start only
after the review controller returns explicit authorization, and the backend still revalidates the
exact plan immediately before writing.

## Single-title hierarchy

Windows, dialogs, tool columns, panels, and comparable named surfaces use one visible title style
unless a product requirement explicitly calls for a second hierarchy level. An eyebrow, kicker,
category label, repeated route name, or descriptive sentence cannot become a second title merely to
fill space. Context belongs in body copy, metadata, accessible descriptions, or the owning
navigation; counts belong adjacent to the one title when they are useful. This rule keeps compact
surfaces visually stable and prevents presentation-only hierarchy from being mistaken for product
structure.

A documented second level must carry stable, independently useful identity rather than repeat or
categorize the primary title. Text Diff is the current explicit exception: the filename is the
primary title and its workspace-relative path is the secondary title, because identical filenames
can exist in different directories. The absolute path remains available through accessible context
when needed and is not promoted into another visible heading.

The frontend quality gate scans production dialog title bars and rejects presentation-only eyebrow,
kicker, or subtitle elements, so this hierarchy rule cannot silently regress in a new modal.

## Accessibility and timing

- Visible labels, icons, badges, and animation are supplemental to a complete accessible action
  name and state.
- Informational and success notifications use polite live announcements. Blocking failures remain
  discoverable until dismissed or superseded by a newer explicit action.
- Busy state must not repeatedly flash enabled/disabled geometry. Completion replaces progress; it
  does not append contradictory messages.
- Each named surface has exactly one visible title unless its accepted requirement documents why a
  second title level is necessary.
- Automated acceptance for a replaceable action region includes activation before and after region
  reconciliation, plus success/no-op and rejected/failure outcomes where applicable.

## Review checklist

For every new or changed user command, review asks:

- What visible state proves that activation was received?
- What is shown while asynchronous work is running?
- What are the success, successful no-op, cancellation, rejection, and failure outcomes?
- Can a render or repository reconciliation replace the control, and who then owns its event route?
- Is the same outcome understandable by keyboard and assistive-technology users?
