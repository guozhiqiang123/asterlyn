# Foundation hardening acceptance — 2026-09-19

## Outcome

FH0 through FH7 are complete. The post-CM4 capability freeze is lifted: new context-action and
other product work may resume on the enforced boundaries rather than extending the former
composition, transitional-workbench, Tauri-command, or ad hoc Git-process seams.

The accepted foundation has four durable properties:

- frontend feature state and DOM lifecycles have one feature owner, while `AsterlynApp` remains the
  explicit composition root;
- native startup and the deterministic browser demo implement the same `DesktopBridge` contract
  but no longer share the native loaded graph;
- workspace and historical-file policy is testable in desktop application services without
  constructing Tauri;
- `asterlyn-git::process` is the only production boundary allowed to construct or spawn Git, and it
  owns environment hardening, output budgets, cancellation, and process-tree termination.

Resolved frontend dependency, application-DOM, and transitional-workbench debt baselines were
deleted. Their architecture checks now require absolute zero, so future debt cannot be legitimized
by appending an exception. Oversized cohesive sources retain explicit non-growing ownership limits.

## Functional and architecture evidence

| Check | Result |
| --- | --- |
| TypeScript and frontend architecture | `npm run check` passed |
| Complete frontend/delivery suite | 494 tests passed |
| Production frontend build | passed; 403 modules transformed; 500,000-byte main-chunk gate passed |
| Rust workspace | 203 tests passed; two real watcher-backend tests remained explicitly ignored |
| Git core | 93 tests passed, including runner policy, cancellation, overflow, mutation, and remote behavior |
| Rust quality | `cargo fmt --all -- --check` and workspace/all-target Clippy with warnings denied passed |
| Generated protocol | regeneration produced no diff |
| Process ownership | one production `Command::new("git")` and one `.spawn()`, both in `process.rs` |
| Native smoke | release executable remained alive for the complete 6,000 ms observation |
| Debian package | generated successfully for `amd64`; declared WebKitGTK 4.1 and GTK 3 dependencies |

The architecture source guard is part of `npm run test:scripts`; a new production Git construction
or spawn outside the runner fails the suite. The frontend guards discover the complete TypeScript
and stylesheet source sets rather than relying on a curated file list.

## Source and artifact movement

The baseline is commit `ef0ffe8`, recorded immediately after CM4 acceptance. Byte counts are raw
generated artifacts; gzip values are produced from the same local build.

| Artifact | Baseline | Accepted result | Movement |
| --- | ---: | ---: | ---: |
| `src/app.ts` | 9,242 lines | 8,781 lines | -461 lines (-5.0%) |
| `src-tauri/src/lib.rs` | 1,708 lines | 1,117 lines | -591 lines (-34.6%) |
| `asterlyn-git/src/repository.rs` | 8,676 lines | 8,288 lines | -388 lines (-4.5%) |
| application/main JavaScript | 685,945 B / 153,928 B gzip | 323,925 B / 68,717 B gzip | -362,020 B raw (-52.8%) |
| main CSS | 126,665 B | 62,302 B / 17,063 B gzip | -64,363 B raw (-50.8%) |
| Debian package | 8,602,226 B | 8,629,130 B | +26,904 B (+0.3%) |
| release executable | 24,773,800 B | 24,711,112 B | -62,688 B (-0.3%) |

The main JavaScript movement is a central-artifact improvement, not a claim that every static
feature byte became lazy. The build still reports static feature chunks of 132,470 B and 186,778 B;
the 48,441-byte demo bridge is loaded only by the browser-demo entry. The shared context-menu host
is a 9,728-byte capability chunk.

The package is
`target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`, has SHA-256
`079af2b10b271aa4f39a4b286052c19bac7358a22a55110f3a92c1cac12f9115`, and reports an installed
size of 24,330 KiB. It is local verification evidence only; it was not installed, signed,
published, or pushed remotely.

## Latency and resource evidence

Release-mode Git inspection used this repository, ten measured iterations, 542 catalog candidates,
and a 2,242,404-byte bounded search corpus.

