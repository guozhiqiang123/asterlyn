# Repeated language approval dialog — 2026-10-26

[Plan and scope](../engineering/2026-10-26-language-approval-session-fix.md), recorded in `3ffa8c6`
before implementation. Baseline installed source was `5775daf`; the current dialog intentionally
remembered only the project session and had no persistent cross-restart choice.

## Failure and correction

The installed log `session-1792997627427-46447-0` shows an unchanged registered provider while its
reported generation advances 1→8, with native service termination/restart around those transitions.
App wiring used Git-operation generation as language workspace identity; reconciliation disposed
the object owning approval. Additionally, full refresh intentionally reactivates native workspace
and plugin processes. That valid process revocation must not erase the user's unchanged project
decision or disable the fresh-review boundary.

Original behavior was reproduced through real WindowSession → production composition/client →
controlled native bridge: five operations yielded six confirmations, idle contribution refresh
yielded two, and Not now was asked twice. These tests pass after correction.

- Language scope uses the real workspace identity, shared by language binding and navigation.
- The window owns a bounded decision ledger separate from transport. It retains only scope,
  fingerprint and enable/decline state, never closed document text, URI or callbacks. Idle transport
  objects/native processes are released. Thirty-two records is the hard bound; the first admitted
  profile needs one. Project changes clear old decisions; temporary contribution absence during
  full refresh preserves them. There is no localStorage or durable permission database.
- Every native process start prepares and consumes a fresh one-use review. Only identical plugin,
  profile, version, archive/resource and Node identity can reuse the session's choice. Explicit
  plugin disable/uninstall clears it before catalog reload; changed identities prompt again. The
  native owner/activation/package/executable checks remain unchanged.
- Dialog copy explains memory scope. `language.approval` logs requested/approved/declined/reused/
  discarded/invalidated outcomes and fixed reason enums; fingerprints, paths and source are excluded.

## Acceptance and resources

- 19 focused tests and all 1332 script tests pass. Coverage includes approved and declined memory,
  ordinary transitions, idle/full reactivation, worktree changes and return, clearing the workspace,
  provider version changes, package/resource/Node changes, late answers, Settings disable/uninstall,
  failed mutation behavior and runtime disposal/restart.
- In 100 idle cycles: one confirmation, 100 fresh reviews and process start/stop pairs, 99 decision
  reuses, one shared subscription and zero after disposal; the local controlled test took about
  0.56 seconds. Forty project changes prune obsolete decisions without hitting the bound. This is
  lifecycle/bound evidence, not a real-server startup performance or aggregate memory benchmark.
- Typecheck and production build pass; ownership/dependency ceilings were preserved. Native test
  `reviews_are_one_time_and_bind_owner_activation_package` passes. Actual package activation reaches
  the execution-review boundary and deliberately declines automation approval.
- Existing rendered language editor and both real pointer suites pass: Chromium about 4.93 seconds,
  WebKit 4.78 seconds; retained Chromium JS heap delta +252,164 bytes over twenty additional picker
  cycles. These are local fixture samples. Completion, diagnostics, definition/reference selection,
  dirty target preservation and stale-response rejection remain covered.
- No new controls or keyboard bindings were added; the existing localized confirmation dialog's
  focus/keyboard behavior is preserved. The user's manual acceptance is not claimed.

## Native delivery and boundaries

Fresh signed package and canonical installation are pending. Exact build/hash/icon restart evidence
will be recorded afterward. Cross-restart remembered consent is deliberately not introduced by this
fix: after app restart, switching projects, explicit revocation or a changed execution identity,
the user must confirm again. Windows/Linux native acceptance remains open.
