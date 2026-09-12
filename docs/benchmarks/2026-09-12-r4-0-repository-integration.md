# R4.0 repository integration boundary acceptance — 2026-09-12

## Scope and architecture result

R4.0 is the bounded preparation required before recoverable Merge work. It introduces one
window-scoped `RepositoryIntegrationCoordinator` for accepting canonical repository results and
applying their declared invalidation slices. Manual Refresh, native-watch repository rereads,
tracked/untracked scan completions, local mutations, Remote operations, workspace replacement, and
the existing read-only conflict destination now use this boundary. `WindowSession` remains the
single frontend repository snapshot owner; feature controllers retain their own presentation and
request state; Git remains the only repository truth.

The coordinator exposes structural ports rather than importing DOM, Tauri, or concrete feature
classes. `AsterlynApp` supplies rendering and navigation callbacks but no longer subscribes to
`WindowSession`, installs tracked or repository results, interprets invalidation slices, or
duplicates conflict-file selection. An ownership test locks those responsibilities to the new
boundary.

The composition adapter changed from 5,796 to 5,646 lines, while the cohesive coordinator is 319
lines. This count is evidence of responsibility movement, not the acceptance target. The source-
size rule was corrected in the same change: size triggers an ownership review, while clean
dependencies, explicit state ownership, lifecycle disposal, and characterization coverage decide
whether a file must be decomposed. A large cohesive composition root is permitted; mechanical line
movement is not treated as architecture improvement.

## Functional and safety evidence

- Seven focused integration fixtures verify working-tree-only fan-out, ref/history fan-out, first-
  conflict routing, Git-capability removal after an external reread, Git and ordinary-workspace
  manual Refresh, stale manual-refresh rejection, session scan routing, and disposal.
- The complete frontend suite passes 269/269 tests. Existing watcher, stale-generation, remote,
  commit, branch, editor, Diff, and shell behavior remains covered.
- The Rust workspace passes 96 automated tests. The separately invoked real operating-system
  watcher test remains intentionally excluded from ordinary runs and was already accepted in R3.1.
- TypeScript checking, production build, Rust formatting, and strict all-target/all-feature Clippy
  pass. No protocol, persistence, dependency, Git command, or visible control changed.
- The release executable remained alive for the complete 6,000 ms isolated native-smoke interval.

R4.0 does not make an operation safer by retrying it. A stale window generation remains rejected,
all mutation outcomes are installed before projection fan-out, and an unresolved path remains an
observed conflict routed to Changes and the current read-only Diff.

## Performance and resource evidence

Measurement host: Deepin 23.1, Linux 6.12.20 x86_64, Node 24.19.0, npm 11.17.0, Rust/Cargo 1.98.1,
and Git 2.47.2. The production build transformed the same 292 modules as R3.1.

| Artifact | R3.1 | R4.0 | Change | Interpretation |
| --- | ---: | ---: | ---: | --- |
| CSS | 101.99 kB | 101.99 kB | 0 | no material change |
| startup JavaScript | 444.25 kB | 445.89 kB | +1.64 kB (+0.37%) | no material change; below 500 kB |
| startup JavaScript gzip | 109.12 kB | 109.58 kB | +0.46 kB (+0.42%) | no material change |
| release executable | 20,215,600 B | 20,217,280 B | +1,680 B (+0.008%) | no material change |
| Debian package | 7,060,464 B | 7,062,856 B | +2,392 B (+0.034%) | no material change |

Three release runs against the Asterlyn checkout settled for 15 seconds and sampled five seconds of
idle CPU. Process-tree PSS was 186,297, 188,999, and 188,517 KiB; median PSS was 188,517 KiB
(184.10 MiB) and maximum PSS was 188,999 KiB (184.57 MiB). Median RSS was 464,292 KiB and every CPU
sample was 0.00%. The absolute result remains below the provisional 220 MiB ceiling and idle CPU
shows **no material change**. This run did not repeat the interleaved, fresh-profile R3.1 control,
so comparative memory impact is **inconclusive** and the lower absolute value must not be presented
as an optimization gain.

The local Debian artifact is
`target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`, 7,062,856 bytes, with SHA-256
`84ebb15117dc3ecadf99c33844b1e45627aff1998cf95d4ee6bd2c18f7fdfb0f`.

## Accessibility, limitations, and next action

No visible control, focus order, label, or live-region contract changed. Existing status and error
regions receive the same scan, refresh, and read-only conflict messages through the centralized
route. Accessibility impact is therefore **no material change** in automated coverage; installed
macOS and Windows assistive-technology acceptance was not repeated.

R4.0 is **accepted** as architecture preparation, not as delivery of Merge. Conflict Diff remains
read-only, operation state is still the legacy optional label, and Continue, Skip, Abort, restart
recovery, three-way conflict content, and reviewed Merge plans do not exist yet. R4.1 must replace
that label with a typed snapshot reconstructed from Git, add editable three-way conflict handling,
and prove restart/stale-plan/external-race behavior before the first Merge action is enabled.
