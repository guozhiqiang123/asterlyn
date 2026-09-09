# E2.2b bounded search-refinement evidence

## Scope and decision

This evidence accepts the read-only E2.2b refinement of the E2.1 workspace-search path. The same transient command surface now offers case-sensitive literal or line-local regular-expression matching, comma-separated include and exclude globs over complete workspace-relative paths, and zero to three context lines. Search still begins from a fresh Git-authorized project catalog, owns no index or cache, performs no startup or recurring work, and has no workspace-wide replacement action.

The local machine and toolchain match the [`E2.1 evidence`](2026-09-09-e2-1-navigation-search.md): Deepin 23.1 on Linux 6.12, AMD Ryzen 5 3600X, 19 GiB RAM, Rust 1.98.1, Node.js 24.19.0, and Git 2.47.2. The current checkout contained 164 catalog candidates, three more than the E2.1 comparison checkout.

## Contract and functional evidence

- `asterlyn-workspace` retains the old literal entry point and adds an options-bearing search entry point. Default options keep the case-sensitive `memchr` path. Rust `regex` supplies Unicode, leftmost-first, non-overlapping, line-local expressions; inline flags such as `(?i)` remain available. Zero-width matches are retained as valid positions and the UI gives them a visible caret marker.
- Includes are ORed, an empty include list means every catalog candidate, excludes are ORed and win after inclusion, and filtering preserves the original catalog index used by the desktop mapping. Patterns are case-sensitive and match the complete `/`-separated workspace path, including an initialized submodule prefix. `*` cannot cross `/`; `**` can. Absolute paths, backslashes, parent/current segments, brace expansion, empty entries at the protocol boundary, malformed patterns, and excess bounds fail as invalid search rather than broadening scope.
- Context construction follows the newline-normalized editor document. It requests the matching line plus zero to three lines on each side, caps each preview at 320 UTF-16 units without splitting a Unicode scalar, and leaves the exact unclipped document range available for E1 reauthorization and navigation. A match longer than the preview retains a bounded visible prefix while its exact location remains unchanged.
- Every request identity now includes root, repository generation, request ID, query, mode, ordered include/exclude arrays, and context count. Editing any control cancels an active operation, removes old results, and prevents stale activation. Invalid expressions retain the search surface with a recoverable error.
- Validation passes 17 `asterlyn-workspace` tests, 28 unchanged `asterlyn-git` tests, seven desktop-library tests, and 90 frontend tests. Focused coverage includes Unicode/UTF-16 positions, newline normalization, inline flags, anchors and zero-width matches, scalar-safe long-match clipping, context expansion, full-path and submodule globs, exclude precedence, original candidate indices, invalid option bounds, fresh Git authorization, desktop result mapping, immutable request options, and coverage copy.
- Rust formatting, strict all-target Clippy for the workspace and desktop crates, TypeScript checking, and the production frontend build pass. The release executable also survived the six-second native startup smoke check.

The production-browser journey opened Find in Files by keyboard, entered `src/**`, selected two context lines, enabled regular expressions, and searched `(Browser|Asterlyn)`. It rendered two contextual `src/app.ts` matches, reported four eligible files from nine catalog entries, and logged no warning or error. Changing the query or exclude control immediately removed the previous result set. A second journey rendered ten visible zero-width markers and opened one into CodeMirror without an invalid-range failure. The invalid expression `[` produced an inline recoverable error and no console error.

## Accessibility evidence

The regex toggle exposes a stable accessible name and `aria-pressed` state. Include, exclude, context, result-list, and query controls have explicit names; context uses a native select; results retain listbox/option selection semantics; and zero-width matches have a textual accessible label in addition to their visible marker. Keyboard Enter still runs a new search or opens the selected current result, Escape restores the previous focus through the existing command-surface path, and changing an option restores focus to that option after rerendering.

## Search latency

The release inspection utility rebuilt the Git catalog on every iteration. Each row contains ten warm-filesystem iterations and uses the same 5,000-candidate, 64-MiB, 500-match, two-MiB-per-file, and 320-UTF-16-preview production limits.

| Query and options | Eligible / catalog | Bytes read | Matches | Catalog median | Scan median | Combined median | Combined p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Literal `Workspace`, defaults | 164 / 164 | 1,649,346 | 388 | 6.201 ms | 9.302 ms | 15.629 ms | 18.303 ms |
| Regex `(WorkspaceSearchOptions\|SearchCancellationToken)`, defaults | 164 / 164 | 1,649,346 | 48 | 6.139 ms | 8.435 ms | 14.698 ms | 17.293 ms |
| Literal `Workspace`, include `src/**`, exclude `src/demo.ts`, context 2 | 34 / 164 | 452,468 | 151 | 6.138 ms | 3.356 ms | 9.632 ms | 11.451 ms |

