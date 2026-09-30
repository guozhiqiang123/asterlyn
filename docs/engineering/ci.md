# Continuous integration and preview packaging

## Current scope

`Package preview` is the first cross-platform delivery gate. It runs on pushes to `main`, pull requests, and explicit manual dispatch. A Linux quality job must pass before native packages are built for:

- Linux x86_64 on Ubuntu 22.04.
- Windows x86_64 on the current GitHub-hosted Windows image.
- macOS Apple Silicon and Intel on the current GitHub-hosted macOS image.

The workflow uploads unsigned Windows/Linux and ad-hoc-signed macOS short-lived workflow artifacts plus a SHA-256 manifest for every target. It does not create a Git tag or GitHub Release and does not receive signing, notarization, updater, or publishing credentials.

After bundling, each target launches its freshly built native executable against a disposable Git repository containing both tracked and untracked changes. The process must remain alive for a six-second observation window and is then terminated as a process tree. The launcher gives Linux a disposable XDG application profile so its temporary repository cannot enter an installed user's recent-project state. Linux runs under a temporary Xvfb display; Windows and macOS run directly on their hosted runners. An early exit fails the target and reports bounded stdout/stderr diagnostics.

The quality job checks TypeScript, builds the frontend, runs all script tests, checks Rust formatting,
installs the Linux desktop development libraries, and tests/lints the complete Cargo workspace.
Native watcher tests are explicitly run with `--ignored`; being ignored in the default unit suite
must not remove them from CI acceptance. Workspace and desktop application tests are required in
addition to Git-core tests. The Windows packaging job also runs `asterlyn-workspace` tests natively
before bundling, including the stable Win32 opened-file identity checks used by reviewed workspace
mutations.

## Trust boundary

- Workflow permissions are limited to repository-content read access.
- Checkout credentials are removed before project-controlled build scripts run.
- Pull requests use `pull_request`, never the privileged `pull_request_target` event.
- External actions are pinned to immutable commit hashes. The adjacent version comments document the reviewed upstream release.
- Dependency installation uses `npm ci` and Cargo's committed lock file.
- Preview and release publication remain separate. The preview workflow is read-only. The Release workflow is also read-only while testing and packaging; only its final tag-only publication job receives `contents: write`.
- Commercial signing and notarization credentials are intentionally absent. The release workflow fails if a macOS package acquires a certificate-backed authority or if a Windows installer is anything other than `NotSigned`.

## In-application Release discovery

Settings exposes a manual update check against the fixed
`https://github.com/guozhiqiang123/asterlyn/releases/latest` endpoint. The native boundary follows
the GitHub redirect, compares its Release tag with the packaged Cargo version, and returns only
structured version, timestamp, status, and repository-scoped Release URL data to the frontend. The
request is bounded by connection and total timeouts, runs outside the UI thread, and accepts no
repository or request URL from workspace content. Opening the result is separately allowlisted to
this repository's Release pages.

This is discovery only: Asterlyn does not download, verify, install, or activate an artifact. A
missing Release or unavailable network is a visible checked error, not evidence that the current
build is latest. Preview workflow artifacts are not Releases and therefore never appear as an
available update. Signed update manifests, artifact verification, rollback, and automatic
installation remain later release-channel work under the existing trust gates.

## Evidence policy

A green matrix proves that compilation, bundling, and bounded process-liveness smoke checks succeeded on the named hosted-runner images. It does not prove that the window painted correctly or that user interaction worked. Before an artifact becomes a release candidate, record its hash and perform a launch/workflow smoke test on real hardware or a declared equivalent interactive environment. macOS artifacts use ad-hoc signing only to preserve bundle integrity and are not notarized; every public Release must disclose that limitation and the supported System Settings approval path.

When a pinned action is updated, review its release notes and source provenance, change the hash and version comment together, and treat the resulting workflow run as new acceptance evidence.

## Zero-cost GitHub Release

`Release` implements the accepted first-version distribution policy without commercial platform certificates. A manual dispatch from `main` is a complete rehearsal: it runs the release quality gates, generates dependency evidence, builds every package, verifies platform signing policy, launches every native executable, stages exact public assets, and uploads short-lived workflow artifacts, but it cannot publish. A `v*.*.*` tag whose commit is reachable from `origin/main` runs the same graph and enables the final publication job. The tag must exactly match the synchronized versions in the npm lock/package metadata, Tauri configuration, and every first-party Cargo package.

