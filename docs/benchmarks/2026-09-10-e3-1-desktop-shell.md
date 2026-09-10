# E3.1 desktop-shell correction evidence

## Scope and decision

This bounded correction follows E3.1 without advancing the editor milestone. It fixes the shell scale and title-bar hierarchy, overflowing editor-tab interaction, occupied-window project selection, per-window workspace authorization, and stale launch-icon output reported during manual review. A local Debian package is produced for manual acceptance under the task-end packaging rule; no remote push is made.

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

## Close-control regression correction

Manual acceptance found that neither the custom close button nor `Alt+F4` could close a project window. The behavior was reproduced against the release executable. Tauri's `onCloseRequested` helper destroys the window after a non-prevented event, but the project-window capability granted `allow-close` without the separately required `allow-destroy`; the permission failure left the window alive. The confirmed application close path also issued another close request after dirty-buffer handling instead of directly destroying the already-approved current window.

The capability now grants destroy only to Asterlyn project windows, and the confirmed path invokes `destroy()` after the existing save-or-cancel gate. Two regression tests require both the destroy call and capability. The complete frontend suite increased from 102 to 104 passing tests. A rebuilt release window was exercised twice against the current checkout: a real pointer click on the custom close control removed the window and process within one second, and a separate run did the same through `Alt+F4`. The native executable is 18,186,416 bytes, 832 bytes or less than 0.01% above the pre-fix shell build, so native-size movement for this correction is **no material change**.

The refreshed task-end Debian acceptance package is `Asterlyn_0.1.0_amd64.deb`, 6,201,666 bytes, with SHA-256 `26bc388238d4b619a7aa09e656b7f2b35b7154479e4bb738fd86498ddfa7df6a`. `dpkg-deb` inspection confirms package version 0.1.0, `amd64` architecture, the native executable, desktop entry, and 32/48/128/256/512 icon representations. It is a local unsigned acceptance artifact, not a release candidate.

## Platform-integrated chrome follow-up

The initial window and every later project window now come from one Rust factory rather than mixing a static configuration window with dynamically constructed windows. The factory retains native macOS decorations, selects Tauri's overlay title-bar style, hides the redundant native title, and leaves the operating-system traffic lights on the left. The frontend obtains only a read-only chrome-mode value, reserves 76 pixels for that native control cluster, and does not render duplicate custom controls. Windows and Linux retain the undecorated 48-pixel application bar and the existing right-side minimize, maximize, and close controls.

This policy follows Tauri's platform-specific configuration model and its macOS requirement that traffic-light positioning be paired with native decorations and an overlay title bar. It deliberately avoids reproducing macOS controls in HTML, preserving operating-system control placement and semantics. The platform choice is compile-time shell policy and cannot affect repository, editor, dirty-buffer, or per-window authorization state.

The frontend chrome-policy tests cover macOS native-control ownership, Windows/Linux custom-control ownership, and the browser-demo fallback. The desktop unit test covers the platform-to-mode contract, and the Linux release application launched successfully through the new factory. A real custom maximize click expanded the window from 1320 × 820 to 1920 × 1036, and a real close click removed both the window and its process. The current desktop's automation path did not provide reliable drag or minimize evidence, so those remain manual Debian acceptance items rather than claimed passes. Native macOS traffic-light placement and overlay behavior also require later validation on real macOS hardware; the Linux package cannot substantiate that visual result.

Final follow-up validation passes 107 frontend/delivery tests, 28 Git tests, 23 workspace tests, and 13 desktop tests including the executable target. TypeScript checking, the production build, Rust formatting, strict all-target Clippy, packaging, and a six-second release-executable liveness smoke also pass. The production CSS is 65.68 kB (12.54 kB gzip), main JavaScript is 612.43 kB (177.18 kB gzip), and its source map is 2,289.68 kB. Relative to the close correction's 612.01/177.09/2,288.08 kB JavaScript outputs, this is **no material change**. The native executable is 18,192,408 bytes, 5,992 bytes or 0.03% above the close correction, also **no material change**. No matched resource run was performed, so memory remains **inconclusive**.

The refreshed local Debian acceptance package is `Asterlyn_0.1.0_amd64.deb`, 6,204,390 bytes, with SHA-256 `498ffec6b517d595ae9fede3c1e698eb11253710d6c507ddba7cd9eae48b2323`. It is 2,724 bytes or 0.04% above the close-correction package. Package inspection confirms version 0.1.0, `amd64`, the native executable, desktop entry, and 32/48/128/256/512 icon representations. This remains a local unsigned acceptance artifact and is not pushed or described as a release candidate.

