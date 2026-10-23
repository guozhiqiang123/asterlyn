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

## Repository publication policy

Remote publication from this checkout must use Asterlyn's own reviewed Push boundary. Do not use a
direct shell `git push` as the normal automation or maintainer path: the current host environment
has produced credential or permission mismatches through that route, and it also bypasses the
product behavior that this repository is intended to exercise.

The required sequence is:

1. Perform a read-only preflight and record the clean worktree, exact `HEAD`, current branch,
   selected remote, destination ref, and outgoing commit count.
2. Open [`GitRepository`](../../crates/asterlyn-git/src/repository.rs) and call
   `push_preview_with_tags`. Verify the expected source/destination route, exact `HEAD`, commit
   range, ordinary-push eligibility, and explicit tag mode.
3. Pass that preview's opaque token to `push_current_with_options` on the same repository identity.
   Ordinary mode with `PushTagMode::None` is the default. Tags or `ForceWithLease` require separate,
   explicit user authorization and a newly reviewed preview; raw force is never permitted.
4. After success, independently read the remote branch and verify that the local ahead/behind range
   is zero. A stale preview, rejected push, authentication/network failure, cancellation, or unknown
   outcome must stop the workflow. Reconcile before another review and never retry blindly.

For terminal-driven automation, a disposable, uncommitted Rust caller may link to the local
`asterlyn-git` crate and invoke those public methods. It must bind the expected `HEAD`, branch,
remote, destination, commit count, mode, and tag scope before the network write, print no remote URL
or credentials, and be removed after verification. Do not add or rewrite credential configuration
to make publication succeed; Asterlyn inherits the user's existing non-interactive Git/SSH
credential facilities.

The core ultimately invokes system Git without a shell. This policy therefore prohibits bypassing
the reviewed Asterlyn boundary, not the Git executable behind that boundary. On 2026-09-13, the R4
range of four commits was published from `main` to `origin/main` in ordinary/no-tags mode through
`push_preview_with_tags` followed by `push_current_with_options`; an independent remote read
confirmed `7a68bad17794f87d67580bcecbb9ab5ff2737434`, and the resulting range was 0 ahead / 0 behind.

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

The native smoke launcher must not share Linux desktop persistence with an installed Asterlyn profile. It overrides only XDG cache, configuration, data, and state roots below a disposable smoke-profile directory, preserves the user's real home, and removes that profile together with its temporary Git repository. Application startup independently treats an unreadable recent-project hint as recoverable and returns to the system folder chooser. These are complementary boundaries: profile isolation prevents test pollution, while startup recovery handles paths removed outside Asterlyn.

## Editor font assets

JetBrains Mono is the only bundled editor family. Its exact Fontsource dependency and OFL resource path must change together. Optional editor fonts are presentation-owned downloads declared in `src/workbench/editor-fonts.ts`; do not add those packages to production dependencies. Every optional entry must use an immutable versioned HTTPS URL on the existing CSP origin, a reviewed OFL-compatible license, a measured size below the hard limit, and a freshly computed SHA-256 digest. A version or file change without its matching digest must fail integrity verification rather than silently update the user's typography.

After changing the catalog, run the full script suite and production build, exercise one first-use download plus one cached reload, and inspect the native package for the single bundled-font license. Keep arbitrary URLs, filesystem font paths, unverified cache entries, redirects, and automatic fallback preference changes outside this boundary.

## Platform icon generation

[`../../assets/asterlyn-mark.svg`](../../assets/asterlyn-mark.svg) is the only hand-maintained application-icon source. The mark uses the complete square canvas. The generator preserves that full-canvas artwork for Windows and Linux, then derives a centered macOS-only representation whose visible alpha bounds occupy approximately 82% of the ICNS canvas. This keeps the same mark while matching the visual safe area used by neighboring macOS Launchpad icons instead of shrinking every platform. Regenerate the maintained desktop set atomically with the repository-pinned helper:

```bash
npm run icons:generate
npm run test:scripts
```

