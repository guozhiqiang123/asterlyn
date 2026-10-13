# Remote Tag refresh and Push success-feedback plan

- **Status:** Implemented
- **Date:** 2026-10-13

## Problem statement

Asterlyn already reconciles local Tag changes written by another tool because the workspace watcher
invalidates the `refs` and `history` slices when `.git/refs` or `packed-refs` changes. Manual
Refresh, project activation, and focus recovery also reread local refs. Remote Fetch and Update,
however, deliberately pass `--no-tags`, so a Tag created only on the selected remote never enters
the local ref snapshot and cannot appear in Branches or History.

Successful single-Tag Push and reviewed branch Push both publish completion only through the bottom
status bar. Failures already use the application toast, and the existing informational toast is the
appropriate bounded acknowledgement for a completed network write, but neither successful Push
path currently invokes it.

## Product outcome

1. Interactive Fetch and Update retrieve the selected remote's complete Tag set together with the
   existing branch refspec. A newly published remote Tag therefore becomes a normal local Tag and
   appears through the existing `refs`/`history` reconciliation path.
2. A successful exact single-Tag Push shows the localized completion message in the right-bottom
   informational toast and the bottom status bar.
3. A successful reviewed commit Push, including a Push that also sends selected Tags, shows the
   localized `Push completed` message through the same informational toast and status bar.
4. Background focus Fetch remains silent. Success notifications are emitted only for explicit user
   operations and dismiss automatically through the existing four-second toast lifecycle.

## Safety and compatibility invariants

1. Fetching Tags must never force-update or delete a local Tag. A same-name/different-object Tag is
   a Git failure that remains visible and requires explicit user resolution.
2. Branch and Tag fetching must be atomic so a Tag rejection cannot leave only part of the reviewed
   remote update applied.
3. Tag pruning remains disabled; discovering a remote Tag must not silently delete local Tags.
4. Remote operations remain non-interactive, cancellable, bounded, and scoped to the selected
   configured remote.
5. No successful background Fetch produces a toast. Failures keep their current actionable error
   presentation.
6. The frontend does not invent remote Tag state. Git updates local refs first, and the existing
   authoritative repository snapshot remains the only presentation source.

## Implementation plan

### Phase 1 — native Tag synchronization

- Replace `--no-tags` with `--tags` in both explicit Fetch and Update's fetch phase.
- Add `--atomic` so branch and Tag ref updates succeed or fail together.
- Retain `--no-prune`, `--no-prune-tags`, the canonical selected-remote branch refspec, disabled
  submodule recursion, cancellation, and the hardened remote environment.
- Add bare-remote integration coverage proving that a Tag created after the initial clone appears
  after Fetch and after Update without modifying worktree content.
- Add a collision regression proving that a different local Tag is not overwritten.

### Phase 2 — success notification routing

- Mark interactive reviewed Push completion as prominent feedback so `runRemoteOperation` uses the
  existing right-bottom informational toast.
- Route exact single-Tag Push completion through the same informational toast after the reviewed
  native mutation succeeds.
- Keep ordinary Fetch, changed Update, branch mutations, local Tag creation/deletion, and
  background focus reconciliation on their current status-bar behavior.

### Phase 3 — regression and delivery

- Extend focused feedback tests to cover Push prominence while retaining the existing unchanged
  Update toast and ordinary Fetch behavior.
- Cover exact Tag Push success routing and verify that failure paths do not emit success feedback.
- Run frontend tests, TypeScript checking, production build, relevant Rust tests, and source-budget
  checks.
- Build a fresh native macOS package, replace `/Applications/Asterlyn.app`, verify the bundle, and
  launch it for manual acceptance.

## Acceptance matrix

| Scenario | Expected result |
| --- | --- |
| External tool creates a local Tag | Watcher rereads refs/history within its bounded debounce |
| Another client publishes a new remote Tag | Explicit Fetch/Update imports it and refreshes Branches/History |
| Remote Tag conflicts with a different local Tag | Operation fails without overwriting the local Tag |
| Background focus Fetch succeeds | State refreshes without a toast |
| Exact single-Tag Push succeeds | Right-bottom localized informational toast appears |
| Reviewed commit Push succeeds | Right-bottom localized `Push completed` toast appears |
| Any Push fails | Existing actionable error UI remains; no success toast appears |

## Commit sequence

1. `docs(remote): plan Tag refresh and Push feedback`
2. `feat(remote): synchronize Tags during Fetch and Update`
3. `feat(remote): show Push success notifications`
4. `test(remote): cover Tag synchronization and success feedback`

No version bump, release Tag, or remote publication is part of this change unless requested after
manual acceptance.

## Implementation record

- Fetch and Update now request Tags and branch refs in one atomic Git fetch while retaining the
  existing no-prune, no-submodule-recursion, cancellation, and selected-remote boundaries.
- Remote-only Tags are therefore imported by explicit Fetch/Update and by the existing silent
  focus-recovery Fetch; local watcher/manual/project-open paths continue to reread authoritative
  local refs without contacting the remote.
- A same-name/different-object local Tag rejects the atomic fetch and leaves both the local Tag and
  remote-tracking branch unchanged.
- Reviewed commit Push and exact single-Tag Push now use the existing four-second informational
  toast as well as the bottom status bar. Background Fetch remains silent.
- Validation passed: 967 frontend script tests, TypeScript production build, 139 Rust unit tests,
  four Rust integration tests (including two remote-Tag cases), and both TypeScript/Rust ownership
  budgets.
- The verified macOS application bundle was installed to `/Applications/Asterlyn.app` and launched.
  The retained local archive is
  `target/release/bundle/macos/Asterlyn-0.1.5-local-2026-10-13-remote-tag-feedback.app.zip`
  with SHA-256 `933a74ad9f009c6f29c87683cb5a2beaebe1740cdb408c8521ef8b47712f3b06`.
