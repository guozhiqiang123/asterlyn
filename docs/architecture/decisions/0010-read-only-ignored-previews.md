# 0010: Read-only previews for Git-ignored files

## Status

Accepted on 2026-09-13 and superseded in part by decision 0017 on 2026-09-23. Decision 0017 removes
the read-only restriction while retaining bounded ignored-file enumeration and watcher containment.
This decision originally superseded the ignored-entry boundary described in decisions 0003 and
0004 where ignored paths were display-only and ignored directories were opaque.

## Decision

The bounded project catalog carries two distinct file capabilities. Tracked and non-ignored
untracked files remain writable project files. Git-ignored files are enumerated individually and
carry a `readOnly` identity. The Files tree derives ignored directory nodes from those file paths,
so expanding an ignored directory reveals its descendants without an additional filesystem walk.

An active window installs both identity classes in its session catalog. A text or image read first
requires that exact catalog identity, then asks Git to confirm that a read-only identity is still
ignored and asks the workspace layer to validate non-link traversal and file type. Save rejects a
read-only identity before any write. Search, replacement, commit, and other mutations continue to
build their own tracked-or-non-ignored catalogs and never receive ignored identities.

Ignored paths do not enlarge the native watcher set. This avoids registering generated dependency
trees as live watch roots; explicit refresh and catalog-invalidating parent events remain the source
of membership updates.

## Consequences

- Ignored text and supported images can be inspected from the Files tree but cannot become dirty or
  be saved by Asterlyn.
- Ignored directory contents consume the separate ignored-catalog bound and may be truncated with
  the existing catalog notice.
- The UI must preserve read-only state when a tab is reopened and after global busy state clears.
