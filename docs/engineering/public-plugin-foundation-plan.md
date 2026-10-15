# Public plugin foundation implementation plan

## Outcome

Turn the proven first-party plugin boundary into a durable base for future third-party development.
The first delivered slice makes plugin packages self-contained for localization, makes package
identity drift impossible to publish unnoticed, and lets the host validate and render plugin-owned
copy without embedding Android-specific knowledge.

The governing decision is
[`ADR-0023`](../architecture/decisions/0023-host-governed-public-plugin-foundation.md).

## Ownership rules

| Concern | Plugin package | Host |
| --- | --- | --- |
| Stable ID, version, SDK requirement | declares once in static package metadata | validates, pins, diagnoses |
| Name, description, plugin settings copy | ships bounded locale catalogs | resolves locale, escapes and renders |
| Generic Plugins page and lifecycle copy | no | owns and localizes |
| Settings controls | declares typed descriptors | validates values, persists and renders controls |
| Workspace detection and domain projection | contributes bounded data | supplies evidence and validates results |
| Filesystem/process/network/Git/UI authority | requests named capabilities | grants/denies and executes through reviewed ports |
| Enable, disable, update, rollback | no direct authority | owns lifecycle and recovery |

## Delivery phases and commit boundaries

### PPF0 — Architecture and public contract rules

1. Add ADR-0023 and this implementation plan.
2. Record package identity, localization ownership, fallback behavior, management states, capability
   boundaries, failure isolation, compatibility, and deferred external-install security gates.
3. Link both documents from the documentation map.

Exit gate: SDK, host, and plugin work can be reviewed against one explicit ownership model.

Commit boundary: documentation only.

### PPF1 — SDK localization and package identity contract

1. Add a declarative localization catalog to `SdkPluginManifest` with `defaultLocale` and scoped
   locale/message maps.
2. Publish conservative shared limits for locales, keys, values, messages, and total text size.
3. Keep catalog values plain text and the SDK free of DOM, Tauri, filesystem, and process imports.
4. Update the representative SDK fixture and declarations.
5. Specify static-manifest parity fields so package tooling can compare manifest, module, and
   package-manager identity.

Exit gate: a standalone plugin can describe all Settings copy without importing a host catalog;
invalid shapes are representable as untrusted inputs but cannot enter host state unvalidated.

Commit boundary: SDK contract and fixtures only.

### PPF2 — Android/Gradle package migration and identity guard

1. Move English and Simplified Chinese name, description, and task-presentation strings into the
   Android/Gradle plugin manifest using plugin-scoped keys.
2. Bump the plugin patch version and make `package.json`, static `manifest.json`, executable module,
   and release metadata agree.
3. Add a package consistency test that fails on any identity/version mismatch.
4. Test default-locale completeness, both locale catalogs, and SDK compatibility in the plugin
   repository.
5. Build the standalone tarball and record its source revision, size, and SHA-256 release evidence.

Exit gate: the plugin verifies independently, owns all plugin-specific copy, and cannot produce a
release artifact with the currently observed 0.1.2/0.1.1 identity split.

Commit boundary: plugin localization, version consistency guard, tests, then release artifact
metadata as a separate build commit.

### PPF3 — Host validation, projection, and resolution

The plugin artifact is produced before host enforcement so every cross-repository commit stays
buildable and follows the additive-SDK → plugin → host sequence from ADR-0021.

1. Validate plugin identity, localization bounds, default-catalog presence, message keys, locale
   tags, and settings message references at the SDK adapter boundary.
2. Clone/freeze validated catalogs before exposing them to management state.
3. Carry plugin localization through `PluginManagementSnapshot`.
4. Resolve plugin messages using exact application locale, plugin default locale, then visible key.
5. Remove Android/Gradle strings and the generic plugin-key resolver from host localization files.
6. Add focused tests for valid catalogs, each rejection class, fallback, escaping, missing keys,
   isolation, and both supported application locales.

Exit gate: Settings renders an unknown valid plugin from its own catalog, and malformed localization
fails before the plugin enters the catalog or activation lifecycle.

Commit boundary: host adapter, management projection, renderer, host copy cleanup, and tests.

### PPF4 — Host pin, regression acceptance, and local delivery

