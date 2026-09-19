# CM4 reviewed multi-Revert acceptance — 2026-09-19

## Outcome

The existing reviewed Git-operation lifecycle now accepts one to 100 exact Revert targets in an
explicit order. The plan binds the repository root, local branch, starting `HEAD`, complete target
reference/object lists, target count, and review token. Execution re-resolves the same ordered
targets and rejects a changed plan before mutation.

Multi-Revert uses Git's own sequencer. When a later target conflicts, Asterlyn reconstructs the
operation after restart from the sequencer, index stages, sequencer starting head, and the current
first-parent distance. This recovers total progress without a parallel repository-state database.
Continue and Abort retain their previous semantics; Skip is exposed for Revert only when Git truth
shows a multi-step sequence. A conflicting single Revert therefore remains Continue/Abort only.

Merge commits remain rejected until an explicit mainline-parent review is designed. Every target is
checked before planning, so a merge anywhere in a multi-selection blocks the whole plan.

## Acceptance evidence

| Check | Result |
| --- | --- |
| `cargo test -p asterlyn-git` | 81 passed |
| Ordered success scenario | newest-to-oldest targets created two Revert commits in reviewed order |
| Conflict/restart scenario | first target completed, second conflicted, restart recovered 2/2 progress and allowed Skip |
| Single-target regression | conflicting single Revert still excludes Skip and remains abortable |
| Merge safety | merge targets still fail with an explicit mainline-parent reason |
| `cargo clippy -p asterlyn-git --all-targets -- -D warnings` | passed |
| `cargo check -p asterlyn-desktop` | passed |
| Rust formatting and whitespace checks | passed |

## Known limits

- The H2 provider must still prove that a visual range is a complete, non-merge first-parent segment
  before it opens this reviewed operation with newest-to-oldest targets.
- Asterlyn does not yet offer a mainline-parent selector for merge Revert.
- The Linux host lacks the WebKit/GTK development packages needed for a complete Tauri-shell build;
  the product-neutral desktop adapter and Git core are covered here.