The public package set is:

- Linux x86_64: AppImage, Debian package, and RPM package.
- Windows x86_64: one unsigned NSIS installer. PowerShell must report `NotSigned`; an unexpected Authenticode signature fails the job.
- macOS Apple Silicon and Intel: one DMG per architecture. `APPLE_SIGNING_IDENTITY=-` requests ad-hoc signing; `codesign --verify --deep --strict` must pass, `Signature=adhoc` must be present, and any certificate authority fails the job. No notarization request is made.

Every target performs a bounded native-process smoke test and publishes a target-specific SHA-256 manifest. The publication job downloads all four target sets plus CycloneDX manifests for the frontend and five Rust packages, verifies every package against its originating manifest, emits one combined `SHA256SUMS`, and only then creates the GitHub Release. Release notes disclose Windows' unknown-publisher warning and macOS' unnotarized first-launch approval requirement in English and Chinese.

The only write authority is the tag-only `publish` job's ephemeral GitHub token. No Apple certificate, Apple account, Windows certificate, updater private key, or persistent checkout credential enters the workflow. A later move to Developer ID/notarization or Windows Authenticode is a policy change, not a secret-injection shortcut: update this document, the workflow assertions, user-facing release notes, and clean-machine acceptance evidence together.

This policy accepts installation friction in exchange for zero certificate cost. It does not represent ad-hoc signing as Apple trust, and support instructions must use the operating system's visible approval UI rather than removing quarantine attributes. Automatic installation remains out of scope; the application only discovers the latest GitHub Release and opens its page.

## Accepted packaging evidence — 2026-09-08

The [`Package preview` run 34197199295](https://github.com/guozhiqiang123/asterlyn/actions/runs/34197199295) passed from source commit `234d6115a0d22986ef2bbe8f936f01816f98b887`:

- Quality gates passed in 36 seconds.
- macOS Apple Silicon packaging passed in 2 minutes 58 seconds.
- macOS Intel packaging passed in 3 minutes 8 seconds.
- Windows x86_64 packaging passed in 4 minutes 13 seconds.
- Linux x86_64 packaging passed in 5 minutes 54 seconds.
- GitHub retained 13 non-expired workflow artifacts: nine package/application archives and four target-specific SHA-256 manifests.

**Conclusion: improved.** Clean hosted runners can compile and package the same revision for all four target combinations, and every target publishes a checksum manifest. This accepts the M1 cross-platform compilation and packaging gate. It does not accept real-device launch behavior, signing, notarization, updater behavior, or release publication; those remain separate gates.

The immediately preceding run exposed one workflow-only defect: package creation succeeded on every target, but checksum manifests were written below a hidden directory that artifact upload ignored. Moving those manifests to a non-hidden CI output directory resolved the failure without changing application or package content.

## Accepted native process smoke evidence — 2026-09-08

The [`Package preview` run 34199137559](https://github.com/guozhiqiang123/asterlyn/actions/runs/34199137559) passed from source commit `29cd7e1aa0ee671cd0e73bd23197576e65d3d08c`:

- Delivery-script tests passed, including expected acceptance of a live process, rejection with diagnostics for an early exit, and disposable-repository fixture verification.
- Linux x86_64 launched under Xvfb and remained alive for the full 6,000 ms observation window.
- Windows x86_64 launched directly and remained alive for the full 6,000 ms observation window.
- The bundled macOS Apple Silicon executable launched directly and remained alive for the full 6,000 ms observation window.
- The bundled macOS Intel executable launched directly and remained alive for the full 6,000 ms observation window.
- All four jobs subsequently regenerated and uploaded their package checksum manifests.

**Conclusion: improved.** The delivery matrix now rejects native binaries that are missing or terminate during startup on their target hosted environment. The smoke launcher invokes processes without a shell, bounds captured diagnostics, terminates the process tree, and removes its temporary repository.

This evidence is intentionally narrower than an interactive smoke test. It does not prove window painting, focus/accessibility behavior, installed-package integration, or the open → inspect → stage → commit workflow on Windows and macOS. The next delivery action is an interactive test of installed artifacts on those platforms or a documented equivalent environment.
