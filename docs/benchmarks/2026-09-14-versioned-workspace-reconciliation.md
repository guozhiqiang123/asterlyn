# Versioned workspace reconciliation acceptance — 2026-09-14

## Scope and environment

This acceptance closes the whole-path watcher/reconciliation audit in ADR-0012. It is an
architecture replacement, not another event filter: asynchronous reads now have an explicit commit
lease, mutations and reads share one canonical projection boundary, backend Git authorization has
its own observation order, watcher plans are exact per owner, and automatic recovery is bounded.

The work is in `/home/gzq/asterlyn-watcher-architecture` on
`codex/watcher-reconciliation-architecture`, based on `65a8800`. The source changes remain
uncommitted. Environment: Linux 6.12.20 x86-64, Node 24.19.0, Rust 1.98.1, and system Git 2.47.2.
No dependency version or persisted-data format changed.

## Architecture and correctness evidence

The implementation proves these invariants:

- A repository read carries workspace identity, base repository revision, and exact slices. A late
  read cannot overwrite a newer mutation; retries have 25/50/100 ms delays and stop after three
  retries until new evidence or manual Refresh.
- Canonical partial merge and feature fan-out use the same committed slice set. Capability changes
  are the only full-fan-out exception.
- Backend same-root Git authorization uses a separate repository-observation token, so an obsolete
  native read cannot roll back a newer Git/non-Git decision even if the frontend rejects its DTO.
- Project activation keeps its reconciliation barrier until the caller finishes canonical feature
  projections. A superseding watch-plan activation retains the installed watch instead of briefly
  detaching it.
- The native watch service stores exact owner plans, recomputes the shared union on update/detach,
  tracks watcher instances, and records partial Linux registration progress so rollback can
  reconcile the actual OS plan.
- Deleted known directories use a bounded 512-entry tombstone set and are rewatched if the same path
  reappears. At most 128 authorized open-document paths extend one owner's hot set.
- Handshake buffering is bounded at 64 events; overflow becomes one complete verification rather
  than silent loss. Path truncation, root ambiguity, and backend overflow retain distinct meanings.
- Repeated backend overflow performs at most three broad recoveries per 30-second window and then
  enters `suspended`. Stale read conflicts have a separate bounded retry budget. Both require new
  evidence, a new watch instance, or Refresh to continue.
- Recovery invalidations cannot retain exact paths after path identity becomes uncertain. Access
  time/read events and Git object/log churn cannot feed the refresh path back into itself.

| Gate | Result |
| --- | ---: |
| TypeScript check | passed |
| Frontend/script suite | 341 passed |
| `asterlyn-git` suite | 70 passed |
| `asterlyn-workspace` suite | 29 passed |
| Desktop/Tauri library suite | 43 passed, 2 native tests separated |
| Real Linux native watcher tests | 2 passed |
| Production frontend build | passed |
| Optimized native build | passed in 49.45 s |
| Linux native process smoke | remained alive for 30,000 ms |
| Rust formatting, Clippy, and diff whitespace | passed |

Deterministic regressions cover stale read versus mutation, stale backend capability observation,
A -> B -> A catalog requests, project barrier settlement, metadata-only merge preservation,
same-root Git appearance/disappearance, old watcher instances, superseded activation without a
detach gap, activation-buffer overflow, persistent-error suspension, stale-read retry exhaustion,
per-owner union/path isolation, ignored read-only documents, deleted/recreated directories,
malformed/escaping protocol paths, and path truncation without slice broadening.

The two real Linux watcher tests prove both sides of the feedback-loop contract: three read-only Git
snapshots produce no invalidation during a 1.5-second observation, while a later external edit does;
a separate native backend fixture reports an external workspace change.

## Read and resource evidence

Repository watcher reads now return partial DTOs. Test-only command tracing proves:

- `workingTree` executes one tracked-status read and does not populate head, refs, or history;
- `refs` reads the root/ref/remotes model and executes no working-tree status or commit-history read;
- `head` returns branch state without a working-tree scan;
- `history` reads reachable history without a working-tree scan;
- `operation` returns only operation state;
- untracked discovery is started only after an accepted `workingTree` commit.

This is a structural command-count result, not a large-repository latency benchmark. The focused
slice fixture completed in 0.06 seconds including repository setup; that number is not treated as a
user-facing latency claim.

The production frontend output is 9,030,079 bytes. Its startup JavaScript is 494,600 bytes
(113,670 bytes through `gzip -c`) and remains below the 500 KiB architecture gate; main CSS is
120,132 bytes (25,832 bytes through `gzip -c`). The optimized Linux executable is 19,575,344 bytes.

After startup settled in the 30-second native smoke, one process-tree sample reported 421,276 KiB
resident across the Asterlyn, WebKit network, and WebKit web processes. A two-second `top` interval
reported 1.0% CPU for Asterlyn and 0.0% for the two WebKit children. RSS sums shared pages and this
single-host sample has no before/control run, so memory is **observed but comparison remains
inconclusive**. The important steady-state resource change is bounded scheduling: no polling timer
was added, broad recovery has one pending timer and a circuit breaker, activation/event collections
are capped, and absent-directory tombstones are capped.

## Accessibility and limitations

The change adds no interactive control or alternate focus path. Watcher suspension uses the existing
status/warning surface and is localized in English and Simplified Chinese. Keyboard, screen-reader,
and forced-color behavior are therefore unchanged; the complete script suite retains the existing
accessibility checks. No manual assistive-technology session was performed.

Linux native watcher behavior is accepted. macOS/Windows compilation and real multi-window native
interaction were not run in this environment; those platforms share the instance/owner protocol but
retain their recursive OS backend. Network and virtual filesystems still have no accepted
low-frequency polling fallback. Independent external Git-metadata watching for every submodule is
still deferred. If more than 512 previously known absent directories are awaiting exact-path
recreation, later entries rely on another catalog/root hint, focus recovery, or Refresh. After three
consecutive stale-read retries, reconciliation intentionally waits for new evidence rather than
turning contention into a self-sustaining read loop.
