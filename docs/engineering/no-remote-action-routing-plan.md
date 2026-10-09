# No-remote toolbar action routing

## Context

The top-bar Update and Push buttons intentionally remain clickable when an action cannot run so the
application can explain the exact reason. A repository with no configured remote currently follows
that generic blocked-action path and only shows a warning. This is a recoverable configuration state:
the existing Git Remotes dialog is the correct next destination.

## Invariants

- When the active Git repository has zero configured remotes, both Update and Push open the existing
  Git Remotes dialog instead of showing an unavailable warning or opening a network-operation dialog.
- Repository loading and an active remote operation still take precedence and remain blocked.
- Repositories with at least one remote retain the existing Update/Push policy, review, and safety
  checks without relaxation.
- The toolbar exposes the no-remote buttons as actionable to accessibility APIs because activating
  them has a valid result.

## Implementation

1. Give the shared remote command adapter one explicit no-remote route that reuses the existing
   remote-management controller for both toolbar actions.
2. Keep the toolbar's operation policy detail as explanatory copy, but do not mark the buttons
   unavailable when their next action is remote configuration.
3. Cover no-remote Update and Push routing, busy/operation precedence, toolbar accessibility state,
   and ordinary configured-remote routing with regression tests.

## Validation

Run the focused remote policy, command-runtime, management-controller, feature-view, and localization
tests, followed by the complete frontend suite, type checking, production build, native Git tests,
release packaging, and rendered installed-app smoke verification.

## Implementation result

- Update and Push now share one no-remote command route to the existing Git Remotes controller. The
  generic blocked warning is retained for real blocked states but is no longer used for missing
  configuration.
- The no-remote toolbar actions remain keyboard and pointer actionable and expose
  `aria-disabled="false"`; loading and active remote operations still take precedence.
- Verified with 933 frontend script tests, TypeScript checking, the production web build, 133
  `asterlyn-git` tests, release packaging, strict signature verification, and rendered smoke checks
  against both the build executable and the installed application.
- The verified application is installed and running at `/Applications/Asterlyn.app`. The prior
  installation is recoverable at
  `/Users/gzq/.Trash/Asterlyn-before-no-remote-routing-20261009.app`.
- Acceptance archive:
  `target/release/bundle/macos/Asterlyn-no-remote-routing-20261009-macos-arm64-signed.zip`,
  9,259,093 bytes, SHA-256
  `4fa49ba6b8c135fcf648e192e6529a6935fa9043d0297b5d71348b74d254b474`.
