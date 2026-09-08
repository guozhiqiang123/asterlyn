# Continuous integration and preview packaging

## Current scope

`Package preview` is the first cross-platform delivery gate. It runs on pushes to `main`, pull requests, and explicit manual dispatch. A Linux quality job must pass before native packages are built for:

- Linux x86_64 on Ubuntu 22.04.
- Windows x86_64 on the current GitHub-hosted Windows image.
- macOS Apple Silicon and Intel on the current GitHub-hosted macOS image.

The workflow uploads unsigned, short-lived workflow artifacts plus a SHA-256 manifest for every target. It does not create a Git tag or GitHub Release and does not receive signing, notarization, updater, or publishing credentials.

## Trust boundary

- Workflow permissions are limited to repository-content read access.
- Checkout credentials are removed before project-controlled build scripts run.
- Pull requests use `pull_request`, never the privileged `pull_request_target` event.
- External actions are pinned to immutable commit hashes. The adjacent version comments document the reviewed upstream release.
- Dependency installation uses `npm ci` and Cargo's committed lock file.
- Signing and release publication require a separate workflow, protected environment, explicit version tag, and documented recovery process before they may be introduced.

## Evidence policy

A green matrix proves only that compilation and bundling succeeded on the named hosted-runner images. Before an artifact becomes a release candidate, record its hash and perform a launch/workflow smoke test on real hardware or a declared equivalent environment. Unsigned macOS artifacts use ad-hoc signing only to preserve bundle integrity; they are not notarized and should not be presented as end-user releases.

When a pinned action is updated, review its release notes and source provenance, change the hash and version comment together, and treat the resulting workflow run as new acceptance evidence.