Do not retouch files under `src-tauri/icons/` individually. The helper generates into a temporary directory and then replaces that directory with only the eight targets declared by the current desktop bundle: six 32, 48, 64, 128, 256, and 512 pixel PNGs, one Windows ICO containing 16/24/32/48/64/256 pixel frames, and one macOS ICNS containing modern Retina frames. The 128-pixel PNG intentionally appears first in `bundle.icon` because the locked Tauri Unix runtime selects the first PNG for the native window icon. That runtime payload is distinct from a desktop environment's named theme-icon lookup: Deepin 23's dock asks `DciIcon` for a 64-pixel source and then scales that source to the configured dock size. A missing exact 64-pixel raster caused Qt to preserve a 32-pixel source inside the 64-pixel paint area, producing a half-sized dock mark.

Linux desktop packages use the stable reverse-DNS theme key `dev.asterlyn.desktop` rather than the earlier generic `asterlyn` key. A same-session upgrade probe showed that Deepin retained the old key's 32-pixel resolution even after an exact 64-pixel file appeared; the same file under the namespaced key resolved at the intended dock size immediately. The custom desktop template and explicit AppImage, Debian, and RPM file maps therefore ship that key at all six PNG sizes. Script tests lock the desktop key, every package mapping, the first runtime PNG, the exact 64-pixel Linux source, and the macOS visual envelope. Mobile launcher sets and Windows Store/AppX tiles are deliberately discarded because Asterlyn does not ship those targets. Adding a mobile or AppX target must add its platform-specific source and validation in the same change instead of retaining unused generated history.

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

The Tauri build hooks compile `asterlyn-plugin-host` for the exact
`TAURI_ENV_TARGET_TRIPLE` and atomically stage it under `src-tauri/binaries/` using Tauri's required
target-suffixed sidecar name. Do not hand-copy, rename, download, or reuse a helper from another
target/profile. `tauri build` then embeds the helper through `bundle.externalBin`; a missing helper
must fail packaging instead of producing an application that advertises external plugins without
their isolation boundary. Generated helper binaries are ignored by Git and must never be committed.

### Canonical macOS local acceptance flow

The local macOS package is an unnotarized, ad-hoc-signed development artifact. A successful Tauri
compile is not sufficient evidence: depending on the local toolchain, the executable may retain only
its Mach-O linker signature while `Info.plist` and bundle resources remain unsealed. That incomplete
state typically reports a generated identifier such as `asterlyn-<hash>`, `Info.plist=not bound`, or
`Sealed Resources=none`; it must never be archived or installed.

Run this sequence in order after the task's required checks pass:

```bash
npm run check
npm run test:scripts
npm run build

APPLE_SIGNING_IDENTITY=- npm run tauri -- build --bundles app
codesign --force --deep --sign - --options runtime target/release/bundle/macos/Asterlyn.app
codesign --verify --deep --strict target/release/bundle/macos/Asterlyn.app
codesign -dvv target/release/bundle/macos/Asterlyn.app
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  target/release/bundle/macos/Asterlyn.app/Contents/Info.plist

npm run test:native:rendered
ASTERLYN_PACKAGE_VERSION=x.y.z
ditto -c -k --sequesterRsrc --keepParent \
  target/release/bundle/macos/Asterlyn.app \
  "target/release/bundle/macos/Asterlyn-${ASTERLYN_PACKAGE_VERSION}-macos.app.zip"
shasum -a 256 "target/release/bundle/macos/Asterlyn-${ASTERLYN_PACKAGE_VERSION}-macos.app.zip"
```

The explicit `codesign --force --deep --sign - --options runtime` step is mandatory for local
acceptance even when `APPLE_SIGNING_IDENTITY=-` was supplied to Tauri. It deterministically seals the
final `.app` after bundling and avoids treating a linker-only executable signature as a signed
application bundle. The strict verification must pass, and inspection must report all of:

- `Identifier=dev.asterlyn.desktop`;
- `Signature=adhoc`;
- a sealed-resources record rather than `Sealed Resources=none`;
- the expected application version from `Info.plist`.

Archive only after those checks. A DMG created before the final bundle signature is stale because it
contains the pre-signing `.app`; do not install or publish it. A workflow that needs a DMG must make
Tauri perform ad-hoc signing before DMG construction and must mount the finished image and run the
same strict verification against the contained `.app`.

