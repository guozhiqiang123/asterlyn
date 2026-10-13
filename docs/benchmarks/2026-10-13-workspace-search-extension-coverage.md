# Workspace search extension coverage

Date: 2026-10-13

> Historical intermediate evidence. The later
> [hybrid content-index delivery](2026-10-13-hybrid-workspace-content-index.md) removes the
> 5,000-candidate application ceiling while retaining this extension-balancing algorithm as a
> defensive fallback for a future oversized catalog.

## Problem

Workspace text search capped the authorized project catalog at 5,000 entries before applying
Include/Exclude rules. The catalog is path ordered, so large repositories could spend the entire
budget on lexicographically early directories and dominant file types. In the Flutter repository,
Kotlin sources near the end of the catalog were therefore invisible both to default search and to
an explicit `**/*.kt` include.

## Resolution

- Include/Exclude matching now runs before the 5,000-file scan cap.
- Oversized broad searches cover smaller extension groups before uniformly sampling a dominant
  group, so uncommon source formats remain represented without increasing the resource budget.
- Match and skipped-file results are restored to catalog order before presentation.
- The existing 5,000-candidate, 64 MiB, 500-match, cancellation, and workspace-authorization
  bounds remain unchanged.

## Real-repository evidence

Repository: `/Users/gzq/flutter` (15,104 authorized files, 59 Kotlin files).

Query: `class BaseFlutterTaskHelper` in a Kotlin source around catalog position 13,550.

| Scenario | Before | After |
| --- | ---: | ---: |
| Default workspace search | 0 matches | 1 match; 4,945 files read; 30,476,232 bytes; about 3.42 s |
| Include `**/*.kt` | 0 matches | 1 match; all 59 eligible files read; 365,220 bytes; about 0.28 s; complete coverage |

The default search remains explicitly partial when the candidate or byte bound is reached. The
explicit Kotlin include is complete because filtering reduces the eligible set below the cap.

## Automated and package evidence

- `cargo test -p asterlyn-workspace`: 68 passed.
- `cargo test -p asterlyn`: 64 passed, 2 native-watcher-only tests ignored by design.
- Focused frontend workspace-search suites: 13 passed.
- `cargo clippy -p asterlyn-workspace --all-targets -- -D warnings`: passed.
- `cargo fmt --check --all`, `git diff --check`, and the production frontend/Tauri build: passed.
- Fresh macOS application installed at `/Applications/Asterlyn.app`, version `0.1.5`, and launched
  successfully. Installed executable SHA-256:
  `61d361412808167616c2df501251a2ce05f1d7553c8cfaa4a63ae19e5b2cf62a`.
- Archived local package:
  `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.5-local-2026-10-13-search-kotlin.app.zip`
  (SHA-256 `8053ab68d648010713a3110eb9442b5ce338903dba256a159a36f1f9bba26764`).
