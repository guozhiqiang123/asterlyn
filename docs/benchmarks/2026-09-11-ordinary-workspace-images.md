# Ordinary workspace and image-preview evidence

## Scope and decisions

This correction makes the project-folder chooser independent from Git, adds a compact application-owned checkbox, completes the commit-detail file toolbar, and introduces bounded raster preview for project files plus working and committed image Diff. Android Studio remains interaction-density reference only; Asterlyn uses original controls, icons, styles, and implementation.

An opened project is a canonical workspace root with optional Git capability. Git is present only when that exact root is the discovered worktree root. Ordinary folders, including a selected child of another repository, receive the explicit `workspace` file identity. Every ordinary read or save regenerates the bounded catalog identity before the workspace layer repeats component traversal and regular-file checks. Every Git command independently requires the active window's Git capability, so disabled presentation controls are not the security boundary.

## Image boundary and dependency record

Rust reads image bytes only through a current authorized project identity or a freshly revalidated `FileChange`/`CommitDetails` identity. Content signatures, not extensions, choose one fixed output media type. PNG, JPEG, static GIF, static WebP, BMP, and ICO are supported. APNG, animated GIF, animated WebP, SVG, unknown signatures, links, non-files, oversized inputs, and excessive decoded dimensions fail closed. Each source is limited to 16 MiB and 16 million pixels; a two-sided Diff is limited to 24 million aggregate pixels. The operating-system WebView performs raster decoding from a base64 data URL, so this change adds no image-decoder library, temporary image file, network request, or general Git-object endpoint.

The only newly direct dependency is `base64` 0.22.1, used to serialize already authorized bytes into fixed-media-type data URLs. It is licensed `MIT OR Apache-2.0`, originates from `https://github.com/marshallpierce/rust-base64`, and is locked with crates.io SHA-256 checksum `72b3254f16251a8381aa12e40e3c4d2f0199f8c6508fbecb9d91f575e0fbb8c6`. Version 0.22.1 was already present transitively through Tauri code generation, so the direct declaration adds no second crate version or decoder payload.

## Interaction and accessibility evidence

The deterministic browser workbench verified the following behavior:

- An ordinary-folder open keeps Files active and displays `Folder · Git unavailable`; Branches, Changes, and remote sync are disabled and the Git bottom dock is absent.
- A Markdown file from the ordinary catalog opens as an editable source tab with UTF-8 status, and a PNG opens as a selected read-only Preview tab with dimensions and byte size. Find in Files searched all ten ordinary-folder candidates, returned two matches, and opened the selected root-qualified result through the same authorization path.
- Starting the delayed PNG read and immediately selecting `README.md` left one mounted CodeMirror editor, zero mounted image surfaces, and `README.md` as the selected tab after the image response arrived. The generation, workspace-root, and document-key guard also has a focused pure-state test.
- The Git commit-detail third column exposes named tree/flat, expand-all, and collapse-all controls. Collapsing reaches zero open folder disclosures and expanding restores all five fixture directories without changing the selected commit.
- Checked controls render at 14 by 14 pixels with native appearance removed, a blue rounded checked/indeterminate surface, hover treatment, visible two-pixel keyboard focus, and a disabled state. Labels and group counts remain the authoritative accessible names.
- Image preview uses an `Image preview` region, labelled figure, descriptive image alternative text, dimensions, and byte size. Empty added/deleted Diff sides use explicit text rather than a broken image.

This production-like browser journey verifies routing, disclosure, disabled-state semantics, and accessible naming. It does not measure installed WebView frame times or replace manual inspection of representative large images on Linux, macOS, and Windows.

## Automated validation

- TypeScript checking and the production frontend build pass.
- All 159 frontend and delivery script tests pass. Image routing covers every advertised extension and refuses SVG, text, and extensionless files; stale completion tests vary generation, workspace, and document identity independently.
- The Rust workspace passes 39 Git-core and 25 workspace-core tests. The desktop boundary passes 17 library tests plus one binary test.
- Git fixtures verify fresh working-tree image sides and first-parent commit sides. Workspace fixtures verify deterministic ordinary catalogs, `.git` and link exclusion, truncation, bounded binary reads, and path rejection. Desktop fixtures verify exact-root Git detection, ordinary nested-folder behavior, active-window Git denial, six static image signatures, animation rejection, and pixel limits.
- Rust formatting, strict all-target Clippy, diff whitespace checks, release-native liveness, and Debian package inspection pass.

The production frontend transforms 222 modules. Main CSS is 90.57 kB raw and 21.31 kB gzip; main JavaScript is 678.46 kB raw and 194.71 kB gzip. Against the preceding 87.67 kB CSS and 668.04 kB JavaScript, frontend size is **regressed** by 2.90 kB CSS and 10.42 kB JavaScript. The existing greater-than-500-kB main-chunk warning remains; image code introduced no additional lazy or decoder chunk.

## Resource model, package, and conclusion

Only the active image document mounts decoded pixels. One preview can require at most approximately 64 MiB of RGBA decode memory; a two-sided Diff is capped at approximately 96 MiB aggregate decoded pixels, in addition to at most 32 MiB source bytes and their base64 strings. This is a hard upper bound rather than an observed steady-state increase. Runtime memory remains **inconclusive** until matched ordinary-text, single-image, and image-Diff process-tree series are collected on installed WebViews.

The locally built Debian package is `Asterlyn_0.1.0_amd64.deb`, version 0.1.0 for `amd64`, with installed size 18,995 KiB, archive size 6,720,022 bytes, and SHA-256 `d727c0800aa7cc56fc92c1587291e48f23458c13f2b47d183d3873f4fc93a4d0`. Against the preceding 6,646,092-byte archive, package size is **regressed** by 73,930 bytes (1.11%). The release executable is 19,249,408 bytes, an increase of 264,272 bytes (1.39%) from 18,985,136 bytes. This small binary/package increase is consistent with the new workspace and image-boundary code rather than a bundled decoder. The release executable remained alive for the complete six-second native smoke observation, so package construction and startup are **improved** from unverified to accepted for this correction. No remote push was performed.

Functionality, capability isolation, and interaction are **improved**. Ordinary folders no longer fail at the Git boundary, Git cannot be invoked through a presentation bypass, checkboxes and commit-file controls are compact and discoverable, and supported raster changes have truthful before/after presentation. Remaining limits are read-only images, no zoom/pan or metadata, no animation, no SVG sanitization, no perceptual/pixel overlay, no image-cache policy, and no installed Windows/macOS interaction evidence. Manual acceptance should verify checkbox density, ordinary-folder editing/search, disabled Git affordances, representative PNG/JPEG/WebP previews, added/modified/deleted image Diff, and commit-detail folder controls in the packaged Linux application.
