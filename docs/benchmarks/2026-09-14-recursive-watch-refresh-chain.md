# Recursive workspace refresh-chain correction — 2026-09-14

## Scope and observed failure

Manual macOS evidence showed a large project catalog completing near 96,488 entries and then
returning to `Refreshing files...`; the visible count advanced to 96,493 while the loading state
continued. The equivalent Linux run reached the static bounded-catalog notice instead. The recording
did not show a presentation-only animation: native invalidations continued to schedule catalog work.

The event path was audited from the native watcher through typed invalidation, the workspace-watch
coordinator, the Files controller, and the project-tree view. No render function called Refresh.
Instead, two producer defects could overlap:

- macOS and Windows watched the workspace recursively and admitted create, remove, and rename events
  below ignored build and dependency trees. Every such membership event invalidated the complete
  bounded project catalog. Events arriving during the scan were retained for another reconciliation,
  so sustained generated-file churn could keep the loading state alive indefinitely.
- The Files controller did not merge concurrent same-root reads. A valid watcher hint, focus recovery,
  and explicit Refresh could therefore start duplicate full scans even though each individual
  coordinator serialized its own pending work.

Linux already registered only the root and catalog-derived parent directories non-recursively, which
explains the platform difference.

## Correction and invariants

The native recursive adapter now filters workspace event paths through the live catalog-derived
parent-directory plan before event coalescing. Git metadata paths, the workspace root, top-level
membership changes, and events directly below authorized catalog directories remain observable.
Deep events below excluded generated or ignored trees cannot schedule catalog reconciliation. A
catalog completion can extend the shared directory plan without replacing the native subscription.

The Files controller now owns one in-flight catalog promise per active root. Every concurrent caller
receives that same result; a workspace transition still starts an independently generation-guarded
read, and stale completion cannot install data into the new workspace. This is a second safety
boundary rather than a substitute for typed reconciliation.

## Validation evidence

| Check | Result | Interpretation |
| --- | --- | --- |
| Focused Files/watch tests | 12 passed | Same-root callers share one read; catalog identity, disclosure, stale-root rejection, and typed reconciliation remain intact. |
| Frontend script suite | 327 passed | No broader controller or interaction regression was detected. |
| Rust workspace | 133 passed, 2 native-host tests ignored by default | Event mapping, repository behavior, workspace reads, and application integration remain green. |
| Explicit native-host watcher tests | 2 passed | The Linux watcher reaches idle after Git reads and still reports a later real external edit. |
| TypeScript and production build | passed | The frontend compiles and emits a production bundle. |
| Rust formatting and strict all-target Clippy | passed | The native implementation satisfies formatting and warning gates. |

The new mapper fixture drops `build/generated/output.bin` when only the workspace root and `src`
belong to the directory plan, while retaining `src/new.rs` and a new top-level `README.md`. The
controller fixture starts two concurrent refreshes and observes exactly one gateway read and one
shared completion.

## Artifact and resource interpretation

The local Debian package moved from 7,547,672 bytes to 7,552,196 bytes, an increase of 4,524 bytes
(approximately 0.06%). Artifact size is therefore **regressed negligibly**. No matched CPU, memory,
or macOS FSEvents latency series was run, so those resource dimensions are **inconclusive**. The
change adds no timer, worker, dependency, or additional steady-state read; it removes work from the
recursive event path and coalesces duplicate reads.

The manual-acceptance package is
`target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`, 7,552,196 bytes, with SHA-256
`3e93a1bab6adc52bc97e84a3cd4e5160c44c1435f90be608ca8309fc1264be30`.

## Conclusion and remaining acceptance

The producer-side refresh lifecycle is **improved** and locally accepted: ignored deep-tree churn no
longer enters recursive workspace reconciliation, concurrent same-root catalog reads are bounded to
one, and real authorized edits remain observable. Installed macOS acceptance is still required to
confirm that the original large-project spinner reaches the static bounded-catalog notice under the
actual FSEvents delivery shape. Windows shares the corrected recursive path but also remains pending
installed-package acceptance. If either platform still repeats, the next evidence must capture the
normalized event paths and causes rather than adding polling or suppressing all membership events.
