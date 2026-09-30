# Empty-workspace startup plan

## Problem

On first launch, Asterlyn opens the operating system folder chooser. Cancelling that chooser leaves
the window without a project, but the initial shell currently presents the Files tool as selected
and shows an indefinite `Waiting for a project` spinner. That makes a completed cancellation look
like a pending import and provides no obvious way to reopen the chooser from the Welcome page.

## State contract

`no project` is a stable, ready application state rather than a loading state:

- every project-scoped activity-rail entry is visibly disabled, removed from keyboard focus, and
  cannot be clicked or dragged;
- no activity entry remains selected and no tool-window body presents an indefinite progress
  indicator;
- the Welcome editor presents one primary `Open a project folder` action that invokes the existing
  native directory chooser;
- cancelling the chooser leaves the same ready state intact, while selecting a directory continues
  through the existing current-window/new-window and project-open flows;
- the project switcher and Settings remain available because they are valid without a workspace.

An ordinary non-Git folder is still an open workspace: Files, Search, and Terminal are enabled, while
Git-only activity entries remain unavailable under the existing capability policy.

## Implementation plan

1. Make the shell renderer derive activity selection from capability, emit native `disabled`
   semantics, and render a static empty navigator when no workspace is open.
2. Add a reusable actionable editor empty state and render it only for the no-project Welcome
   document; bind its button to the existing repository chooser.
3. Make cancellation explicitly refresh the empty-workspace presentation so later chooser paths
   cannot leave stale loading or selection state behind.
4. Update unavailable-control styling to remove hover, pressed, drag, and focus affordances.
5. Add renderer regressions for the no-project, ordinary-folder, and Git-workspace capability
   states, plus a source-level interaction check for the Welcome action.

## Acceptance

- Fresh-profile launch opens the native directory chooser.
- Pressing Cancel returns to a ready Welcome page with no spinner.
- All six activity-rail entries are disabled and none is highlighted.
- Activating `Open a project folder` reopens the native chooser.
- Selecting either an ordinary folder or Git repository restores the existing capability-aware
  activity behavior.
- Type checking, frontend tests, production build, packaged-app signature verification, and a
  rendered installed-app smoke check pass.

## Result

Implemented and accepted on 2026-09-30. The packaged macOS application was launched without a
workspace, the native chooser was cancelled, and the resulting window showed only the Welcome
editor: all six activity entries were disabled, no entry retained selected styling, both project
tool windows were closed, and no loading indicator remained. Activating the new primary Welcome
action opened the native chooser again.

The complete 777-test frontend suite, TypeScript checking, production frontend build, macOS release
bundle, strict deep signature verification, build-tree rendered smoke, and installed-app rendered
smoke passed. The arm64 archive is
`target/release/bundle/macos/Asterlyn-empty-workspace-startup-20260930-macos-arm64.zip` (9,032,250
bytes; SHA-256 `ce64ac28fcdee00fd81538438c247494e1e153acb234d57ed5bad42eff3bccd3`).
The installed executable matched the accepted build byte-for-byte; the replaced application remains
recoverable from `/Users/gzq/.Trash/Asterlyn-before-empty-workspace-startup-20260930-1558.app`.
