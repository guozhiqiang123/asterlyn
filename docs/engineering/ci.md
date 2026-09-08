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
- Signing and release publication require a separate workflow, protected environment, explicit version tag, and documented recovery process before they may be introduced.

## Evidence policy

A green matrix proves that compilation, bundling, and bounded process-liveness smoke checks succeeded on the named hosted-runner images. It does not prove that the window painted correctly or that user interaction worked. Before an artifact becomes a release candidate, record its hash and perform a launch/workflow smoke test on real hardware or a declared equivalent interactive environment. Unsigned macOS artifacts use ad-hoc signing only to preserve bundle integrity; they are not notarized and should not be presented as end-user releases.

When a pinned action is updated, review its release notes and source provenance, change the hash and version comment together, and treat the resulting workflow run as new acceptance evidence.

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