| Operation | Median | p95 / maximum | Result |
| --- | ---: | ---: | --- |
| repository snapshot | 24.759 ms | 25.278 ms | 0 changes, 150 commits, 3 refs |
| tracked catalog | 22.485 ms | 23.004 ms | complete |
| untracked scan | 2.273 ms | 2.304 ms | complete |
| search catalog | 6.235 ms | 6.704 ms | 542 candidates |
| bounded text search | 12.837 ms | 30.424 ms | 191 files searched; stopped at the 500-match limit |
| catalog plus search | 18.883 ms | 37.146 ms | bounded completion |
| replacement plan | 33.116 ms | 34.004 ms | 1 file, 17 replacements, 8 skipped files |
| catalog plus replacement plan | 39.169 ms | 40.025 ms | plan only; no workspace write |

The replacement inspection first proved that a no-op replacement is rejected. The successful probe
also remained non-mutating because the inspection example produces a plan without applying it.

Three 60-second native process-tree samples, with ten-second sampling, produced:

| Run | Processes | PSS | RSS | Idle CPU |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 3 | 372,132 KiB | 623,044 KiB | 0.10% |
| 2 | 3 | 379,540 KiB | 630,652 KiB | 0.10% |
| 3 | 3 | 372,169 KiB | 623,432 KiB | 0.10% |

Median PSS was 372,169 KiB and median RSS was 623,432 KiB. These values are an accepted absolute
checkpoint; there is no method-matched pre-hardening sample, so memory movement is inconclusive.

## Browser interaction and accessibility

The deterministic demo was opened in a real browser after the production checks. Pointer
right-click and keyboard interaction verified the shared menu host on Files, local Branches,
History commits, commit files, and the editor gutter. Files exposed New File, Cut, Copy, Paste,
Reveal, Rename, the three-level Copy Path choices, Git History, and Trash; unavailable demo
mutations stayed focusable with a visible reason. Branch and commit mutations likewise retained
their exact dirty-worktree blockers.

The commit-file surface exposed Diff, historical/current opening and comparison, Restore, History,
and Copy Path. The editor gutter action loaded four Git Blame annotations and then changed to a
checked “Hide Git Blame annotations” action. Arrow keys opened the Copy Path submenu, Escape closed
the active surface and restored focus to the originating row, and the browser console reported no
warnings or errors.

The complete automated suite retains the full Files, Changes, local/remote Branches, single/range
History, commit-folder/file, and Git Blame menu matrix. Search, Replacement, History, recovery, and
the remaining full-browser interaction evidence remain recorded in the linked milestone benchmark
documents; this closeout reran the shared-host and newly refactored ownership paths rather than
claiming a new manual pass of every historical scenario.

## Known limits

- This host exercised Linux/Unix process-group cancellation and produced a Debian package. Windows
  `taskkill`, Windows packaging, and macOS packaging/startup still require their native release
  checkpoints; only `x86_64-unknown-linux-gnu` is installed here.
- The two real operating-system watcher tests remain ignored by their established native-acceptance
  contract. Linux native smoke proves startup liveness, not exhaustive installed-package UI behavior.
- `src/app.ts`, the deterministic demo adapter, localization data, and `repository.rs` remain large.
  Their responsibilities are now constrained by executable ownership and dependency gates; future
  splits should follow capability cohesion and characterization tests rather than line-count moves.
- The resource figures cannot establish an improvement without a method-matched baseline. The
  bounded replacement probe skipped eight files and intentionally did not apply a mutation.
- The generated Debian package is unsigned local evidence and has not been installed or distributed.

## Decision

The FH1–FH4 frontend foundation gates, FH5 desktop-service boundary, FH6 Git-process boundary, and
FH7 validation matrix are green within the limits above. The capability freeze is lifted. New work
must preserve the absolute dependency/DOM/workbench guards, the native/demo split, thin Tauri
commands, the single Git runner, and the existing reviewed mutation boundaries.