## Platform-icon and macOS trust follow-up

Manual Linux and macOS screenshots exposed two different icon defects after the earlier generated-set cleanup. The installed Linux package had no duplicate desktop entry or mismatched cached source: its `StartupWMClass` matched the live `WM_CLASS` value `asterlyn`, and the installed icon files matched the project assets. The live window nevertheless advertised only a 32 × 32 `_NET_WM_ICON`. Inspection of the locked Tauri code-generation path showed that Unix selects the first PNG declared by `bundle.icon`; Asterlyn had placed `icons/32x32.png` first. The declaration now leads with the 128-pixel PNG while retaining the complete package set. A new release process advertised `Icon (128 x 128)` with the same matching window class, confirming that the Linux dock problem was application configuration rather than an installation residue.

The macOS screenshot showed the opposite visual error: the full-canvas mark occupied more of Launchpad's tile than neighboring applications. The canonical SVG remains full canvas for Linux and Windows, but the atomic generator now derives an ICNS-only centered visual envelope occupying 82.03% of both axes in its 1,024-pixel frame. Tests require an 81–84% centered alpha bound, the modern Retina ICNS entries, the 128-pixel Linux runtime declaration, the full-canvas canonical source, and the seven-file maintained asset set. The regenerated 122,506-byte ICNS has SHA-256 `66e706ca375915de88d3748b66b8a793ad013b2e7ef92464779c428b0b7d65b8`. Real Launchpad acceptance remains required because Linux cannot render Apple's final mask and optical scaling.

The Gatekeeper report is not treated as an icon or stale-install problem. The referenced AndroidLogDesktop repository was inspected and found to use only Tauri's `signingIdentity: "-"` ad-hoc signature, with no Developer ID, notarization, or trust verification in its packaging workflow. Its observed warning-free installation may depend on transfer quarantine, prior local approval, or another machine state; that configuration cannot authenticate a public release. Asterlyn therefore keeps secret-free ad-hoc preview packaging and adds a separate manual `main`-only workflow protected by the `macos-signing` environment. It derives exactly one Developer ID Application identity in a temporary keychain, verifies its Team ID, signs with hardened runtime and secure timestamp, notarizes and staples the application and DMG, mounts and copies the DMG application into installed form, and requires `codesign`, `spctl`, `stapler`, architecture, liveness, and checksum checks before either architecture can be uploaded. Both architecture jobs must pass before the combined manifest exists; the workflow has no release-write permission.

Actionlint 1.7.12 accepted the new workflow. All 113 frontend/delivery script tests passed, including seven icon contracts and four signing-boundary contracts. TypeScript checking, the unchanged production frontend build, Rust formatting, 64 workspace tests, and strict all-target workspace Clippy also passed. The fresh Linux release executable is 18,253,848 bytes, 61,440 bytes or 0.34% above the preceding platform-chrome build; this is **no material change** and is attributable only as a matched aggregate, not solely to icon embedding. No resource series was run, so memory remains **inconclusive**.

The refreshed Debian package is `Asterlyn_0.1.0_amd64.deb`, 6,209,746 bytes, with SHA-256 `e5bd01f729c37a4690d6d670255bcb8cbcea862f83961496abd66d781d7ff0b0`. It is 5,356 bytes or 0.09% above the previous package and contains the desktop entry plus 32/48/128/256/512 icon representations. Linux runtime icon selection is **improved** and the macOS source geometry is **improved pending real-device visual acceptance**. macOS trust is **inconclusive** rather than accepted: as of 2026-09-10 the remote repository has no protected `main`, `macos-signing` environment, Apple credentials, signed workflow run, or clean-machine Gatekeeper result. Provisioning those protected controls and installing the resulting DMGs on Intel and Apple-silicon Macs are the required next delivery actions.

## Limits and next action

The browser demo can validate the prompt and title/tab behavior but cannot create an operating-system window. Rust ownership tests and the release build validate that native boundary; installed Windows/macOS interaction remains deferred to release-candidate work as previously agreed. Window sessions and dirty buffers are not yet restored after process restart. Shared profile preferences and recent-project hints intentionally remain common to all windows, while active repositories and editor sessions are isolated.

Interaction, authorization isolation, and platform-asset consistency are **improved**. Frontend size has **no material change**, native executable size is **regressed**, and memory remains **inconclusive**. E3.2 editor groups and tab movement remains the next product slice.
