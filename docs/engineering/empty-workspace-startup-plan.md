# Empty-workspace startup plan

## Problem

On first launch, Asterlyn must enter a stable Welcome page without opening the operating system
folder chooser. The folder chooser is a user-initiated action, not part of startup. An empty
workspace must not retain persisted tool-window layout or look like a pending import.

## State contract

`no project` is a stable, ready application state rather than a loading state:

- every project-scoped activity-rail entry is visibly disabled, removed from keyboard focus, and
  cannot be clicked or dragged;
- no activity entry remains selected, both project tool windows are hidden, and no indefinite
  progress indicator is presented;
- the Welcome editor presents one primary `Open a project folder` action that invokes the existing
  native directory chooser;
- cancelling the chooser leaves the same ready state intact, while selecting a directory continues
  through the existing current-window/new-window and project-open flows;
- the project switcher and Settings remain available because they are valid without a workspace.

An ordinary non-Git folder is still an open workspace: Files, Search, and Terminal are enabled, while
Git-only activity entries remain unavailable under the existing capability policy.

## Implementation plan

1. Make startup restore a valid recent project when available, but remain on Welcome when there is
   no recent project or the remembered project is stale; never open the chooser automatically.
2. Make the shell renderer derive activity selection from capability, emit native `disabled`
   semantics, and keep both persisted tool-window regions hidden when no workspace is open.
3. Add a reusable actionable editor empty state and render it only for the no-project Welcome
   document; bind its button to the existing repository chooser.
4. Make cancellation explicitly refresh the empty-workspace presentation so later chooser paths
   cannot leave stale loading or selection state behind.
5. Update unavailable-control styling to remove hover, pressed, drag, and focus affordances.
6. Add startup and renderer regressions for the no-project, ordinary-folder, and Git-workspace
   capability states, plus a source-level interaction check for the Welcome action.

## Acceptance

- Fresh-profile launch shows the ready Welcome page without opening the native directory chooser.
- The left and bottom project tool windows are hidden, with all six activity entries disabled and
  none highlighted.
- The Welcome page shows a primary `Open a project folder` button.
- Activating `Open a project folder` reopens the native chooser.
- Pressing Cancel returns to the same ready Welcome page with no spinner.
- Selecting either an ordinary folder or Git repository restores the existing capability-aware
  activity behavior.
- Type checking, frontend tests, production build, packaged-app signature verification, and a
  rendered installed-app smoke check pass.

## Result

Implemented and accepted on 2026-09-30. A fresh installed profile opened directly to the stable
Welcome page with no native chooser or loading indicator. Both project tool-window regions were
hidden, all six project activity entries were disabled with no selected entry, and the primary
`Open a project folder` button was visible. Activating that button opened the native directory
chooser; cancelling it returned to the same stable Welcome page.

The complete 778-test frontend suite, TypeScript checking, production frontend build, macOS release
bundle, native rendered smoke, strict deep signature verification, installed-executable identity
check, and installed-app interaction acceptance passed. The arm64 archive is
`target/release/bundle/macos/Asterlyn-empty-welcome-startup-20260930-macos-arm64.zip` (9,032,287
bytes; SHA-256 `110593b4a2378f5cebaa0f60187ec4c676358c0e476a5b6b8de585b8a93a6a66`).
The replaced application remains recoverable from
`/Users/gzq/.Trash/Asterlyn-before-empty-welcome-startup-20260930-162623.app`.
