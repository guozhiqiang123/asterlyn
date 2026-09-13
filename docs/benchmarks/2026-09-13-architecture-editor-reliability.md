# Architecture and editor reliability acceptance — 2026-09-13

## Scope and environment

The architecture review's ten numbered defects and the reported retained-file activation / repeated
refresh bugs are addressed in the working tree based on `7a68bad`. This change retains Rust, Tauri,
CodeMirror, system Git, and independent Git/Workspace domain crates. It also corrects tree ARIA
hierarchy, preserves text tabs across branch/Update changes, and guards unsaved conflict results.
R5 create/move/copy/trash and general unsaved-draft crash recovery remain roadmap work.

Local environment: macOS 14.1.2 (23B92), Apple Silicon, Node 24.19.0, Rust 1.98.1, system Git 2.39.3.
Rust was installed into a task-local toolchain. Frontend dependencies follow the committed npm
lockfile. No new third-party package versions were added; serde_json, sha2, and tempfile are reused
at the desktop application boundary. The source changes are uncommitted.

## Correctness evidence

| Gate | Result |
| --- | --- |
| `npm run check` | Passed |
| `npm run test:scripts` | 283 passed |
| `cargo test --workspace --locked` | Git 66, Workspace 29, desktop library 32 passed; 2 native tests run separately |
| Desktop library after final recovery checks | 32 passed |
| `cargo test --locked -p asterlyn --lib native_backend -- --ignored` | Both native watcher tests passed |
| `cargo clippy --workspace --locked --all-targets -- -D warnings` | Passed |
| `cargo fmt --all -- --check` and `git diff --check` | Passed |
| Tauri production build, including `npm run build` | Passed, macOS app bundle created |
| `codesign --verify --deep --strict` | Passed for the ad-hoc signed local bundle |

Regressions cover reactivation of an already loaded dirty document; mounted view/load-epoch
mismatch; explicit tab capture during synchronous activation; repeated equivalent catalog/status
snapshots preserving disclosure and tree identity; watcher reconciliation after unrelated operation
generations advance; backend activation and catalog completion after A/B/A and window close; shared
workspace/Git write serialization; literal pathspec names; bounded catalog parsing; late writes and
precommit I/O failure; stale Restore confirmation despite unchanged porcelain flags; exact
worktree/index undo after service restart; refusal to overwrite later file/index changes; conflict
EOL/ident conversion; failed staging retaining original/index/proposed-result bytes; and hard-link
rejection. Additional controller tests cover Review validity, unsaved conflict close protection,
external operation completion, and whole-worktree reconciliation with a missing open file.

The native feedback-loop test performs three real Git snapshots, observes 1.5 seconds without an
invalidation, then writes externally and requires an open-document invalidation. Optional Git index
refresh locks are disabled, while real mutations retain mandatory locking. Access/read and
access-time-only events are excluded. The other native test originally assumed every OS emits an
exact file path. FSEvents returned root-creation plus file events, which correctly broadened the
hint and cleared exact paths; its assertion now accepts that documented full-reconciliation case.

The final Browser Demo exercised README → roadmap → README content switching, multiple Markdown
files and Split mode, folder collapse, valid Review input retaining focus, clearing input disabling
Review, and the lazy recovery dialog's labelled empty state and initial Close focus. Demo uses no
native filesystem bridge; actual file/Git/recovery behavior is covered by the Rust fixtures.

## Resource evidence

The production startup JS is 476.50 kB (gzip 116.59 kB), compared with the review build's 469.58 kB
(gzip 114.78 kB). Shared CSS is 103.93 kB (gzip 23.78 kB). The recovery dialog remains a lazy module.
The final frontend build took 522 ms; incremental native release compilation took 34.76 seconds.
These are build observations, not user-interaction latency measurements. The pre-existing Tauri
event static/dynamic import warning remains non-fatal.

The release `asterlyn-git` inspection example queried this working tree ten times (59 changes,
144 commits, 3 refs at measurement). Tracked snapshot median/p95 was 81.121/96.971 ms; deferred
untracked median/p95 10.436/13.038 ms; combined median/p95 91.560/109.720 ms. `/usr/bin/time -l`
reported 5,816,320 bytes maximum RSS for the inspection run, 1.44 seconds wall time, 0.48 seconds
user CPU and 0.34 seconds system CPU. This measures the command-line read path, not the desktop
WebView/process-tree memory or idle CPU. No before/after desktop resource comparison is claimed.

Producer bounds now apply during reads: Git stdout 64 MiB and diagnostic stderr 64 KiB; catalog
stream 16 MiB with 32 KiB records and a bounded candidate count; ordinary traversal candidate/name
budgets and depth 64; conflict worktree reads stop at four MiB plus one byte. Active workspace
authorization no longer clones the entire catalog. Recovery bounds and the 512-directory listing
limit are documented in ADR-0008.

## Local artifact

- Bundle: `target/release/bundle/macos/Asterlyn.app`.
- Archive: `/Users/gzq/Documents/Codex/2026-09-13/uf/outputs/Asterlyn-architecture-fixes-macos-arm64.zip`.
- Exact archive size: **7,001,576 bytes**.
- SHA-256: `658d20ce4a1903f4815b5fc041d8428431c92512376b83a5f02e2e538f6d0e8c`.

The archive contains the final compiled source changes. It is a local ad-hoc signed acceptance
build, not a notarized release. The installed Asterlyn application/profile was not replaced.
No Git commit, push, workflow dispatch, publication, or Windows/Linux package acceptance occurred.
Native interactive macOS smoke, VoiceOver, Windows/Linux runtime interaction, large-workspace UI
latency, and desktop memory/idle CPU remain unmeasured in this run.

## Remaining limits and manual acceptance

Recovery is a bounded safety journal. Successful Restore/conflict writes offer guarded Undo;
failed or uncertain operations retain backup files and the proposed result for inspection, without
automatic rollback. Multi-file undo is resumable, not atomic. Portable version-check/rename cannot
exclude a non-cooperating external writer in the final instant, and ACL/xattr preservation remains
unsupported. General unsaved editor/conflict drafts have close protection but no crash journal.

For native manual acceptance, open several Markdown files and switch back to each; leave the
workspace idle and collapse/expand a hovered folder; edit an open clean file externally and verify
one content update; then repeat with an unsaved local buffer and verify it is preserved. In a
throwaway Git repository, Restore a tracked change, restart, use Recover local changes → Undo,
and compare both worktree and staging content. These are next user acceptance steps, not claims
that browser demo exercised a real project.
