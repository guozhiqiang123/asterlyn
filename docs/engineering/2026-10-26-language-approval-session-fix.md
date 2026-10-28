# Language execution consent lifetime — 2026-10-26

Status: implemented; automated and native delivery gates pass. User manual acceptance remains open.
Baseline `ff81716`.
Plan committed as `3ffa8c6` before source changes.

The enable-language-services dialog promises to remember the choice for the current project
session. It intentionally has no cross-restart persistence. The installed session log nevertheless
shows unchanged provider count/version while its frontend generation advances 1→8, with language
service termination/restart at those transitions. Source wiring incorrectly uses WindowSession's
operation generation (also advanced by Git operations/refresh) as language workspace identity.
Reconciliation then disposes the Session that owns the approval fingerprint.

## Correction

1. Bind language services and navigation to the real WorkspaceSession identity. Ordinary Git
   operations/refresh and tab activity must not create a new consent scope. Changing project,
   clearing/reopening a workspace or closing the application ends the scope.
2. Keep the project-scoped decision separate from the transport Session, independently of eligible
   documents or a temporary absent provider during full refresh/reactivation. Native `open_project`
   deliberately revokes processes and plugin activation even on full refresh; keep that authority
   behavior, rebuild transport, and reuse only an identical decision after a fresh review. Stop
   native processes at zero documents and discard closed document text/listeners. Explicit plugin
   disable/uninstall revokes the decision before catalog reload. Provider-version change, workspace
   change and disposal invalidate it; stale dialogs cannot authorize a replacement scope. Cache
   records are capped at 32 and pruned on scope changes (one for the admitted first profile).
3. A process restart still prepares a fresh one-use native review. Reuse the user's decision only
   for the same package/resource/executable fingerprint in that project session. Node/plugin
   identity changes require confirmation. No durable grant, localStorage bypass, native review
   relaxation or automatic approval of the actual installed app is introduced.
4. Clarify the dialog's memory scope and add metadata-only approval requested/approved/declined/
   reused/invalidated outcomes. Never log paths, executable identities, fingerprints or source.

## Gates and delivery

First reproduce repeat-confirmation with a real WindowSession → production language composition →
client → controlled native bridge test, covering operation transitions and idle contribution
refresh. Then test denial memory, project/provider/resource/Node changes, late consent and cleanup.
Run existing client/editor/real-pointer tests, typecheck/build/full scripts and relevant native
checks. Record results and boundaries, make staged local commits, build/sign/strictly verify a fresh
native artifact, install only through the canonical installer, and check saved-icon reopen logs.
The user's manual acceptance and cross-restart remember feature remain explicitly open/deferred.

## Execution record

- A behavior-preserving extraction of the original App scope wiring reproduced three failures:
  five operation transitions caused six confirmations, an idle contribution refresh caused two,
  and a remembered denial was asked twice. The corrected production composition passes all three.
- Language scope now reads WorkspaceSession.identity; a bounded in-memory decision ledger is
  independent of native transports and temporary missing contributions during full reactivation.
  Native processes, documents and listeners are released while idle. Explicit Settings disable/
  uninstall revokes the decision before catalog reload. Every start still consumes a fresh review.
- Nineteen focused client/approval/Settings lifecycle tests and all 1332 scripts pass. A 100-cycle
  idle test confirms one decision, 100 independently reviewed starts/stops, and subscription cleanup;
  project churn prunes old records below the cache bound. Late answers cannot authorize a new scope.
- Typecheck/production build, existing language-editor rendering, real Chromium/WebKit definition/
  reference gestures, actual package activation through execution review, and the native one-use
  owner/activation/package review test pass. Actual installed-app approval is never auto-granted.
- Implementation `50b2989`, automated evidence `09998c3`: freshly built, whole-bundle ad-hoc signed,
  strictly verified, actual-project probed and installed through the canonical installer. Installed
  hashes match, app root identity is preserved, backup is a verified ZIP, and both saved-icon
  launches record frontend readiness. [Acceptance/artifact evidence](../benchmarks/2026-10-26-language-approval-session.md).

## Loading-error propagation correction

The language-service client preserves the typed `LanguageServiceIndexingError` from the native
bridge while the same document, session, and editor version remain current. This lets definition/reference navigation show a native
loading response as information instead of claiming that no definition exists. Hover and
completion retain their caller-side graceful handling. Errors arriving after an edit, close, session replacement, or workspace transition remain
dropped as stale. Focused client coverage also verifies that a later successful request recovers
without another consent prompt or a poisoned session.
