# E2.3 recoverable workspace-replacement evidence

## Scope and decision

E2.3 is locally accepted as Asterlyn's first workspace-wide write transaction. Find in Files now separates query and replacement text, reruns the bounded search to build a fresh preview, selects whole files explicitly, and applies only the reviewed selection. A completed apply remains reversible across restart until the user chooses `Keep changes` or `Roll back`.

The local machine remains Deepin 23.1 on Linux 6.12 with an AMD Ryzen 5 3600X, 19 GiB RAM, Rust 1.98.1, Node.js 24.19.0, and Git 2.47.2. The measured checkout contained 169 Git-authorized catalog candidates. This sub-slice produces no installer and makes no remote push; both remain reserved for the larger Stage 3 checkpoint.

## Safety and functional evidence

- Preview is non-mutating and repeats the fresh Git catalog plus bounded literal or line-local regex search. Catalog, candidate, byte, or match truncation blocks replacement because unseen matches would invalidate the review. Unsupported binary, encoding, link, type, missing, unreadable, changed, or oversized files remain disclosed and outside the reviewed transaction.
- A plan retains at most 200 changed files and 64 MiB of combined original/proposed bytes in memory. Replacement text is at most 16 KiB and every preview line is at most 320 UTF-16 units. Literal text is exact; regex replacement supports Rust capture expansion. Inserted newlines follow each file's dominant separator while untouched mixed separators and UTF-8 BOM state remain exact.
- Apply repeats active-root and Git authorization inside one repository-wide write lock, preflights every selected revision before journaling, publishes exact original/proposed byte blobs under the application-local data directory before the first workspace write, and then uses E1's same-directory optimistic atomic save for every file.
- Cancellation or a partial failure automatically attempts conservative rollback. Rollback restores a file only while its bytes still equal the reviewed replacement; an external edit is preserved and leaves a visible recovery record. `Keep changes` is enabled only for an intact applied transaction and removes backups only after every file still equals the reviewed proposal. There is no force path.
- Closing or superseding a preview removes its bounded desktop plan. Request identity includes repository generation, canonical root, operation ID, query, replacement, mode, ordered include/exclude globs, and context count. Applying or rolling back refreshes open clean tabs, the workspace search result, and the Changes snapshot without discarding the current editor or history-query state. Open dirty or saving target tabs block apply and rollback.

Validation passes 23 `asterlyn-workspace` tests, 28 unchanged `asterlyn-git` tests, nine desktop-library tests, and 93 frontend tests. Focused tests cover exact mixed-newline rollback, regex captures, verified finalization, conflict before journaling, injected partial failure with automatic restoration, external-edit preservation, replacement-ID bounds, fresh Git reauthorization, write-lock identity, preview disposal, immutable frontend request identity, and explicit file selection. Rust formatting, strict all-target Clippy, TypeScript checking, the production frontend build, and a native Linux liveness smoke check pass.

The production-browser journey searched two files, previewed before/after content, deselected one target, applied only that file, observed the durable recovery entry, rolled it back, and saw both recovery and search state reconcile. A second journey applied two files and chose `Keep changes`. Both ended with the expected status and no warning or error log.

## Accessibility evidence

The replacement field, preview action, select-all control, per-file checkboxes, before/after comparisons, recovery states, rollback, keep, close, and cancellation controls have explicit accessible names. Preview and recovery use named modal-dialog semantics. Native checkboxes expose the complete selected-file state, the file list remains operable without pointer-only gestures, Escape closes non-mutating review state, and an in-flight apply exposes one cancellation action while other mutation controls remain disabled. Color is supplementary to textual `Before`, `After`, `Replaced`, `Original`, `Conflict`, and recovery labels.

## Preview latency

The release inspection utility rebuilt the Git catalog and replacement plan on every iteration without writing files. Each row contains ten warm-filesystem iterations and uses the production search and replacement limits.

