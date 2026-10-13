# Hybrid workspace content-index acceptance

Date: 2026-10-13

Repository under test: `/Users/gzq/flutter`

Query: `class BaseFlutterTaskHelper`

## Delivered behavior

- Workspace search now admits the complete authorized catalog up to 100,000 files instead of
  stopping at 5,000 candidates. Kotlin and other less common formats have no extension allowlist.
- The first search reads candidates one file at a time and builds a fixed 4,096-bit lowercase ASCII
  trigram signature plus current file identity. The cache stores no source text or snippets.
- A warm ASCII literal search uses the signature only to reject definite misses. Every possible hit
  is reread and passed through the existing exact matcher. Regex, non-ASCII, and literals shorter
  than three bytes take the complete-scan fallback.
- Entries are trusted only while length, timestamp, read-only state, and platform file identity /
  change metadata still match. Changed, replaced, added, deleted, and newly ignored paths therefore
  scan or disappear through the fresh authorized catalog instead of returning stale matches.
- Binary, invalid UTF-8, and oversized-file skip identities are cached without content and remain
  visible as typed partial coverage. Corrupt, oversized, wrong-root, and unknown-version caches are
  discarded as recoverable misses.
- The desktop keeps at most two repository indexes resident, writes dirty snapshots atomically in
  its private cache directory, and does no indexing during project activation.

## Flutter measurement

The target occurs around authorized-catalog position 13,550, beyond the former 5,000-file boundary.
The measured catalog contained 15,104 files.

| Pass | Files read and matched | Index-pruned | Typed skips | Bytes read | Search | Catalog + search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold | 14,443 | 0 | 661 | 139,836,227 | 2,993.855 ms | 3,292.956 ms |
| Warm, best of two | 234 | 14,209 | 661 | 30,848,297 | 430.368 ms | 579.644 ms |
| Warm, median of two | 234 | 14,209 | 661 | 30,848,297 | 498.527 ms | 661.748 ms |

Both cold and warm passes returned the same exact match. `complete=false` is expected because 661
catalogued files were typed unsupported/binary skips; there was no candidate-limit or byte-limit
coverage loss. The UI denominator counts live reads plus index-pruned candidates and separately
reports typed skips.

- Persisted index entries: 15,104.
- Serialized JSON size: 24,076,854 bytes (22.96 MiB), below the 128-MiB cache-file bound.
- Peak RSS for one cold plus two warm searches: 80,920,576 bytes (77.17 MiB).
- Peak memory footprint reported by macOS: 41,305,600 bytes (39.39 MiB).
- No source terms were present in the persisted-cache regression fixture.

## Correctness and limits

Automated coverage proves cold/warm match equality, definite-miss pruning, stale file refresh,
changed typed-skip refresh, regex fallback, short/non-ASCII fallback, saturated-signature fallback,
fresh Git authorization, source-free persistence, root scoping, corruption recovery, and explicit
candidate/byte/match/cancellation boundaries.

The first broad search is still disk bound. A repository exceeding the 100,000-entry catalog, a
search exceeding the 512-MiB aggregate read ceiling, more than 500 retained matches, or unsupported
files remains explicitly partial. Progressive result streaming remains deferred because the warm
path is sub-second on the accepted Flutter fixture and the current request-cancellation contract
already prevents obsolete results from becoming visible.

## Automated and package evidence

- `cargo test -p asterlyn-workspace`: 76 passed.
- `cargo test -p asterlyn`: 68 passed; two real operating-system watcher probes remain ignored by
  the normal suite and are unrelated to workspace search.
- `npm run test:scripts`: 967 passed.
- `npm run check`, both Rust ownership and frontend ownership gates,
  `cargo clippy -p asterlyn-workspace --all-targets -- -D warnings`,
  `cargo clippy -p asterlyn --all-targets -- -D warnings`, `cargo fmt --check --all`, and
  `git diff --check`: passed.
- The signed production `.app` bundle built successfully and was byte-compared with the installed
  `/Applications/Asterlyn.app`. Version `0.1.5` launched successfully; installed executable SHA-256:
  `cfca33bd485a2e27b49a19623bffd36461c4735e695ae360309179af00d4ea5f`.
- Archived local package:
  `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.5-local-2026-10-13-hybrid-search-index-final.app.zip`
  (SHA-256 `a887a57d8900bdfebd1847609d8de572aa5c0d5522982b57123712ddb8e25572`).
