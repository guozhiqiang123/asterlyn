# Quick Open input-latency correction

## Scope and cause

This acceptance step corrects the `Ctrl/Cmd+P` Quick Open input path. The previous implementation
handled every input event synchronously by rebuilding the complete command-surface DOM, rebinding
all controls, reparsing repository-scoped recent-file storage, lowercasing and deduplicating the
complete project catalog, sorting every matching file, restoring focus, and scheduling selection
reveal. A 36,000-file catalog could therefore spend multiple frames on one character and rapid
input queued repeated obsolete work.

The corrected path retains the mounted dialog and native input. Files, Recent Files, and Commands
coalesce input bursts to the latest animation frame and replace only result-list children. IME
composition does not rank intermediate composition states. Arrow selection changes only two rows.
Git-status-only reconciliation cannot rebuild the search surface.

Quick Open now owns one in-memory projection per exact window/catalog identity. It normalizes and
deduplicates paths once, preserves the catalog's backend-sorted default order, and uses a bounded
max-heap to retain only the best 100 non-empty-query matches. Opening a file still uses the original
root-qualified `ProjectFile`; the projection grants no additional path authority.

## Functional validation

- The focused navigation tests include a result-limit fixture whose exact, prefix, and substring
  matches arrive after 500 weaker candidates. It proves that bounded ranking does not discard a
  later better match.
- All 351 frontend script tests pass, including navigation, stale search identity, replacement,
  watcher reconciliation, localization, and editor lifecycle coverage.
- TypeScript checking and the production build pass.
- A browser interaction entered `r`, `re`, then `repo` without dismissing or defocusing the input,
  presented the final `repository.rs` result, and opened it with Enter.
- The release desktop executable remained alive for the full 6,000-millisecond native smoke
  interval.

## Ranking latency

The comparison used Node.js 24.19.0 on Deepin 23.1/Linux 6.12.20 with one deterministic synthetic
catalog of 100,000 unique paths and the production 100-result limit. Each query had seven legacy
samples before the correction and nine indexed samples after it. Values are warm-process ranking
time and exclude DOM work. The old path rebuilt all temporary ranking state on every sample; the
new path built one projection in 123.50 ms before the measured repeated queries.

| Query | Previous median | Current median | Normalized change | Conclusion |
| --- | ---: | ---: | ---: | --- |
| Empty | 445.59 ms | 0.02 ms | -99.995% | improved |
| `c` | 100.48 ms | 5.74 ms | -94.29% | improved |
| `component` | 106.78 ms | 6.60 ms | -93.82% | improved |
| `component-999` | 89.38 ms | 28.66 ms | -67.93% | improved |

The hardest sparse-subsequence query remained below 35 ms in all nine current samples. Input work
is additionally frame-coalesced, so superseded characters no longer each force a ranking pass or
complete-dialog render. Interaction latency is **improved**. The one-time 100,000-file projection
cost is still synchronous and may be visible when Quick Open is first opened on an extreme
catalog; it is not paid per character.

## Memory and output movement

A separate `--expose-gc` probe retained the 100,000-file projection after collecting the source
catalog and measured 17,133,704 bytes (16.34 MiB) of additional JavaScript heap. Twenty distinct
searches left 78,192 bytes beyond that indexed state after collection. This synthetic maximum is
approximately 4.5 times the 36,922-entry catalog that exposed the defect, but it is not a native
WebKit process-tree measurement. The memory conclusion is **regressed but bounded**: one active
window retains one projection, catalog replacement releases the old projection, and searches do
not accumulate result arrays.

| Output | Previous | Current | Normalized change | Conclusion |
| --- | ---: | ---: | ---: | --- |
| Startup JavaScript | 517,172 B | 521,234 B | +4,062 B / +0.79% | regressed |
| Startup JavaScript via `gzip -c` | 119,673 B | 120,611 B | +938 B / +0.78% | regressed |
| Main CSS | 121,611 B | 121,611 B | 0 B / 0.00% | no material change |
| Native executable | 22,763,040 B | 22,765,920 B | +2,880 B / +0.01% | no material change |
| Debian package | 8,023,596 B | 8,027,164 B | +3,568 B / +0.04% | no material change |

The local unsigned acceptance package is:

- Path: `target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`
- Size: 8,027,164 bytes
- SHA-256: `564d9619810934f338514467f387d04255ed3feb06b6d8e8ea1807fedd49a039`

## Limitations and next action

This correction deliberately does not add a disk index, worker, fuzzy-search dependency, or
background catalog scan. Workspace text search keeps its independent cancellable lifecycle and
complete-surface loading controls. If installed macOS evidence still finds a visible first-open
pause on a near-limit catalog, the next measured step should build the same product-neutral
projection incrementally or in a lazy worker; it should not restore per-keystroke sorting or retain
unbounded match sets.
