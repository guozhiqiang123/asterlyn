# ADR-0002: Tracked-first repository refresh

## Status

Accepted on 2026-09-08 for M1.1.

## Context

The first release baseline showed a median 1,145 ms complete refresh on the 273,559-path Rebased fixture. Isolated measurements put tracked status near 0.2 seconds and untracked discovery near 1.1 seconds. Waiting for both before painting makes a large working tree feel blocked even though useful index and tracked-file state is already available.

Generation checks in the frontend prevent stale data from being displayed, but rejection alone does not stop an obsolete Git process from consuming CPU and I/O after a repository switch or mutation.

## Decision

- The pure Git capability exposes a fast tracked snapshot and a separate untracked supplement.
- A tracked snapshot explicitly carries `pending` untracked state; only a successfully merged supplement changes it to `complete`.
- Untracked discovery uses system Git and a core-owned cancellation token. Cancellation terminates the child process and drains its pipes rather than merely ignoring its eventual result.
- The desktop adapter owns active-request registration. Presentation code owns generations and merges only a supplement whose request and repository root still match.
- Mutations invalidate and cancel prior scans, return fresh tracked truth, and start a new supplement.
- The existing complete snapshot remains available for non-interactive callers and benchmarks.

## Consequences

The changes list can become useful before every untracked path is known, and obsolete scans stop doing work. During the pending interval, counts are provisional and the UI must state that discovery is in progress. The two phases are not a filesystem transaction, so generation checks and post-mutation refresh remain mandatory. A future watcher or index may change how refreshes are triggered, but it must preserve these truth and cancellation semantics.
