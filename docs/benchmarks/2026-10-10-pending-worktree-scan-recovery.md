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
- Branch Switch, remote checkout, and branch creation now treat a clean-tree check in `pending`
  state as recoverable rather than permanently disabled. The invoked action awaits the shared scan,
  re-resolves the exact branch from the current snapshot, and continues from the same click only
  when the complete working tree is still clean. Failed scans, changed workspaces, and stale branch
  targets fail closed.
- Native untracked discovery has a 30-second process timeout, while the window session has a
  35-second watchdog. Cancellation and watchdog expiry resolve every waiter immediately, mark the
  supplement failed, and reject late native results instead of leaving branch or remote actions
  suspended for minutes.

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

## Branch-mutation timeout follow-up

- `npm run check`, `npm run build`, and `cargo test --workspace` passed.
- `npm run test:scripts` passed 945 tests, including scan-watchdog waiter release, pending branch
  recovery, branch target re-resolution, failed-scan rejection, and the frontend ownership budget.
- The packaged and installed executables both rendered the application shell within the six-second
  native-smoke bound. The arm64 app passed strict deep signature verification with an ad-hoc
  hardened-runtime signature.
- Accepted archive:
  `target/release/bundle/macos/Asterlyn-branch-scan-recovery-20261010-172207-macos-arm64-signed.zip`
  (9,266,140 bytes; SHA-256
  `e41bbf5e4ad325269e574d5c49db178e5a2069057ba9d6a616d5e4898b0f115d`).
- `/Applications/Asterlyn.app` was replaced and relaunched at version 0.1.3. Its installed arm64
  executable is 24,163,024 bytes and exactly matches the packaged executable (SHA-256
  `9fb7961fb0a60184bbffec04f5bb3a715fdcc9efa02aee01be71b75a0eda0c89`). The previous installation
  remains recoverable at
  `/Users/gzq/.Trash/Asterlyn.app.backup-branch-scan-recovery-20261010-172207`.