The default path's 15.629-millisecond combined median is 0.279 milliseconds or 1.75% below E2.1's 15.908 milliseconds despite 3 additional candidates, 77,592 additional bytes, and 66 additional matches. That movement is **no material change**, not a speedup claim. The regex and filtered rows establish absolute interactive behavior but are not direct algorithm comparisons because their match counts and scanned bytes differ. The index decision therefore remains **deferred**: this checkout provides no evidence that recurring or startup indexing cost is justified. Reconsider only with representative near-limit repositories and profiling that identifies content scanning, rather than Git catalog construction or rendering, as the dominant delay.

All-candidate literal and regex runs report partial coverage because 50 catalog entries contain NUL bytes. The filtered run is complete because its 34 eligible files are supported UTF-8 text. Intentional path exclusion does not count as partial coverage; the UI separately reports eligible and total catalog counts.

## Build and focused resource movement

| Output | E2.2a | E2.2b | Movement |
| --- | ---: | ---: | ---: |
| CSS | 54.70 kB | 56.17 kB | +1.47 kB / +2.69% |
| CSS gzip | 10.64 kB | 10.90 kB | +0.26 kB / +2.44% |
| Main JavaScript | 557.48 kB | 563.66 kB | +6.18 kB / +1.11% |
| Main JavaScript gzip | 164.41 kB | 166.30 kB | +1.89 kB / +1.15% |
| Main JavaScript source map | 2,148.78 kB | 2,167.85 kB | +19.07 kB / +0.89% |
| All emitted JavaScript | 1,797,976 bytes | 1,804,157 bytes | +6,181 bytes / +0.34% |
| Concatenated gzip stream | 637,431 bytes | 639,224 bytes | +1,793 bytes / +0.28% |

The frontend-size conclusion is **regressed**. The existing greater-than-500-kB main-chunk warning remains open. Regex and glob execution live in the Rust host in the installed application; the larger browser-demo implementation exists only to keep deterministic browser acceptance behaviorally useful.

The rebuilt Linux release executable is 15,641,080 bytes. The last retained native reference is E2.1 at 13,404,160 bytes, making the cumulative E2.1-to-E2.2b movement +2,236,920 bytes or +16.69%. This is also **regressed**, but it cannot be attributed to search refinement alone: no E2.2a native executable measurement was retained, and the comparison therefore includes both the broad syntax-language catalog and E2.2b. An attempted local `regex` feature reduction produced the exact same executable size and was discarded rather than presented as an optimization.

One fresh production-browser tab used the DevTools performance counters without forced garbage collection. The clean welcome page reported 6,800,200 bytes used and 10,051,584 bytes total JavaScript heap with 2,404 DOM nodes. Opening the search surface, configuring regex/path/context controls, and rendering two contextual results reported 8,116,312 bytes used and 13,242,368 bytes total heap with 4,229 nodes. The deltas were 1,316,112 bytes used heap, 3,190,784 bytes total capacity, and 1,825 nodes. This includes the complete modal, controls, deterministic bridge data, and result DOM, and one uncollected run cannot isolate retained search state. The focused memory conclusion is **inconclusive**. No native 60-second process-tree series is repeated for this sub-slice because there is still no startup index or background task; the already-required normalized native series remains a Stage 3 checkpoint gate.

## Limits and next action

E2.2b interaction and correctness are **improved**, default fixture latency is **no material change**, frontend size is **regressed**, and focused memory impact is **inconclusive**. No native package or remote publication is produced for this sub-slice.

Remaining limits are case-sensitive matching by default; inline regex flags rather than a separate case toggle; line-local rather than cross-line regular expressions; at most 4,096 UTF-8 query bytes, 32 include and 32 exclude patterns of at most 256 bytes each, three context lines, 5,000 candidates, 64 MiB read, and 500 matches; comma-separated controls that cannot represent a literal comma in a pattern; no ignored-file search, persistent index, result persistence, symbol search, or workspace replacement; and no installed Windows/macOS interaction evidence. E2.3 recoverable workspace replacement is next, while catalog packaging and normalized native resources remain open for the larger Stage 3 checkpoint.
