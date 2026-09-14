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

A status-bar message may supplement every path. It is not sufficient by itself when the current
surface, control, and content remain visually unchanged. In that case Asterlyn presents a transient
contextual or global notification. Successful no-op results use an informational message rather
than pretending that repository content changed. Failures identify the failed action and preserve
the most specific safe recovery guidance available from the owning capability.

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

## Accessibility and timing

- Visible labels, icons, badges, and animation are supplemental to a complete accessible action
  name and state.
- Informational and success notifications use polite live announcements. Blocking failures remain
  discoverable until dismissed or superseded by a newer explicit action.
- Busy state must not repeatedly flash enabled/disabled geometry. Completion replaces progress; it
  does not append contradictory messages.
- Automated acceptance for a replaceable action region includes activation before and after region
  reconciliation, plus success/no-op and rejected/failure outcomes where applicable.

## Review checklist

For every new or changed user command, review asks:

- What visible state proves that activation was received?
- What is shown while asynchronous work is running?
- What are the success, successful no-op, cancellation, rejection, and failure outcomes?
- Can a render or repository reconciliation replace the control, and who then owns its event route?
- Is the same outcome understandable by keyboard and assistive-technology users?