1. Pin the new Android/Gradle tarball and checksum in the host; update the lockfile through the
   package manager.
2. Assert that the pinned release metadata, imported module, SDK manifest, and expected digest
   agree.
3. Run focused SDK/management/localization/artifact tests, the full script suite, type checking, and
   production frontend build.
4. Exercise the real FilesRecovery workspace to confirm plugin discovery, cached Gradle task tree,
   Settings deep link, both task presentation modes, and English/Chinese plugin copy.
5. Build and sign a fresh macOS application, verify the bundle and executable digest, preserve the
   prior installation, replace `/Applications/Asterlyn.app`, run installed smoke checks, and reopen
   FilesRecovery for manual acceptance.
6. Record functional, performance, memory, accessibility, artifact, installation, rollback, and
   known-limit evidence.

Exit gate: the locally installed app consumes the new self-contained plugin and the previous app and
plugin artifacts remain recoverable.

Commit boundary: host artifact pin/integration first; acceptance evidence after verification.

## Implementation status

- PPF0 completed in `19a6ee7`, with the dependency-order correction in `54ab939`.
- PPF1 completed in host commit `6a03660`; Plugin SDK `1.1.0` defines bounded plugin-owned locale
  catalogs and static package-manifest parity fields.
- PPF2 completed in Android/Gradle source commit `5c96f46` and release-record commit `b6d3c19`;
  version `0.1.3` owns its static identity, Settings schema, English/Chinese copy, and consistency
  tests.
- PPF3 and the host integration portion of PPF4 completed in `a8f55a9`; the host validates, freezes,
  isolates, resolves, renders, and integrity-pins the plugin package without Android-specific copy.
- PPF4 acceptance is recorded in
  [`2026-10-15-public-plugin-foundation.md`](../benchmarks/2026-10-15-public-plugin-foundation.md),
  including FilesRecovery, startup, native package, installation, rollback, memory, accessibility,
  and known-limit evidence.
- PPF5–PPF8 remain intentionally open and continue to block arbitrary third-party runtime loading.

## Deferred public-plugin phases

These are required before third-party runtime installation, but are intentionally not hidden inside
this localization/identity slice:

### PPF5 — Capability and permission catalog

Publish versioned capability descriptors, permission explanations, compatibility diagnostics, and
developer fixtures. Prove denial and partial availability without breaking unrelated contributions.

### PPF6 — External package admission and isolation

Define signed provenance, safe extraction, immutable package storage, process or equivalent code
isolation, resource limits, revocation, crash containment, and audit records. The host must inspect
and list a package without executing it.

### PPF7 — Install, update, rollback, and developer tooling

Add atomic lifecycle operations, last-known-good rollback, interrupted-update recovery, explicit
developer mode, packaging/validation commands, compatibility matrices, and public SDK examples.
Project-local manifests never auto-install or auto-enable code.

### PPF8 — Distribution and ecosystem policy

Only after PPF5–PPF7 pass threat-model and recovery reviews, define a registry/marketplace protocol,
publisher identity, review/revocation policy, dependency policy, telemetry boundaries, and long-term
SDK support windows.

## Acceptance matrix for this slice

- **Functionality:** English/Chinese plugin metadata and settings are identical in meaning to the
  previous host-owned copy; locale fallback is deterministic; Settings controls still persist and
  deep-link correctly.
- **Compatibility:** SDK major remains 1 for the additive contract; unsupported major and malformed
  catalogs fail closed; the host has no Android-specific message keys.
- **Security:** values are plain text, escaped by the host, bounded before publication, and cannot
  override host copy or inject markup.
- **Reliability:** one invalid plugin is rejected without affecting core features or other plugins;
  package identity drift fails standalone and host integration tests.
- **Performance/memory:** locale resolution is synchronous and bounded; validated catalogs are
  immutable and carried once per management snapshot, with measured limits recorded in acceptance.
- **Accessibility:** host-owned labels, descriptions, controls, focus, and status announcements use
  the resolved plugin strings without changing keyboard or screen-reader structure.
- **Delivery:** plugin and host histories remain independently reviewable; exact tarball digest,
  packaged app digest, installation backup, and known external-loading limitation are recorded.
