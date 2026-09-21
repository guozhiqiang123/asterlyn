# Project-root header context target and Files tally evidence

- **Date:** 2026-09-21
- **Status:** locally built, signed, and installed; interactive menu acceptance is a manual step
- **Scope:** Files navigator header identity, workspace-root context target, root-protected folder menu, and removal of the Files workspace file tally

## Accepted behavior

- The Project Files navigator header presents the project name alone. The shared panel count host is
  hidden while Files is active, its text and tooltip are cleared, and the same host is restored with
  its own changed-entry total when the Changes tool renders. Project Files folder rows no longer carry
  a recursive file count; the Changes tree and the commit-detail trees keep their existing counts
  because those numbers describe a change set rather than the workspace.
- The same header is the workspace-root context target. A right-click anywhere on the Project Files
  header except its own control cluster — the Files toolbar buttons and the Hide action — opens
  exactly the Files folder menu: same groups, item order, labels, and availability semantics for
  the authorized workspace root. The header is deliberately not a keyboard tab stop in this slice, so
  the existing `Shift+F10` path stays scoped to tree rows. The delegated binding
  resolves the header through a dedicated `data-project-root` attribute and an
  `exclude: "[data-navigator-header-controls]"` subtree, and the root target carries an
  empty workspace-relative path, so no synthetic tree row is introduced.
- Root protection rules are explicit. **New File…** and **Paste** stay available; **Cut**, **Copy**,
  **Rename…**, and **Move to Trash…** are semantically unavailable with the localized reason "The
  project root cannot be moved, renamed, or deleted here"; **Git History** stays unavailable because
  the current query protocol has no exact repository-relative expression for the workspace root.
  **Reveal in File Manager** opens the authorized workspace root, and **Copy Path** reports the
  project folder name, `.`, and the authorized absolute workspace root.
- Creating at the root renders the inline name form as the first row of the tree body, because the
  root owns no tree row to anchor it. Submission, validation, cancel-on-blur, post-create selection,
  and the optional created-file staging prompt are the shared folder-target behavior.
- The native host now resolves an empty workspace entry path to the canonical authorized workspace
  root for a directory reveal only; a file reveal, a relative escape, and every other empty-path
  operation remain rejected.

## Automated evidence

| Gate | Result |
| --- | --- |
| TypeScript check | passed |
| Complete frontend/delivery script suite | 574 passed |
| Production frontend build | passed; startup chunk remains inside its enforced budget |
| Focused header tests | host id resolution, Files tally suppression, Changes tally restoration, and root-trigger release passed |
| Focused binding wiring test | the Files delegated binding declares the root-header selector and the excluded header-control subtree |
| Focused target/policy tests | root context target, root copy-path text, root menu ordering, create/paste availability, and blocked move/rename/trash/history passed |
| Focused view test | the workspace-root creation form leads the tree body while folder rows render no count |
| Rust host test | `an_empty_workspace_entry_path_addresses_only_the_authorized_root_directory` passed |
| Ownership gates | `src/app.ts` 8,774 lines against its 8,781-line reviewed ceiling; `src/localization/en-US.ts` 830 lines at its ceiling |
| Native smoke | the installed binary remained alive for the full 6,000 ms observation window |
| Bundle signature | ad-hoc with hardened runtime, identifier `dev.asterlyn.desktop`, `codesign --verify --deep --strict` valid on disk |

`cargo test -p asterlyn --lib` reported 53 passed, 2 ignored, and 4 failures in
`application::workspace_mutation::tests`. Those four failures are pre-existing and macOS-specific:
the test helper stores `Workspace::open(root).root()` (canonical, `/private/var/...`) while
`start_execution` compares it against the raw `tempfile::tempdir()` path (`/var/...`), so every plan
looks stale. They are unrelated to this change and were reproduced with `--test-threads=1` before and
after it.

## Package

- macOS arm64 app bundle: `target/release/bundle/macos/Asterlyn.app` (21 MB)
- Acceptance archive: `.artifacts/Asterlyn-0.1.0-macos-arm64.zip`, 8,436,190 bytes,
  SHA-256 `54da39a339f0d6ee333a43f278ae7c9d3962f0000e59c1e60c8c455ee38c5ff9`
- Installed executable SHA-256 `271f65f2eb781c9de5768499a59e6abf792585d2e304c17ae7e26f5b2a95cdbf`
  matches the freshly built executable and was smoke-launched from the installed location.
- The replaced installation is preserved at `.artifacts/installed-backup/Asterlyn.app`.
- This is an unsigned, non-notarized ad-hoc preview package for local acceptance. It is not a release
  artifact and makes no Gatekeeper, notarization, or cross-platform claim.

## Performance, memory, and known limits

- The change adds one delegated `contextmenu` selector branch, one timestamp-free header update per
  Files render, and one optional inline form. No latency or process-memory series was run, so
  performance and memory impact are **inconclusive** rather than improved.
- Git History remains unavailable at the workspace root until the Git query protocol and its
  validation can express an exact workspace-root path; the menu does not pretend otherwise.
- Moving, renaming, or trashing the workspace root stays unavailable by design. The inline root
  creation form is positioned at the head of the tree body and is not part of the virtual mount
  budget; a create at the root therefore costs one extra non-virtual row.
- The browser demo cannot perform a real platform reveal, so the native `open` behavior and the final
  menu interaction were accepted through the native smoke launch and remain subject to the user's
  manual verification on the installed package.

## Validation commands

- `npm run check`
- `npm run test:scripts`
- `npm run build`
- `cargo test -p asterlyn --lib`
- `node scripts/smoke-native-app.mjs /Applications/Asterlyn.app/Contents/MacOS/asterlyn`
