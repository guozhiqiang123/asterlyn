# CM4 exact commit-comparison foundation evidence — 2026-09-19

## Accepted boundary

- The comparison identity is an exact repository-qualified pair: `repositoryId`, `beforeOid`, and `afterOid`.
- Both revisions must be distinct full object IDs that resolve as commits. Symbolic refs are rejected.
- Git computes one net rename/copy-aware file range between the two trees. Text and image reads revalidate that the requested current/original path pair belongs to that range.
- The comparison does not consult or modify `HEAD`, the index, or the worktree. Ancestor and divergent pairs use the same read-only contract.
- Text output retains the existing 4 MiB bounded reader and visible truncation marker. Image reads retain the existing binary preview and decoder limits.

## Protocol and adapters

- Added typed details, text-Diff, and image-Diff commands to the versioned desktop protocol.
- Added matching Rust models, Tauri commands, frontend bridge ports, native adapters, demo behavior, generated command types, and runtime result validation.
- The comparison result has a distinct type rather than overloading the single-commit first-parent Diff identity.

## Verification

- `cargo test -p asterlyn-git`: 83 passed. Coverage includes ancestor comparison, divergent comparison, rename identity, rejected non-range paths, rejected symbolic/same revisions, and exact binary sides.
- `cargo clippy -p asterlyn-git -- -D warnings`: passed.
- `cargo check -p asterlyn-desktop`: passed.
- `npm run check`: passed.
- `npm run test:scripts`: 432 passed, including generated protocol parity and comparison result validation.
- `git diff --check`: passed.

## Known limitation at this checkpoint

This commit establishes the native and protocol foundation only. H2 menu routing, the multi-file comparison pane, side swapping, shared Diff documents, keyboard interaction, bundle evidence, and browser acceptance belong to the following presentation checkpoint.
