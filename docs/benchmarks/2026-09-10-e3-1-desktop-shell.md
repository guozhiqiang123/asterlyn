# E3.1 desktop-shell correction evidence

## Scope and decision

This bounded correction follows E3.1 without advancing the editor milestone. It fixes the shell scale and title-bar hierarchy, overflowing editor-tab interaction, occupied-window project selection, per-window workspace authorization, and stale launch-icon output reported during manual review. It produces no installer and makes no remote push.

The local machine remains Deepin 23.1 on Linux 6.12 with an AMD Ryzen 5 3600X, 19 GiB RAM, Rust 1.98.1, Node.js 24.19.0, and Git 2.47.2. The installed Android Studio build is `AI-261.26222.65.2614.16204760`; its active new-UI profile contains no application- or editor-font override, so published defaults rather than a user customization are the comparison baseline.

## Standards and visual-scale evidence

- JetBrains' [typography guidance](https://plugins.jetbrains.com/docs/intellij/typography.html) specifies Inter at 13 px as the default interface font on every supported operating system. The [JetBrains Mono guidance](https://www.jetbrains.com/lp/mono/) recommends 13 px and 1.2 line spacing for editor text. Asterlyn now defaults to 13 px for both surfaces and 1.20 editor line height. Version-two preference loading migrates untouched former 11/12/1.62 defaults while preserving explicit custom values.
- JetBrains' [icon guidance](https://plugins.jetbrains.com/docs/intellij/icons.html) specifies 16×16 action/node/file icons and 20×20 new-UI tool-window icons. Asterlyn's leading project control and primary shell actions now use 18–20 px artwork with 16 px window controls. The title/menu bar is 48 px high and its targets grow with the artwork rather than scaling a glyph inside the old compact hit box.
- The duplicate leading brand block is removed. The active project name and path occupy the leading title-bar position, while search, refresh, settings, and window controls remain trailing actions.

## Interaction and isolation evidence

The first repository selected in an empty window still opens in that window. Selecting a different repository from an occupied window presents a keyboard-operable modal with Cancel, Current window, and New window actions. Re-selecting the current path refreshes it without prompting. Native project windows are created by the Rust shell and consume a one-shot canonical pending path.

Active workspace roots are keyed by Tauri window label rather than one global root. Every workspace read, save, search, replacement preview/apply/recovery, and repository-open boundary resolves authorization for the invoking window. Pending paths and cancellable untracked scans are also window-qualified and are removed on window destruction. Tests prove two windows can own different roots, a pending path can be consumed only once, and equal numeric scan IDs in different windows do not cancel each other.

The editor-tab strip accepts the dominant wheel axis and converts an ordinary vertical wheel gesture into bounded horizontal movement only when overflow exists. In a 920-pixel browser viewport, eight tabs produced a 651-pixel client width and 960-pixel scroll width; one real vertical wheel gesture moved `scrollLeft` from 0 to 309. The strip keeps keyboard/tab semantics and hides only its redundant visual scrollbar. Browser interaction also verified the leading project hierarchy and occupied-window modal with no console warning or error.

## Platform icon evidence

The [Tauri desktop icon contract](https://v2.tauri.app/develop/icons/) maps ICNS to macOS, ICO to Windows, and PNGs to Linux. Microsoft's [Windows app-icon guidance](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction) calls out the 16, 24, 32, 48, and 256 pixel minimum set. Apple's [macOS app-icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons/) uses a square source while the system applies the final mask. The freedesktop [Icon Theme Specification](https://specifications.freedesktop.org/icon-theme/latest/) requires at least a 48-pixel `hicolor` fallback and supports additional fixed sizes.

The hand-maintained SVG now occupies its full square canvas. A pinned generation helper writes to a temporary directory and retains exactly seven declared desktop assets: 32, 48, 128, 256, and 512 pixel PNG representations, one ICO with 16/24/32/48/64/256 frames, and one ICNS with modern Retina representations. Historical Android/iOS launcher sets and unused Windows Store/AppX tiles are removed because those targets are not currently shipped. Script tests reject missing required frames, padded source geometry, or any undeclared residual asset.

## Validation and resource movement

Validation passes 102 frontend script tests, 28 `asterlyn-git` tests, 23 `asterlyn-workspace` tests, and 12 desktop tests. Rust formatting, strict all-target Clippy, TypeScript checking, the production frontend build, the release native build, deterministic browser interaction, and a six-second Linux release-executable liveness smoke check pass. The direct desktop test command first failed only because it bypassed the documented user-local WebKitGTK sysroot; the same tests passed through `scripts/with-linux-tauri-env.sh` without changing code or lowering checks.

| Output | E3.1 | Correction | Movement |
| --- | ---: | ---: | ---: |
| CSS | 65.64 kB | 65.64 kB | 0.00 kB / 0.00% |
| CSS gzip | 12.54 kB | 12.52 kB | -0.02 kB / -0.16% |
| Main JavaScript | 608.79 kB | 612.05 kB | +3.26 kB / +0.54% |
| Main JavaScript gzip | 176.50 kB | 177.11 kB | +0.61 kB / +0.35% |
| Main JavaScript source map | 2,280.37 kB | 2,287.60 kB | +7.23 kB / +0.32% |
| All emitted JavaScript | 1,849,287 bytes | 1,852,542 bytes | +3,255 bytes / +0.18% |
| Sum of per-file gzip streams | 649,420 bytes | 649,120 bytes | -300 bytes / -0.05% |
| Linux release executable | 16,185,584 bytes | 18,185,584 bytes | +2,000,000 bytes / +12.36% |

The frontend movement is **no material change**. The release executable movement is **regressed**: dynamic native-window construction pulled additional Tauri window-creation code into the binary. The increase is accepted for the required independently authorized multi-project mode, but remains visible for later link/profile inspection. No matched process-tree PSS/RSS series or forced browser-heap series was run, so memory impact is **inconclusive** and this correction makes no memory-reduction claim.

## Limits and next action

The browser demo can validate the prompt and title/tab behavior but cannot create an operating-system window. Rust ownership tests and the release build validate that native boundary; installed Windows/macOS interaction remains deferred to release-candidate work as previously agreed. Window sessions and dirty buffers are not yet restored after process restart. Shared profile preferences and recent-project hints intentionally remain common to all windows, while active repositories and editor sessions are isolated.

Interaction, authorization isolation, and platform-asset consistency are **improved**. Frontend size has **no material change**, native executable size is **regressed**, and memory remains **inconclusive**. E3.2 editor groups and tab movement remains the next product slice.
