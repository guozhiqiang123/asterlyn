# Language execution consent lifetime — 2026-10-26

Status: planned before implementation. Baseline `ff81716`.

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
2. Retain one bounded idle consent-bearing Session for the currently admitted workspace/provider,
   independently of how many eligible documents are open. Stop its native process at zero documents
   as before; do not retain closed document text/listeners. Unrelated contribution refresh cannot
   discard this idle choice. Provider removal/disable, provider-version change, workspace change
   and disposal invalidate it; stale approval dialogs cannot authorize a replacement scope.
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