For local replacement, use the repository-owned installer after signing and smoke acceptance:

```bash
node scripts/install-macos-app.mjs \
  --source target/release/bundle/macos/Asterlyn.app \
  --evidence /tmp/asterlyn-local-install-evidence.json
```

The installer gracefully stops the installed app and archives it under
`~/Library/Application Support/Asterlyn/archived-install-backups/`. Backups are ZIP files only,
verified by complete archive CRC and executable digest before replacement. Never retain expanded
`.app` or `.app.backup-*` backup folders: macOS can retain icon bookmarks to those folders even
when LaunchServices correctly resolves the bundle ID to `/Applications/Asterlyn.app`.

Do not move, rename, delete/recreate, or replace the installed `.app` root. The installer stages
`Contents` outside the bundle, checks the full copy's files/modes/symlinks, and atomically exchanges
`Contents` using Darwin `RENAME_SWAP`. This preserves the `.app` root inode and its icon identity.
Strict installed signature and executable digest checks follow; verification failure exchanges the
old contents back. If rollback also fails, the previous contents remain in a named recovery stage.
Do not bypass these checks by copying directly into the live bundle.

Only Asterlyn Launchpad entries are reconciled. The oldest icon's item/parent/order are retained,
its bookmark targets the canonical installed application, and duplicate Asterlyn entries are removed
in one SQLite transaction with schema-drift guards. The database is backed up first; unrelated app
entries are checked unchanged. Dock is briefly reloaded to discard cached icon bookmarks. This is
not a global LaunchServices reset, preference deletion, or Launchpad layout reset. If the database
is unavailable, evidence explicitly records that icon-entry validation was unavailable.

Acceptance must launch via the saved icon bookmark, confirm the installed process and persisted
`application.frontend_ready`, quit, then reopen through that bookmark and repeat the checks.
Direct executable or explicit-path launch alone cannot prove a saved icon works. The helper also
unregisters the build copy and force-registers the installed bundle. Its evidence records version,
hashes, ZIP backup, preserved inode, targeted icon repair, and both startup sessions. The local build
requires the macOS developer tools (Swift), system SQLite, `ditto`, and `unzip` in addition to Tauri.

Historical expanded backup locations mentioned by earlier acceptance documents were migrated into
verified archives on 2026-10-23; see
[`../benchmarks/2026-10-23-macos-icon-launch-recovery.md`](../benchmarks/2026-10-23-macos-icon-launch-recovery.md).

- Every completed local project task ends with a fresh native acceptance package for its build host after its required checks pass. On Linux, build Debian:

  ```bash
  scripts/with-linux-tauri-env.sh npm run tauri -- build --bundles deb
  sha256sum target/release/bundle/deb/*.deb
  ```

  On macOS, follow the canonical flow above; signing, strict verification, native smoke, archive,
  and hashing are one ordered acceptance transaction. This is macOS acceptance, not a substitute
  for the Linux gate. Windows uses its native bundle target.

  Report the exact package path, byte size, and SHA-256 digest for manual acceptance. Local ad-hoc
  signing proves bundle integrity only; it does not imply a remote push, release publication,
  certificate-backed signing, notarization, or cross-platform acceptance.
- After a local Asterlyn bug fix passes its checks, replace the existing installed app with the freshly built native bundle. Codex verifies the bundle and performs the installation. If the app is running, stop it before replacement and relaunch it afterward; the user has authorized this without a separate shutdown confirmation. Verify that the installed bundle matches the accepted build. Never install an older bundle when the current build fails.
- Build release artifacts independently on Windows, macOS, and Linux rather than cross-packaging a webview shell from one OS.
- The preview matrix and its trust boundary are documented in [`ci.md`](ci.md).
- The current public Release intentionally uses unsigned Windows packages and ad-hoc macOS signing without notarization. If commercial signing is adopted later, its credentials belong in protected CI facilities, never repository files.
- Record compiler/runtime versions, artifact hashes, SBOM, startup/memory evidence, and smoke-test results with each preview or stable release.
- The user-owned Linux sysroot is not bundled into the application; Linux uses the supported system WebKitGTK runtime.
