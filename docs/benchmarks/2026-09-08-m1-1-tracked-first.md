# M1.1 tracked-first refresh — 2026-09-08

## Purpose

This evidence set evaluates [`ADR-0002`](../architecture/decisions/0002-tracked-first-refresh.md). The target is not to make system Git enumerate every untracked path faster; it is to make useful repository truth available before that enumeration completes, cancel obsolete work, and confirm the Linux memory budget with repeated samples.

## Comparison context

- **Asterlyn source:** commit `f30d547655a75a6b5d18ed5c79a2bfcbaa872788`.
- **Baseline:** [`2026-09-08-m1-baseline.md`](2026-09-08-m1-baseline.md), collected earlier on the same host.
- **Machine and toolchain:** unchanged from the baseline: Deepin 23.1 x86_64, DDE/X11, AMD Ryzen 5 3600X, 20,425,524 KiB RAM, Git 2.47.2, Rust 1.98.1, Node.js 24.19.0, Tauri 2.11.5, and WebKitGTK 2.46.3.
- **Large fixture:** the same read-only Rebased checkout at `2896562e69ff2cac3c90eb3aae4bcce0d4aa9a99`, with 273,559 tracked paths and four visible working-tree entries.
- **Clean fixture:** a newly initialized empty repository.
- **Build:** release profile with the Deepin software-compositing compatibility path.

## Behavior and correctness evidence

- The pure Git capability now exposes a tracked snapshot and a separately cancellable untracked scan. Its complete compatibility snapshot composes both phases.
- A cancellation token terminates the Git child process, waits for it, and drains stdout/stderr readers. A preemptive-cancellation test verifies the public contract.
- Desktop requests register unique scan identifiers. Repository switches and mutations cancel active scans; generation and root checks independently prevent stale supplements from being merged.
- Pending and failed untracked states are visible. The UI does not label a repository clean until untracked discovery completes.
- Browser demo regression passed: the tracked phase displayed four entries and provisional counts; a stage operation during scanning invalidated the old scan; the replacement scan produced one untracked row exactly once; no console warning or error was reported.
- Native temporary-repository smoke passed: the release application displayed one tracked modification and one untracked file, staged the tracked path, created `M1.1 native flow`, then reconciled to the one remaining untracked path. Repository state was independently verified with Git.
- Rust workspace tests: 10 passed (9 Git core/parser/integration tests and 1 Deepin compatibility test).
- TypeScript strict check, Vite production build, Rust formatting, and workspace Clippy with warnings denied passed.
- The Linux release binary and Debian package built successfully. Cross-platform CI packaging remains a delivery gate rather than evidence claimed by this run.

## Refresh latency

The release inspection utility ran each phase ten times. The complete result is the sum of fresh tracked and untracked queries and is retained to show the eventual cost honestly.

| Fixture and phase | Minimum | Median | p95 / maximum |
| --- | ---: | ---: | ---: |
| Empty, tracked ready | 2.434 ms | 2.857 ms | 5.335 ms |
| Empty, untracked supplement | 2.275 ms | 2.306 ms | 2.403 ms |
| Empty, complete | 4.741 ms | 5.166 ms | 7.728 ms |
| Rebased, tracked ready | 195.033 ms | 205.728 ms | 215.768 ms |
| Rebased, untracked supplement | 940.134 ms | 952.318 ms | 1,007.862 ms |
| Rebased, complete | 1,139.982 ms | 1,152.552 ms | 1,216.196 ms |

The first baseline exposed Rebased changes only after a 1,145.474 ms median complete refresh. M1.1 exposes tracked state after 205.728 ms, a 939.746 ms or 82.0% reduction in interactive tracked readiness. Its 215.768 ms p95 also meets the provisional 750 ms p95 budget.

The eventual Rebased complete median changed from 1,145.474 ms to 1,152.552 ms (+0.6%), which is **no material change** within this single-host comparison. Empty complete refresh increased from 2.576 ms to 5.166 ms because two Git processes are now used; the relative increase is large but the absolute 2.590 ms cost is not material to interaction. Tightening cancellation polling from 10 ms to 2 ms kept this fixed cost bounded.

**Latency interpretation: improved.** The product becomes useful substantially earlier on the large fixture without claiming that untracked enumeration itself became faster.

## Repeated steady-state memory and CPU

The Linux process-tree helper launched the exact release binary five times against Rebased. Each run settled for 60 seconds, then sampled PSS/RSS and ten seconds of idle CPU before terminating that instance.

| Run | Process-tree PSS | Summed RSS | Idle CPU |
| ---: | ---: | ---: | ---: |
| 1 | 201.16 MiB | 443.42 MiB | 0.20% |
| 2 | 209.28 MiB | 455.95 MiB | 0.20% |
| 3 | 205.81 MiB | 448.28 MiB | 0.20% |
| 4 | 207.50 MiB | 452.16 MiB | 0.30% |
| 5 | 199.23 MiB | 444.49 MiB | 0.10% |
| **Median** | **205.81 MiB** | **448.28 MiB** | **0.20%** |

PSS ranged from 199.23 to 209.28 MiB. Every run remained under the provisional 220 MiB budget; the worst sample retained 10.72 MiB of headroom. There was no monotonic increase across launches. The median is 5.06 MiB below the original single 210.87 MiB Rebased sample, but a repeated set versus one earlier sample does not establish that the implementation reduced memory.

**Memory interpretation: no material change, budget provisionally stable.** The margin still cannot absorb an editor, LSP, or extension host without continued lazy loading and process-budget enforcement.

## Build size

| Output | Size | SHA-256 |
| --- | ---: | --- |
| Release binary | 11,728,256 bytes | `4ed18d90e668f7efe8ecd4876e35387f463b815b8e6f4bf0faaa812c2c091762` |
| Debian package | 3,295,460 bytes | `4d53a8b18a7c31583067aece121b525ca4f9b5505fc8455a60935b844eafc068` |

The release binary grew by 20,208 bytes (+0.17%) and the Debian package by 13,070 bytes (+0.40%) from the first baseline. The frontend production output is 280.68 kB JavaScript raw / 89.10 kB gzip and 17.06 kB CSS raw / 4.47 kB gzip.

## Conclusion

**Improved for the M1.1 objective.** Tracked state now meets the large-repository interactive budget, obsolete untracked scans are cancellable, the complete result remains truthful, native mutation/reconciliation passed on an isolated repository, and repeated Linux memory samples stayed within budget.

The Linux M1 vertical slice is accepted for continued development. M1 is not release-complete until Windows and macOS CI builds, artifact smoke checks, and the unsigned-preview policy are established. The next bounded step should create that delivery path before Stage 2 adds broader Git operations.

## Limitations and next action

- Measurements still cover one Linux host and one large fixture.
- Core phase timings approximate application data readiness; the frontend does not yet emit paint telemetry.
- Native UI automation used a fixed-size local window and an isolated repository. A portable WebDriver path remains future work.
- Cancellation correctness is covered at the core contract and stale-result behavior at the UI, but process-kill latency is not separately instrumented.
- No Windows or macOS artifact has been produced, signed, installed, or smoke-tested.

Create the GitHub repository after owner and visibility are confirmed, then add a least-privilege GitHub Actions matrix that builds on Linux, Windows, and macOS, uploads unsigned preview artifacts, records hashes, and keeps signing credentials out of pull-request jobs.
