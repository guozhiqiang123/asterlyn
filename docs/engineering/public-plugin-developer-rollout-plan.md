# Public plugin developer rollout plan

Status: implementation plan, MKT8  
Date: 2026-10-19

## Outcome

Turn the proven Android Release integration into a reproducible third-party development path. A
developer starts from one host-owned TypeScript template, depends only on a versioned Plugin SDK
artifact, produces one schema-2 `.asterlyn-plugin.tgz`, validates the exact bytes with the host's
canonical inspector, and publishes that asset on a stable GitHub Release. Asterlyn can then add the
repository as a source without source checkout, workspace mutation, or host-bundle changes.

This plan closes MKT8 from the
[`GitHub Release marketplace plan`](github-release-plugin-marketplace-plan.md). It does not create a
central publisher registry or grant plugins arbitrary WebView, filesystem, process, network,
credential, or shell access.

## Frozen developer baseline

- Plugin SDK: `1.8.0`, SDK major `1`.
- Installable package schema: `2`.
- External runtime protocol: `1`.
- Oldest external-runtime host: `0.1.12`.
- Initial host compatibility window: `>=0.1.12` and `<0.2.0`.
- Distribution: one stable GitHub Release, one `.asterlyn-plugin.tgz` asset, one normalized
  lowercase `owner/repository`, and a GitHub-provided `sha256:` digest.
- Runtime entry: one self-contained neutral ESM bundle. It runs only in the supervised plugin host.
- License and every packaged runtime file are covered by the manifest integrity table.

The SDK version, SDK major, package schema, runtime protocol, host compatibility range, capability
IDs, and permission IDs are separate compatibility axes. A template or plugin Release must never
derive one from another.

## Delivery slices

### MKT8A — Public contract and capability catalog

Status: implemented on 2026-10-19. The public
[`developer guide`](../plugins/developer-guide.md),
[`capability and permission catalog`](../plugins/capabilities-and-permissions.md), and
[`diagnostics and migration guide`](../plugins/diagnostics-and-migration.md) are protected by a
native-whitelist drift test.

1. Publish one developer guide covering repository identity, manifest ownership, localization,
   settings, contributions, Release discovery, install review, activation, diagnostics, rollback,
   and removal.
2. Publish the exact supported capability and permission catalog with host authority, limits,
   denial behavior, and required static declarations.
3. Publish compatibility and migration rules for additive SDK minors, package-schema changes,
   runtime-protocol changes, permission expansion, deprecation, and host-range changes.
4. Keep security and user-facing review copy host-owned. Plugins provide plain localized data and
   semantic requests only.

Exit gate: a developer can determine every admitted authority and every version pin without reading
host implementation code.

### MKT8B — Executable TypeScript template

Status: implemented on 2026-10-19 in [`templates/plugin-typescript`](../../templates/plugin-typescript).
Host CI copies the template to a temporary directory, performs a locked clean install and dependency
audit, type-checks/tests it, builds the package twice, proves byte-identical SHA-256, and runs the
canonical native inspector over the exact artifact.

1. Add a standalone template containing manifest, localized metadata, minimal runtime contribution,
   tests, deterministic bundling, integrity generation, canonical package inspection, and a pinned
   GitHub Release workflow.
2. The template consumes the exact SDK tarball from `vendor/`; a host script refreshes that tarball
   from `packages/plugin-sdk` without creating a path dependency in the resulting repository.
3. Template verification runs from a copied temporary directory so hidden host imports and
   undeclared local paths fail.
4. Generated archives contain only `manifest.json`, `LICENSE`, and the declared runtime files.

Exit gate: a clean copied template installs locked dependencies, type-checks, tests, builds,
inspects, and emits one deterministic package without importing `src/`, Tauri, DOM, Node runtime
APIs, or another plugin.

### MKT8C — SDK and inspector delivery

Status: partially implemented. The immutable host `v0.1.12` Release now publishes the deterministic
SDK tarball, its checksum, an aggregate checksum manifest, and checksum-covered standalone canonical
inspectors for Linux, Windows, and both macOS architectures. The template, Hello, and Android
repositories pin their dependency graphs and validate exact package bytes with that Release
baseline. `v0.1.11` predates the canonical inspector and therefore cannot be an external-plugin
baseline. Template and fixture workflows must pin `v0.1.12` or newer rather than silently building
an inspector from a mutable branch. The explicit oldest/current installed-host fixture pair remains
open.

