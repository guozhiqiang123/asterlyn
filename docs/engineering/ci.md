# Continuous integration and preview packaging

## Current scope

`Package preview` is the first cross-platform delivery gate. It runs on pushes to `main`, pull requests, and explicit manual dispatch. A Linux quality job must pass before native packages are built for:

- Linux x86_64 on Ubuntu 22.04.
- Windows x86_64 on the current GitHub-hosted Windows image.
- macOS Apple Silicon and Intel on the current GitHub-hosted macOS image.

The workflow uploads unsigned, short-lived workflow artifacts plus a SHA-256 manifest for every target. It does not create a Git tag or GitHub Release and does not receive signing, notarization, updater, or publishing credentials.

After bundling, each target launches its freshly built native executable against a disposable Git repository containing both tracked and untracked changes. The process must remain alive for a six-second observation window and is then terminated as a process tree. Linux runs under a temporary Xvfb display; Windows and macOS run directly on their hosted runners. An early exit fails the target and reports bounded stdout/stderr diagnostics.

## Trust boundary

- Workflow permissions are limited to repository-content read access.
- Checkout credentials are removed before project-controlled build scripts run.
- Pull requests use `pull_request`, never the privileged `pull_request_target` event.
- External actions are pinned to immutable commit hashes. The adjacent version comments document the reviewed upstream release.
- Dependency installation uses `npm ci` and Cargo's committed lock file.
- Signing and release publication use separate workflows. Signing requires the protected `macos-signing` environment and an explicitly approved manual dispatch from `main`; release publication remains outside both packaging workflows.

## Evidence policy

A green matrix proves that compilation, bundling, and bounded process-liveness smoke checks succeeded on the named hosted-runner images. It does not prove that the window painted correctly or that user interaction worked. Before an artifact becomes a release candidate, record its hash and perform a launch/workflow smoke test on real hardware or a declared equivalent interactive environment. Unsigned macOS artifacts use ad-hoc signing only to preserve bundle integrity; they are not notarized and should not be presented as end-user releases.

When a pinned action is updated, review its release notes and source provenance, change the hash and version comment together, and treat the resulting workflow run as new acceptance evidence.

## Signed macOS distribution

`Signed macOS package` is isolated from pull requests, ordinary pushes, preview packaging, and release publication. It accepts only a manual dispatch whose source is `refs/heads/main`, checks out `github.sha` without persisted credentials, and has repository-content read permission. The `macos-signing` environment must require release-maintainer approval, prevent self-review, restrict deployment to protected `main`, and disable administrative bypass where the repository plan supports those controls. Apple Silicon runs on `macos-15`; Intel runs on `macos-15-intel`, so each package is compiled and tested on matching hardware rather than cross-built on one runner.

Configure four environment secrets without committing or pasting them into project files:

- `APPLE_CERTIFICATE`: the base64-encoded `.p12` containing a **Developer ID Application** certificate and its private key.
- `APPLE_CERTIFICATE_PASSWORD`: the `.p12` export password.
- `APPLE_ID`: the Apple Developer account used for notarization.
- `APPLE_PASSWORD`: an app-specific Apple password, not the account password.

Configure `APPLE_TEAM_ID` as a protected environment variable. The workflow generates a one-run keychain password, imports exactly one Developer ID Application identity, checks that its team matches `APPLE_TEAM_ID`, and never falls back to ad-hoc signing. Certificate material is removed and the runner's keychain search list is restored even after failure.

Tauri signs with hardened runtime, submits the application to Apple, and staples the accepted ticket before constructing the DMG. The workflow uploads nothing unless it can verify the Developer ID authority, expected team, secure timestamp, hardened-runtime flag, architecture, nested signatures, Gatekeeper assessment, and stapled tickets. It then mounts the DMG, copies the application with `ditto`, repeats signature/Gatekeeper/ticket checks on that installed form, and runs the native liveness smoke check. Both architectures must pass before a combined checksum manifest is emitted. The workflow deliberately does not create or modify a GitHub Release.

The related [AndroidLogDesktop configuration](https://github.com/yifanfengshun930115-afk/AndroidLogDesktop/blob/master/src-tauri/tauri.conf.json) was inspected because a transferred package did not show the reported warning. It declares only `signingIdentity: "-"`; its [packaging workflow](https://github.com/yifanfengshun930115-afk/AndroidLogDesktop/blob/master/.github/workflows/desktop-packages.yml) has no Developer ID or notarization credentials and performs no Gatekeeper verification. That is useful ad-hoc preview behavior but cannot establish Apple trust. A difference caused by download quarantine, prior user approval, or transfer route must not be treated as a release-signing guarantee.

As of 2026-09-10, the repository has no `macos-signing` environment, signing secrets, protected `main` rule, or accepted signed run. The workflow and fail-closed checks are ready, but the macOS warning is not accepted as fixed until those controls are provisioned and the resulting DMG passes a clean-machine install/open test. Do not weaken Gatekeeper with `xattr`, instruct users to bypass it, or present the ad-hoc preview DMG as the signed artifact.

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
