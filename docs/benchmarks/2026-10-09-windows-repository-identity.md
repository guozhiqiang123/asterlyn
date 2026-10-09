# Windows repository identity compatibility

## Problem

On Windows, opening a Git project could fail with `Repository snapshot belongs to another workspace
session.` The workspace boundary returned the operating system's canonical verbatim path (for
example `\\?\C:\project`), while Git's `--show-toplevel` output retained its ordinary path form
(for example `C:/project`). The native layer had already proved that both paths addressed the same
directory, but it emitted the mixed representations to the frontend, where strict session identity
checks correctly rejected them.

## Decision

`GitRepository::open` canonicalizes both the discovered worktree root and absolute Git directory
before storing or serializing either identity. Workspace and repository snapshots therefore share
one platform-native canonical representation on Windows, macOS, and Linux. The frontend keeps its
strict root equality check; weakening session isolation is neither required nor allowed.

## Acceptance evidence

- The new native regression requires the repository root, Git directory, and serialized tracked
  snapshot identities to equal `std::fs::canonicalize` results; it passed together with all 135
  `asterlyn-git` tests.
- Rust formatting and focused Clippy checks passed. Frontend type checking and the production build
  passed.
- A fresh macOS native package passed strict signature verification and rendered-shell smoke tests;
  the installed binary matched the accepted build byte-for-byte.
- Known limitation: the local acceptance host is macOS, so the fix still needs the next Windows
  package-preview runner and an on-device Windows open-project check before release publication.
