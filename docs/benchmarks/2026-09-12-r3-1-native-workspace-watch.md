# R3.1 native workspace-watch acceptance — 2026-09-12

## Scope

R3.1 activates the native external-change foundation designed by ADR-0009. One Rust-owned watcher
is shared by windows that own the same canonical workspace. It emits only root- and generation-
qualified invalidation hints; the existing workspace and system-Git readers remain authoritative.

The frontend starts watching after the bounded project catalog is installed, serializes pending
slice reconciliation, and rejects stale roots, generations, reads, and document revisions. Clean
open documents reload after a verified external change. Dirty or saving documents preserve their
buffer and enter an explicit external-change conflict. Working-tree hints refresh Changes, project
colors, tab colors, and active working Diff without reloading History or refs. Membership-changing
events update the catalog without discarding surviving disclosure, selection, or scroll identity.

## Dependency and platform record

The native adapter uses exactly `notify` 8.0.0 from crates.io, licensed CC0-1.0. Its accepted
registry checksum is
`2fee8403b3d66ac7b26aee6e40a897d85dc5ce26f44da36b8b73e987cc52e943`. The version is pinned in the
workspace manifest and lockfile. It is linked into the native desktop executable and therefore
increases the Linux package; it adds no startup JavaScript or browser dependency. Version 8.0.0 was
chosen over the later available release because its Rust 1.77 minimum remains inside Asterlyn's
declared Rust 1.85 toolchain contract. Upgrading is a reviewed compatibility/resource change, not an
unbounded dependency refresh. Upstream references are the
[`notify` API documentation](https://docs.rs/notify/8.0.0/notify/) and
[`notify-rs` repository](https://github.com/notify-rs/notify).

Linux watches the workspace root and only the parent directories represented by the authorized
project catalog, non-recursively. Selected Git metadata roots and ref/operation directories are
watched separately. On the measured Asterlyn checkout this produces 52 inotify watch descriptors,
including 44 catalog-derived parent directories, instead of recursively registering the 3,205
directories below `target`, 208 below `node_modules`, and 273 below `.git`. macOS and Windows use
the maintained native recursive backend for workspace paths plus separately resolved Git metadata.

## Functional and validation evidence

- All 262 frontend script tests pass. Focused fixtures cover protocol rejection, root/generation
  isolation, activation/disposal races, typed slice scheduling, clean reload, dirty-buffer conflict,
  saving-buffer preservation, exact revision guards, and same-root catalog retention.
- The Rust workspace passes 96 automated tests; the platform watcher acceptance test is ignored in
  ordinary runs and also passes when invoked explicitly against the real host watcher. Mapper tests
  cover ordinary edits, membership changes, Git metadata, ignored object/log churn, and overflow.
- TypeScript checking, protocol generation parity, deterministic production build, Rust formatting,
  and strict all-target workspace Clippy pass.
- The release executable remains alive for the complete 6,000 ms isolated native-smoke interval.
- R3.1 adds no visible control or focus stop. Existing live-region/error presentation reports
  watcher startup and dirty external-change failures. This is neutral automated accessibility
  evidence, not installed macOS/Windows assistive-technology acceptance.

## Coalescing and resource evidence

Watcher bursts settle after 120 ms of quiet and cannot wait more than 500 ms. A single event carries
at most 512 normalized paths; an overflow broadens to all seven invalidation slices. Pure scheduling
tests verify these bounds. The real-watcher test verifies eventual delivery and lifecycle cleanup,
but this run does not claim a distribution for operating-system delivery latency.

Measurement host: Deepin 23.1, Linux 6.12.20 x86_64, AMD Ryzen 5 3600X (6 cores/12 threads),
19 GiB RAM, Node 24.19.0, npm 11.17.0, Rust/Cargo 1.98.1, and Git 2.47.2. Each fresh-profile release
run settled for 15 seconds before process-tree proportional-set-size sampling. Control and watcher
binaries were interleaved by pair to reduce WebKit and host-order noise.

| Pair | Order | Control PSS | Watcher PSS | Delta | Host delta |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | control → watcher | 219,284 KiB | 222,270 KiB | +2,986 KiB | +814 KiB |
| 2 | watcher → control | 219,252 KiB | 222,055 KiB | +2,803 KiB | +626 KiB |
| 3 | control → watcher | 219,430 KiB | 221,285 KiB | +1,855 KiB | +871 KiB |

The median paired process-tree delta is +2,803 KiB (+2.74 MiB, approximately +1.28%); the median
Rust-host delta is +814 KiB (+0.79 MiB). The watcher absolute median is 222,055 KiB (216.85 MiB),
and the maximum is 222,270 KiB (217.06 MiB), 2.94 MiB below the provisional 220 MiB ceiling. The
watcher adds two host threads. Median idle CPU remained 0.00%; one of three watcher observations
captured 0.20% in its five-second window. Memory is therefore **regressed modestly**, idle CPU has
**no material change**, and the selective Linux plan is accepted over a fully recursive workspace
registration.

A same-host audit of retained R2 and pre-watcher R3 binaries measured 146,616 KiB (143.18 MiB) and
196,548 KiB (191.94 MiB) median PSS respectively. That +49,932 KiB result shows the original
cross-stage memory comparison was sensitive to binary/runtime sampling and should not be used to
attribute R3.1 cost. The interleaved +2.74 MiB delta above is the accepted watcher comparison. Short
three-run process observations still include WebKit allocation variance and are not a long-duration
leak test.

## Build and package evidence

| Artifact | R3 | R3.1 | Change | Interpretation |
| --- | ---: | ---: | ---: | --- |
| CSS | 101.99 kB | 101.99 kB | 0 | no material change |
| startup JavaScript | 435.53 kB | 444.25 kB | +8.72 kB (+2.00%) | regressed, below 500 kB |
| startup JavaScript gzip | 106.98 kB | 109.12 kB | +2.14 kB (+2.00%) | regressed |
| release executable | 19,825,592 B | 20,215,600 B | +390,008 B (+1.97%) | regressed |
| Debian package | 6,937,044 B | 7,060,464 B | +123,420 B (+1.78%) | regressed |

The local manual-acceptance package is
`target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`, with SHA-256
`bb86f98a2bf8bf55317120f7620f34eeb2270ab846bb5e2276aee02281bf6b03`.

## Acceptance and limitations

R3.1 is **accepted**. External editor/AI changes now converge through targeted authoritative reads;
clean files update without manual Refresh, unsaved work is not overwritten, repository slices do
not broaden by default, and native ownership follows the active window/workspace lifecycle.
Functional freshness is **improved**. Memory and artifact size are **regressed modestly** but remain
inside their current gates; idle CPU has **no material change**.

The watcher is not a guarantee of perfect delivery. The low-frequency fallback for unavailable or
unreliable network/virtual filesystems is not implemented. On Linux, a new file created below a
previously empty directory absent from the current catalog may require focus regain or explicit
Refresh before that directory joins the selective watch plan. Submodule source paths are observed
through the workspace plan, but independent external submodule Git metadata is not. External-change
Diff and resolution remain read-only/future work. Cross-platform backend compilation is covered by
CI configuration, while installed macOS/Windows watcher fault and assistive-technology acceptance
remain pending.
