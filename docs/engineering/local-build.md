# Local build environment

## Common prerequisites

- Node.js 22 or newer and npm.
- Rust installed with `rustup`; the repository's minimum supported compiler is recorded in the workspace manifest.
- Git 2.31 or newer for the porcelain v2 and restore behavior used by M1.

Install frontend dependencies and verify the independent layers:

```bash
npm install
npm run check
npm run build
cargo test -p asterlyn-git
```

## Linux desktop prerequisites

Tauri 2 uses WebKitGTK 4.1 on Linux. A normal development machine should install the distribution packages recommended by Tauri, including WebKitGTK 4.1, JavaScriptCoreGTK 4.1, libsoup 3, GTK 3, librsvg 2, and their development metadata.

When administrator access is unavailable on a Debian-family machine whose runtime libraries are already compatible, this repository provides an isolated fallback:

```bash
scripts/setup-linux-tauri-local.sh
scripts/with-linux-tauri-env.sh cargo check -p asterlyn
scripts/with-linux-tauri-env.sh npm run tauri -- build
```

The setup helper downloads distribution packages and extracts them into a user-owned, Asterlyn-specific sysroot. It does not register or modify system packages. This fallback is for local development; official artifacts must be built in clean, pinned CI images with ordinary system development packages.

Deepin 23 may expose a GPU render node while denying the KMS buffer operation used by WebKitGTK, which results in a window that is present but never paints. Asterlyn selects WebKitGTK software compositing on Deepin when the standard `WEBKIT_DISABLE_COMPOSITING_MODE` variable is not already defined. Other Linux distributions keep the WebKitGTK default. This compatibility rule must be rechecked when the distribution WebKitGTK package changes.

## Frontend-only development

`npm run dev` starts the interface in browser demo mode when the Tauri bridge is absent. Demo mode is deliberately visible in the title bar and never claims to read or mutate the entered repository. It exists for fast layout, interaction, and accessibility work; native behavior is accepted only through Rust integration tests and a desktop smoke test.

## Platform icon generation

[`../../assets/asterlyn-mark.svg`](../../assets/asterlyn-mark.svg) is the only hand-maintained application-icon source. The mark uses the complete square canvas. The generator preserves that full-canvas artwork for Windows and Linux, then derives a centered macOS-only representation whose visible alpha bounds occupy approximately 82% of the ICNS canvas. This keeps the same mark while matching the visual safe area used by neighboring macOS Launchpad icons instead of shrinking every platform. Regenerate the maintained desktop set atomically with the repository-pinned helper:

```bash
npm run icons:generate
npm run test:scripts
```

Do not retouch files under `src-tauri/icons/` individually. The helper generates into a temporary directory and then replaces that directory with only the targets declared by the current desktop bundle: 32, 48, 128, 256, and 512 pixel PNGs, one Windows ICO containing 16/24/32/48/64/256 pixel frames, and one macOS ICNS containing modern Retina frames. The 128-pixel PNG intentionally appears first in `bundle.icon`: the locked Tauri Unix runtime selects the first PNG for the native window icon, so leading with 32 pixels makes Linux docks upscale a visibly small/soft source even though larger package icons exist. Script tests lock both this ordering and the macOS visual envelope. Mobile launcher sets and Windows Store/AppX tiles are deliberately discarded because Asterlyn does not ship those targets. Adding a mobile or AppX target must add its platform-specific source and validation in the same change instead of retaining unused generated history.

## Local performance evidence

Run the release inspection utility to separate interactive tracked latency from deferred untracked discovery:

```bash
cargo run --release -p asterlyn-git --example inspect -- /path/to/repository 10
```

Measure the complete bounded workspace-search path, including a fresh Git-authorized catalog on every iteration, with:

```bash
scripts/with-linux-tauri-env.sh cargo run --release -p asterlyn --example inspect_search -- /path/to/repository 'literal query' 10
```

The utility uses the same candidate, byte, match, preview, pattern, context, and reported-skip limits as the desktop boundary. Append `--regex` for line-local regular expressions, repeat `--include <glob>` or `--exclude <glob>` for full workspace-path filters, and use `--context <0-3>` for preview context. Record its catalog, scan, and total distributions together with total and eligible candidate counts, bytes read, match count, skipped files, query/options, repository state, and machine context.

Measure non-mutating workspace-replacement planning, including the fresh Git catalog, bounded search, exact reread, replacement encoding, and preview construction, with:

```bash
scripts/with-linux-tauri-env.sh cargo run --release -p asterlyn --example inspect_replacement -- /path/to/repository 'literal query' 'replacement text' 10
```

It accepts the same regex, include, exclude, and context flags as `inspect_search`, uses production limits, and never applies the plan. Record replacement-file/match counts, skips, coverage, and catalog/plan/total distributions. A structural coverage limit intentionally makes the command fail because the product would also refuse to present an incomplete replacement as safe.

On Linux, repeat steady-state process-tree PSS, RSS, and idle CPU sampling with:

```bash
scripts/measure-linux-process-tree.sh target/release/asterlyn /path/to/repository
```

The memory helper launches only the supplied local binary and repository, waits 60 seconds by default, samples every descendant process through `/proc`, and terminates each launched instance after the sample. It is evidence collection rather than a portable benchmark harness; record the machine, repository state, build profile, run count, and limitations with accepted results.

## Packaging policy

- Every completed local project task ends with a fresh Debian acceptance package after its required checks pass:

  ```bash
  scripts/with-linux-tauri-env.sh npm run tauri -- build --bundles deb
  sha256sum target/release/bundle/deb/*.deb
  ```

  Report the exact package path, byte size, and SHA-256 digest for manual acceptance. This local package does not imply a remote push, release publication, signing, or cross-platform acceptance.
- Build release artifacts independently on Windows, macOS, and Linux rather than cross-packaging a webview shell from one OS.
- The preview matrix and its trust boundary are documented in [`ci.md`](ci.md).
- Signing/notarization credentials belong in protected CI facilities, never repository files.
- Record compiler/runtime versions, artifact hashes, SBOM, startup/memory evidence, and smoke-test results with each preview or stable release.
- The user-owned Linux sysroot is not bundled into the application; Linux uses the supported system WebKitGTK runtime.