1. Make `@asterlyn/plugin-sdk` a publishable declarative package with no host implementation, plus
   license, repository metadata,
   public README, and a deterministic `npm pack` artifact.
2. Add the SDK tarball and canonical inspector availability to host release evidence. The template
   and first-party Android repository pin exact artifacts and retain their checksums.
3. Run current-host and oldest-supported-host admission fixtures against the same generated package.
   An unsupported future SDK major, runtime protocol, host range, capability, or permission must
   fail before extraction or execution.
4. The release workflow rejects package/version/tag drift and mutable dependency resolution.

Exit gate: developers do not need an Asterlyn source checkout to consume SDK declarations or to
validate the package they publish.

### MKT8D — Installed acceptance and evidence

Status: partially implemented. The independent Hello repository and first-party Android repository
publish immutable packages that pass the pinned host inspector and supervised runtime parity tests.
The host's ignored live acceptance test now discovers both repositories through the same GitHub
latest-Release path used by the product, downloads the exact digest-bound assets, and admits their
package bytes. See the
[`2026-10-19 public marketplace acceptance evidence`](../benchmarks/2026-10-19-public-plugin-marketplace-acceptance.md).
The native discovery resolver now covers offline and GitHub rate-limit fallback with bounded stale
metadata, and the package/runtime suites prove hostile package rejection plus contribution-contract
failure containment. The published arm64 `v0.1.12` host is installed with strict bundle, executable,
version, liveness, and rendered-shell evidence plus a recoverable prior-install backup. The clean
installed-app Marketplace interaction through restart, deliberately failing public update, reinstall
retention, and measured resource and accessibility results remain open.

1. Verify a clean installed host can add a second fixture repository, discover, inspect, install,
   restart, activate, and promote it without an open workspace.
2. Verify offline and rate-limited discovery keeps bounded stale metadata; malformed and hostile
   packages never execute.
3. Publish a deliberately failing update and prove quarantine plus exact known-good rollback,
   disable, uninstall, retained-data policy, and clean reinstall.
4. Record startup latency, steady memory/CPU, process cleanup, keyboard/focus/ARIA, cross-platform
   packaging, signatures/checksums, and complete task/process cancellation.

Exit gate: the public path is demonstrated with independently versioned bytes, not only host unit
fixtures or bundled fallback.

## Canonical repository workflow

1. Copy the template and choose an immutable plugin ID plus normalized GitHub repository identity.
2. Pin the SDK tarball and lockfile; never depend on a sibling host checkout in production.
3. Declare only capabilities and permissions used by the runtime, then implement against the frozen
   activation context.
4. Run type checking, template tests, deterministic package creation, and the canonical inspector.
5. Tag exactly `v<manifest.version>` and let CI publish exactly one conforming asset.
6. Add `owner/repository` in Asterlyn Marketplace, refresh, inspect host-owned review data, install,
   and restart.
7. Treat an update as a new immutable version. Never replace Release bytes for an existing version.

## Acceptance matrix

| Concern | Required evidence |
| --- | --- |
| Isolation | copied-template build has no host source path or ambient runtime authority |
| Reproducibility | lockfile, deterministic archive layout, exact asset SHA-256 and integrity table |
| Compatibility | oldest/current accepted fixtures plus future-major/protocol/range rejection |
| Permissions | catalog mapping, least-authority manifest, host-owned review and denial diagnostics |
| Lifecycle | install/restart/healthy/update failure/rollback/disable/uninstall/reinstall |
| Reliability | crash-window recovery, stale network cache, bounded diagnostics and cleanup |
| Accessibility | localized plain text, keyboard/focus restoration, non-color statuses and announcements |
| Delivery | SDK artifact, inspector path, template workflow, public docs and benchmark evidence |

## Commit boundaries

1. This plan and frozen public baseline.
2. Public SDK metadata/documentation and deterministic artifact test.
3. Executable template, isolated verification, and Release workflow.
4. Capability, diagnostics, source-add, and migration guides.
5. First-party/fixture Release verification and installed acceptance evidence.

Each boundary must pass independently. Documentation may describe a later gate, but ordinary builds
must not claim that gate complete until its executable evidence is committed.
