# Rebased reference policy

## Purpose

Rebased is a mature reference for information density, Git workflow coverage, navigation patterns, and edge cases. Asterlyn studies these behaviors while remaining an original product.

## What we borrow as product learning

- Tool-window-oriented organization for changes, log, branches, and details.
- Compact rows, clear selection, staged/unstaged grouping, and context-sensitive actions.
- Separation between backend state and frontend/view events.
- Familiar semantic color roles for selection, added, modified, deleted, warning, and error.
- Workflow completeness checklists: history rewriting, conflict states, worktrees, submodules, remotes, and review.

## Initial visual direction

The M1 dark theme is independently implemented using neutral design tokens informed by the JetBrains New UI palette observed in the local Rebased source:

- deep background `#1E1F22`
- panel background `#2B2D30`
- elevated/hover background `#393B40`
- primary text `#DFE1E5`
- muted text `#9DA0A8`
- accent `#3574F0`
- destructive/error `#DB5C5C`

These values are treated as replaceable tokens, not copied components. Layout, typography, spacing, icons, motion, and wording are authored for Asterlyn.

## What we do not copy

- JetBrains or Rebased source code unless a future, file-specific license review explicitly approves reuse and records attribution.
- Logos, product names, icons, fonts, screenshots, illustrations, bundled themes, or other branded assets extracted from an installed JetBrains or Rebased product.
- Internal APIs or implementation structure merely because they exist in IntelliJ Platform.

A standalone upstream asset is evaluated independently from this reference policy. For example, the publicly distributed JetBrains Mono project may be consumed from a pinned package under its SIL Open Font License; that does not authorize extracting a JBR/IDE font, copying an IDE icon, or treating another bundled asset as reusable.

## Reference method

For each borrowed interaction concept, describe the user problem first, compare at least one alternative, implement an original version, and validate it with task-based testing. Rebased is evidence, not the specification.
