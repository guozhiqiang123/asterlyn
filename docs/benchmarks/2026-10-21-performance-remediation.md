# Performance remediation evidence — 2026-10-21

This record closes the implementation plan in
[`docs/engineering/2026-10-21-performance-remediation-plan.md`](../engineering/2026-10-21-performance-remediation-plan.md).
Measurements were taken on an Apple M2 Pro with 16 GiB RAM, macOS Darwin 24.6.0, Node 26.8.1,
and Rust 1.97.1. Timings are local reference-host results rather than cross-device guarantees.

## Results

| Area | Baseline behavior | Implemented behavior | Evidence |
| --- | --- | --- | --- |
| Search index | JSON encoded every Bloom word as a decimal integer, cloned the full map before writing, and retried an unchanged failed snapshot on later searches. | Schema 2 stores the 4,096-bit signature as unpadded Base64, serializes a borrowed index, and suppresses retry until its mutation revision changes. | A valid 100,000-entry worst-case fixture serializes to **84,689,031 bytes (80.77 MiB)**, below the 128 MiB cache limit, and round-trips as 100,000 valid entries. |
| Files tree | Catalog construction sorted twice; initial render flattened twice; scroll handling recursively flattened again; path lookups scanned the tree or file array. | Tree construction sorts once. Node/file maps and visible rows are cached until catalog or disclosure identity changes, and render receives the cached rows. | A 100,000-file fixture built in **112.03 ms**, projected 101,001 visible rows in **7.83 ms**, and rendered a deep virtual window in **0.77 ms** with **92 mounted rows**. Repeated row reads return the same cached array. |
| Installed plugins | Every catalog evidence update stopped and restarted all active isolated plugin processes. | Matching plugin ID/version/package-digest sessions survive evidence refresh; removed, disabled, changed, or unhealthy sessions are released. Workspace and preference transitions retain full reactivation. | Runtime and composition tests observe **one activation total and zero deactivations** across a changed evidence snapshot. |
| Git history | Ten sequential pages caused ten backend growing-prefix history queries; duplicate count requests ran independently. | A bounded geometric prefix cache slices contained pages and coalesces identical in-flight count reads. Offset-zero refresh replaces the prefix. | Ten 150-row pages load prefixes **[600, 1,200, 2,400]**: three backend loads instead of ten. Refresh performs one new 600-row load. |
| Text editor | A 2 MiB single-character edit copied the normalized text, scanned from byte zero, recomputed all line-ending counts, encoded the full document, then notified the session. | CodeMirror ranges update only affected separator metadata and cached LF/CRLF counts. Animation-frame notifications carry dirty/version state; full text is serialized only for save, preview, capture, or explicit content access. | The earlier baseline measured **17.3 ms median / 25.2 ms P95** for apply-and-encode. The new 2 MiB, 77,673-line edit path measured **0.006 ms median / 0.017 ms P95** for document update, separator bookkeeping, and dirty comparison. |
| Task output | stdout and stderr each had a 2 MiB allowance, permitting 4 MiB total; native reads used 16 KiB frames; the frontend copied the retained frame array on every event. | Both streams claim one atomic 2 MiB budget, native reads use 64 KiB buffers, live frames append to one bounded buffer, and terminal state publishes one frozen snapshot. | A 4 MiB dual-stream fixture delivered exactly **2,097,152 bytes**, reported the remainder as truncated, and used **32 output events** on the reference host. The frontend test confirms one live array and one terminal snapshot. |

## Validation

- `npm run check` passed.
- `npm run build` passed; the production build transformed 687 modules.
- `npm run test:scripts` passed after the implementation fixes.
- `cargo fmt --all -- --check` passed.
- `cargo test --workspace` passed; tests that require live OS watchers or released plugin packages remained explicitly ignored by their existing contracts.
- `cargo clippy --workspace --all-targets -- -D warnings` passed.
- `git diff --check` passed.

## Remaining limits

The 100,000-file tree build is still synchronous and costs about 112 ms on the reference host, but
it now runs only when the semantic catalog changes. Moving initial construction to a worker remains
reasonable if real projects repeatedly hit the 100,000-entry ceiling.

The history cache deliberately retains the repository's existing prefix-query implementation to
preserve all-ref, primary-HEAD, and submodule ordering. It reduces ten page reads to three backend
loads, but a very deep first traversal still rematerializes geometrically larger prefixes.

Split Markdown preview still requests serialized content because the preview consumes the full
document. Ordinary source editing and non-preview text tabs use the incremental path.
