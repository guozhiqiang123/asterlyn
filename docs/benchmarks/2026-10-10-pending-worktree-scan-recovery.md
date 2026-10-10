# Pending worktree scan recovery — 2026-10-10

## Accepted behavior

- Completing an internal reconciliation barrier cannot leave the canonical repository snapshot
  permanently in `untrackedState: "pending"`. If the transition did not start its own replacement
  scan, `WindowSession` schedules one silent, same-generation supplement after the barrier settles.
- An explicit replacement scan cancels the scheduled fallback, while repeated requests for the
  same root and generation share the in-flight completion instead of restarting native Git work.
- When **Update Current Project** is blocked only by the pending untracked supplement, the same
  activation waits asynchronously for that shared scan, promotes a reused silent scan to visible
  progress, and re-evaluates Update. A manual Changes refresh is no longer required. Other blockers
  and Push do not start this recovery path.

## Verification

- `npm run check` — passed.
- `npm run test:scripts` — 939 passed, 0 failed, including cancelled-scan recovery, in-flight scan
  reuse, same-activation Update, non-scan blocker, and watcher barrier coverage.
- `npm run build` — passed; main application chunk 434.96 kB raw / 96.05 kB gzip.
- `cargo test -p asterlyn-git` — 134 passed, 0 failed.
- `npm run test:native:rendered` — the release executable rendered the application shell within
  the six-second bound.
- The macOS bundle passed strict deep signature verification after local ad-hoc hardened-runtime
  signing. Archive:
  `target/release/bundle/macos/Asterlyn-pending-worktree-scan-20261010-160641-macos-arm64-signed.zip`
  (9,264,507 bytes; SHA-256
  `9db2c556b6452c0ef529ef18a733556e46bb982f4b12eb687361d15f3eeba49a`).
- `/Applications/Asterlyn.app` was replaced through a recoverable backup and relaunched. Its
  executable SHA-256 matches the accepted bundle:
  `2fb6765e5c8f07b9c8224e9a648a8092047650a70f27358b999c51c6d0f6e58c`.