| Query and options | Replacement files / matches | Skipped | Catalog median | Plan median | Combined median | Combined p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Literal `Asterlyn`, defaults | 35 / 91 | 50 | 6.161 ms | 16.131 ms | 22.446 ms | 23.825 ms |
| Literal `Asterlyn`, include `src/**` | 5 / 17 | 0 | 6.129 ms | 6.324 ms | 12.416 ms | 15.546 ms |

The default row is structurally complete despite 50 explicitly skipped unsupported files, so all 91 discovered replaceable matches enter the preview. The filtered row is complete with no skips. Both are comfortably interactive on this named fixture; replacement-preview latency is therefore **improved** from the prior absence of the capability, but it is not compared as a speedup against E2.2b search because planning deliberately performs an additional exact reread and byte encoding of every matching file. Near-limit and slow-filesystem repositories remain unmeasured.

## Build and focused resource movement

| Output | E2.2b | E2.3 | Movement |
| --- | ---: | ---: | ---: |
| CSS | 56.17 kB | 59.79 kB | +3.62 kB / +6.44% |
| CSS gzip | 10.90 kB | 11.53 kB | +0.63 kB / +5.78% |
| Main JavaScript | 563.66 kB | 589.31 kB | +25.65 kB / +4.55% |
| Main JavaScript gzip | 166.30 kB | 171.53 kB | +5.23 kB / +3.15% |
| Main JavaScript source map | 2,167.85 kB | 2,232.17 kB | +64.32 kB / +2.97% |
| All emitted JavaScript | 1,804,157 bytes | 1,829,803 bytes | +25,646 bytes / +1.42% |
| Sum of per-file gzip streams | 639,224 bytes | 643,539 bytes | +4,315 bytes / +0.68% |

Frontend size is **regressed**, and the existing greater-than-500-kB main-chunk warning remains open. The retained recovery and exact-byte plan implementation lives in Rust; the frontend increase is primarily the review/recovery state, rendering, and deterministic browser bridge. Splitting the command and recovery surfaces is a later packaging optimization candidate, but correctness is not traded away to close the warning in this slice.

The rebuilt Linux release executable is 16,168,040 bytes, up 526,960 bytes or 3.37% from E2.2b's 15,641,080-byte executable. Native executable size is also **regressed**. This comparison is matched to the same checkout lineage and local toolchain, but it does not separate recovery code from compiler/linker layout movement. No Debian, RPM, AppImage, Windows, or macOS package was produced for this sub-slice.

One fresh production-browser tab was observed through DevTools performance counters without forced garbage collection. The welcome workbench reported 5,240,784 bytes used and 6,336,512 bytes total JavaScript heap with 1,176 nodes. The populated search plus two-file replacement preview reported 6,802,696 bytes used, 8,851,456 bytes total, and 2,045 nodes: deltas of 1,561,912 used bytes, 2,514,944 total bytes, and 869 nodes. This is one uncollected observation that includes both transient dialogs, search results, demo data, and browser allocation policy, so focused memory impact is **inconclusive**. No startup task, watcher, cache, or recurring replacement work was added, and the normalized native 60-second series remains a Stage 3 checkpoint gate.

## Limits and next action

Interaction and recovery correctness are **improved**, named-fixture preview latency is interactive, frontend size is **regressed**, and focused memory impact is **inconclusive**. The private recovery format is versioned but has no migration promise yet. Recovery stores source contents in the user's application-local data area without encryption beyond operating-system account permissions. Atomic save preserves ordinary permissions but not every ACL or extended attribute. External processes still have a narrow race between final verification and rename or recovery cleanup; conservative byte comparison prevents intentional overwrite but cannot make unrelated writers transactional. Match-level selection, editing proposed content after preview, cross-line expressions, ignored-file replacement, a case-insensitive toggle, recovery expiry, encrypted backups, and Windows/macOS installed interaction remain deferred.

E2 is now complete. The next product slice is E3 editor groups and preferences: split editors, tab movement, language-neutral indentation, settings/keymaps, encoding/EOL controls, file watching, external-change comparison, and a measured large-file mode. Packaging, remote publication, language-catalog packaging, and normalized native resources remain reserved for the larger Stage 3 checkpoint.
