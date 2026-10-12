# In-app update acceptance — 2026-10-12

## Accepted scope

Asterlyn now owns one update state machine for the packaged desktop application:

- the ready shell starts a non-blocking background check without delaying project opening;
- Settings can repeat the same check and shows the exact package selected for the current platform;
- a newer installable Release opens an explicit confirmation dialog;
- confirmation downloads through the native boundary, verifies the Release byte count and SHA-256, launches the platform replacement flow, exits, and attempts to reopen Asterlyn;
- failures remain visible with the official Asterlyn Release page as a manual fallback.

The renderer never supplies an installer URL, local path, digest, command, or version to the native installation command. Native code reloads the latest stable Release and selects one repository-owned asset for macOS ARM64/x64, Windows x64, or the detected Linux x64 installation type (AppImage, Debian, or RPM).

## Automated evidence

- `npm run test:scripts`: **957 passed, 0 failed**. This includes startup/manual update behavior, explicit confirmation, duplicate suppression, install failure recovery, dialog accessibility markup, protocol coherence, release-workflow artifact checks, and frontend ownership budgets.
- `npm run build`: production TypeScript and Vite build passed. The main application chunk is **439.84 kB** before gzip, below the enforced 500 kB application-chunk limit.
- `cargo test --workspace --locked`: **278 passed, 0 failed, 2 ignored**. The ignored tests are the existing native operating-system watcher probes; updater tests cover stable numeric versions, exact platform selection, ambiguity rejection, repository URL/digest/size bounds, and platform replacement scripts.
- `cargo clippy --workspace --locked --all-targets -- -D warnings`: passed.
- `cargo fmt --all -- --check`, protocol regeneration, version consistency, and `git diff --check`: required before handoff.

## Resource and interaction bounds

- Startup performs one fire-and-forget update request after shell readiness; project initialization is not awaited behind network I/O.
- Release checks use bounded connection/total timeouts. Installer transfers have a 512 MiB metadata and curl transfer ceiling, then an exact local byte-count check.
- SHA-256 is calculated as a 64 KiB stream; the installer is never copied into renderer memory or held as one Rust byte buffer.
- The confirmation surface uses `role="dialog"`, `aria-modal`, a labelled title, a polite status region, initial focus, focus restoration, Escape/cancel/outside-click handling when safe, and reduced-motion spinner behavior.
- Installation cannot be dismissed or started twice while the native operation is active.

## Honest limits

The currently published v0.1.4 Release equals the development version, so an end-to-end destructive replacement with a newer public package was not triggered during this acceptance. Replacement commands are covered by unit construction tests and the existing cross-platform Release artifact contract; the next version must still receive packaged manual acceptance on each target platform.

Windows artifacts remain unsigned. macOS artifacts remain ad-hoc signed and unnotarized. SHA-256 verifies the package against GitHub Release metadata but does not provide an independent trust authority if the GitHub repository is compromised. System warnings and authorization prompts remain expected.
