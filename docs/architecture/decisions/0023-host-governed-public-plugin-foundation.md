# ADR-0023: Host-governed public plugin foundation

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

ADR-0019 through ADR-0022 proved a contribution kernel, host-rendered settings, an independent
Android/Gradle repository, integrity-pinned artifacts, and host-owned hierarchical presentation.
Those decisions deliberately stopped at reviewed first-party plugins. Asterlyn now intends to expose
the plugin interface to other developers, so assumptions that were acceptable for one bundled
plugin must become explicit package and management contracts before more integrations are added.

The current Android/Gradle package exposes the immediate gaps. Its human-facing strings are stored
in the host even though they describe plugin-owned concepts, while its package metadata, static
manifest, and executable module each repeat the version and can drift. A host cannot safely list,
validate, localize, enable, update, diagnose, or roll back third-party plugins if it must execute
plugin code to learn basic metadata or maintain plugin-specific resources itself.

## Decision

Asterlyn will evolve the first-party SDK into a host-governed public plugin foundation. Plugins own
their declarative identity, localized product copy, settings schema, detectors, and capability
contributions. The host owns package admission, compatibility validation, lifecycle, permissions,
settings storage, management UI, rendering, execution review, diagnostics, updates, rollback, and
resource limits.

This decision defines the package and management model; it does not authorize arbitrary runtime
code loading in the desktop process. External installation, signing, isolation, and distribution
remain later gates and must satisfy the rules below before they are enabled.

## Package identity

Every plugin package has one canonical static manifest that can be inspected without executing the
plugin. At minimum it declares:

- manifest schema version and required Plugin SDK major;
- globally stable plugin ID and semantic plugin version;
- display-name and description message keys;
- default locale and available locale catalogs;
- requested capabilities and declarative settings; and
- the executable entry point and integrity information once runtime installation exists.

The executable module repeats only the identity needed by the SDK handshake. The host rejects the
package if the package-manager version, static manifest identity, executable module identity, pinned
release metadata, or expected integrity digest disagree. Builds and releases must run this
consistency check; no layer silently chooses one conflicting value.

Plugin identity is the persistence key. Renaming a plugin does not change its ID. Changing an ID is
a new plugin unless a future host-owned migration explicitly maps the old identity. Settings and
cached provider data are versioned independently and never inferred from a display name.

## Plugin-owned localization

Plugin-specific user-facing copy ships in the plugin package as bounded declarative locale
catalogs. Catalogs are scoped to one plugin, so message keys do not share a global namespace.
Values are plain text; catalogs cannot contain HTML, templates, scripts, selectors, callbacks, or
host message overrides.

The host validates locale tags, keys, values, catalog count, message count, per-value length, and
total decoded size before publishing a plugin to management UI. Resolution is deterministic:

1. exact active application locale;
2. the plugin-declared default locale;
3. the unresolved message key as a visible diagnostic fallback.

Missing translations do not prevent activation when the default catalog is valid. A missing or
invalid default catalog rejects the plugin manifest. Plugin display name, description, settings,
plugin-specific status, and plugin-specific errors belong to the plugin. Generic management,
permission, trust, lifecycle, execution-review, and tool-window copy remains host-owned. Technical
identities such as Gradle task paths are data and are not translated.

## Host management contract

The host maintains a management catalog independent from workspace activation. A validated plugin
can therefore appear in Settings while disabled, unmatched, inactive, incompatible, or failed. The
host renders all management UI from declarative data and exposes bounded diagnostics without
accepting plugin-owned markup.

The catalog distinguishes at least these states:

- installed/available package identity and source;
- compatible or rejected, with a bounded reason;
- enabled or disabled user preference;
- matched or not matched for the active workspace;
- active, inactive, or failed contribution lifecycle; and
- update/rollback state once external package management is introduced.

Enablement never grants capabilities. Each filesystem, process, network, credential, Git, terminal,
or UI ability requires an explicit versioned host capability. Plugins receive narrow request/result
ports, not Tauri handles, DOM access, raw filesystem objects, credentials, or arbitrary process
spawning. The host may deny a capability without preventing unrelated plugins or core features from
working.

## Admission and failure isolation

The package pipeline is ordered and fail-closed:

```text
package bytes
  -> integrity/source verification
  -> static manifest parsing and bounds
  -> SDK/capability compatibility
  -> identity and localization validation
  -> management catalog entry
  -> user enablement and workspace match
  -> isolated activation through host capabilities
```

No executable plugin code is needed for the first five steps. One invalid package produces one
bounded diagnostic and cannot remove the Settings page, blank another tool, corrupt other plugin
state, or weaken workspace trust. Activation remains transactional: contributions become visible
only after their registration batch succeeds.

## Compatibility and evolution

- Manifest and SDK schemas are independently versioned.
- Unsupported major versions are rejected before activation.
- Additive optional fields require safe host defaults; semantic changes require a new major.
- Settings descriptors use stable IDs. Changing labels or translations does not reset values.
- Capability contracts are versioned and negotiated individually rather than exposing host
  internals through one broad API.
- A plugin package must pass static contract fixtures against the oldest supported host and the
  current host before publication.
- The host keeps the last known-good artifact through the rollback window and never falls back to
  an unverified local or project-owned package.

## Security gates for external plugins

Public SDK documentation may precede runtime installation. Runtime installation is blocked until a
separate threat model and implementation define package signatures/provenance, safe extraction,
atomic install/update/rollback, dependency policy, permission disclosure, code/process isolation,
revocation, crash containment, audit records, and recovery from interrupted updates. A workspace
must never be able to install or auto-enable a plugin merely by containing a manifest.

## Consequences

- Plugin repositories become self-contained: code, static metadata, localized copy, fixtures, and
  release evidence evolve together.
- The host no longer needs plugin-specific translation tables and can manage an unknown plugin from
  validated declarative data.
- Strict identity checks turn release drift into a build failure instead of a cache or UI bug.
- The first implementation adds validation and adapter code, but that cost is paid once at the host
  boundary instead of being repeated in every feature.
- External runtime loading remains unavailable until its security gates are deliberately completed.

## Alternatives rejected

- **Keep translations in the host:** rejected because every plugin release would require a host
  release and third-party plugins could not be self-contained.
- **Let plugins render their Settings UI:** rejected because markup and script access would bypass
  host accessibility, theming, permissions, bounds, and failure isolation.
- **Trust the executable module as the manifest:** rejected because management and compatibility
  checks would require executing untrusted code.
- **Implement a marketplace before the package contract:** rejected because installation would
  amplify unresolved identity, compatibility, localization, and rollback failures.

## Revisit triggers

Revisit when an approved external-plugin threat model selects an isolation mechanism, when a second
plugin needs a locale fallback other than exact/default, or when a capability cannot be represented
as a bounded declarative request/result contract.
