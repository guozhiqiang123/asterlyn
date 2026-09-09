# E2.1 bounded navigation and search evidence

## Scope and comparison

This evidence accepts the first E2 slice defined by [`ADR-0005`](../architecture/decisions/0005-bounded-navigation-search.md): Quick Open, repository-scoped Recent Files, Command Palette, bounded read-only workspace text search, verified result navigation, and active-file-only CodeMirror replacement. Packaging and remote publication remain deferred to the larger Stage 3 checkpoint.

The local machine ran Deepin 23.1 on Linux 6.12 with an AMD Ryzen 5 3600X (6 cores, 12 logical CPUs) and 19 GiB RAM. Tool versions were Rust 1.98.1, Node.js 24.19.0, and Git 2.47.2. The comparison repository was the current Asterlyn checkout.

## Functional and safety evidence

- 13 `asterlyn-workspace` tests cover exact and over-limit files and queries, case-sensitive combining sequences, non-BMP UTF-16 positions, CRLF and bare-CR normalization, scalar-safe preview clipping, non-overlapping matches, every parameterized coverage bound, typed unsupported-file accounting, pre-cancellation, and rejection of a catalogued symlink to an external target.
- 28 `asterlyn-git` tests remain green.
- Seven desktop tests cover the active-root boundary, fresh Git search authorization, revocation of an old result before its E1 read, search supersession, exact cancellation, registry cleanup, and the existing optimistic save boundary.
- 83 frontend script tests cover command ranking, repository-scoped Recent Files, stale search-response identity, complete and partial coverage copy, fresh reload epochs, repository-session replacement, dirty/stale/wrong-root navigation rejection, and the existing editor and Git workbench behavior.
- Rust formatting, strict all-target workspace Clippy, TypeScript checking, and the production frontend build pass. The current native debug executable remained alive for the complete 6,000-millisecond smoke interval.

The deterministic browser journey exercised all four modes through `Ctrl/Cmd+P`, `Ctrl/Cmd+E`, `Ctrl/Cmd+Shift+F`, and `Ctrl/Cmd+Shift+P`; keyboard selection and command execution; accessible input names and selected-tab state; Escape cancellation and focus restoration; and workspace-result selection in CodeMirror. Reopening the same result forced a fresh E1 read. A dirty target retained its buffer, left the result surface open, and displayed a warning. Active-file Replace All marked only the visible CodeMirror buffer dirty, performed no automatic save, and one undo restored the text.

A read-only architecture review found no proven blocking defect but requested direct evidence for old-result authorization revocation, tracked-link containment, repository replacement during a late read, combining text, and honest partial-coverage copy. Those checks were added before acceptance. Mid-scan cancellation is polled at most every 64 KiB of matching work, but deterministic scheduling of cancellation inside one chunk is not separately test-injected.

## Search latency

The release inspection utility recreated the Git-authorized candidate catalog and performed the complete bounded scan on every iteration. Ten iterations used the case-sensitive literal `Workspace`.

| Phase | Minimum | Median | p95 / maximum |
| --- | ---: | ---: | ---: |
| Fresh Git catalog | 5.378 ms | 7.192 ms | 8.825 ms |
| Workspace scan | 8.234 ms | 8.912 ms | 11.540 ms |
| Combined core path | 13.997 ms | 15.908 ms | 19.477 ms |

The catalog contained 161 candidates. The scan read 1,571,754 bytes from 111 UTF-8 text files, returned 322 matches, and reported the other 50 candidates as `BinaryNul`. Coverage was therefore explicitly partial rather than success-looking complete. These timings exclude Tauri IPC, rendering, and first-process startup; they also reflect a warm filesystem cache and one small repository. The browser demo's intentional 220-millisecond delay is not performance evidence.

The latency conclusion is **improved** relative to having no workspace-search path and is comfortably interactive on this fixture. It is not a large-repository or cold-cache claim. The inspection utility is documented in [`local-build.md`](../engineering/local-build.md) so future search refinements can use the same boundary.

## Build-size movement

| Output | E1 | E2.1 | Movement |
| --- | ---: | ---: | ---: |
| CSS | 50.40 kB | 54.70 kB | +8.53% |
| CSS gzip | 10.00 kB | 10.64 kB | +6.40% |
| JavaScript | 509.34 kB | 533.11 kB | +4.67% |
| JavaScript gzip | 150.19 kB | 156.05 kB | +3.90% |
| JavaScript source map | 2,048.12 kB | 2,114.11 kB | +3.22% |

The production frontend-size conclusion is **regressed** because the command/search surface is eagerly bundled. Vite's greater-than-500-kB warning remains open. The current release executable is 13,404,160 bytes, 2,384 bytes smaller than U11.1's 13,406,544-byte executable; that binary movement is **no material change**. No package was produced in this slice.

## Short-settle Linux resources

The exact current release executable was launched three times against the Asterlyn checkout. Each run settled for 15 seconds and then sampled the three-process tree plus a two-second idle CPU window.

| Run | PSS | Summed RSS | Idle CPU |
| --- | ---: | ---: | ---: |
| 1 | 232.11 MiB | 483.08 MiB | 0.00% |
| 2 | 232.41 MiB | 483.11 MiB | 0.00% |
| 3 | 232.49 MiB | 483.14 MiB | 0.00% |

Median PSS is 232.41 MiB, 8.02 MiB or 3.58% above U11.1's matched short-settle median of 224.39 MiB. Every sample exceeds the provisional 220 MiB ceiling by 12.11–12.49 MiB. Median summed RSS is 483.11 MiB, 26.67 MiB or 5.84% above U11.1's 456.44 MiB.

The observed idle-resource conclusion is **regressed**. Attribution is **inconclusive**: E1 did not retain a matched resource series, so this comparison includes the cumulative E1 editor and E2.1 navigation changes; the short settle is not the standard five-run, 60-second protocol; and no per-process attribution or transient in-search peak was captured. E2.1 adds no startup index or recurring search work, but that architectural fact does not erase the measured regression. A normalized 60-second series with per-process attribution remains required before the larger Stage 3 checkpoint and before deciding whether lazy frontend loading is warranted.

## Decision and limits

The E2.1 interaction and correctness conclusion is **improved**, search latency on the named fixture is **improved**, executable movement is **no material change**, frontend bundle size is **regressed**, and observed idle resources are **regressed with inconclusive attribution**. The slice is locally accepted because it adds no workspace-wide mutation, stale or unauthorized results fail closed, and the limitations remain visible rather than being described as complete IDE search.

Remaining limits are case-sensitive single-line literal search, no include/exclude or regular-expression controls, no persistent index, no context expansion, no symbol search, no workspace replacement, a 5,000-candidate/64-MiB/500-match bound, typed partial results for unsupported files, repository-local Recent Files, one active search per repository, and no installed Windows/macOS interaction evidence. E2.2 may refine read-only search using this baseline; multi-file replacement remains deferred to E2.3 recovery work.
