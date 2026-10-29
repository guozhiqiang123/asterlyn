# ADR-0032: Decentralized GitHub Release plugin marketplace

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

Asterlyn already has an independently maintained Android plugin, a versioned SDK, static package
metadata, host-rendered Settings and workbench surfaces, capability-owned execution, and an exact
build-time artifact pin. It does not yet have runtime discovery, installation, update, rollback, or
third-party isolation. The public-plugin foundation deliberately left those operations behind the
PPF5–PPF8 security gates.

The intended product is not a centrally hosted IDE marketplace. A plugin developer publishes a
normal GitHub repository and attaches an Asterlyn plugin package to a stable GitHub Release. Asterlyn
ships a small set of first-party repository descriptors and lets a user add other repository URLs
with local display metadata. The desktop host discovers Releases, downloads packages, admits them,
stores them outside projects, and coordinates restart and rollback.

GitHub hosting supplies availability and a Release-asset digest, but it is not an independent code
review or signing authority. Repository compromise, account takeover, malicious updates, license
misrepresentation, and unsafe plugin code remain threats. A repository URL or successful download
therefore cannot grant runtime authority by itself.

## Decision

Asterlyn will implement a decentralized, source-based plugin marketplace. A **plugin source** is one
exact public GitHub `owner/repository` identity plus host- or user-owned display metadata. A source
is not a feed URL and cannot redirect discovery to another repository. The host derives the GitHub
API and Release URLs from the normalized identity.

First-party sources are shipped as immutable source descriptors and are visibly marked as such.
Users may add, edit, disable, refresh, or remove custom sources. Removing a source does not silently
remove an installed plugin; installed package lifecycle is a separate explicit operation.

The initial network boundary uses GitHub's latest stable Release endpoint. Checks are manual or
coalesced, cache validators and rate-limit metadata are honored, and failure keeps the last bounded
catalog snapshot with a visible stale state. There is no background polling loop. Private
repositories and authentication are deferred until a credential contract can keep tokens out of
renderer state and diagnostic output.

## Release and package contract

An installable Release must be published, non-draft, non-prerelease, semantically versioned, and
contain exactly one asset matching the Asterlyn plugin asset convention. The asset must have a safe
basename, a bounded non-zero size, a GitHub `sha256:` digest, and an exact
`github.com/<owner>/<repository>/releases/download/...` URL. Redirects may be followed only by the
native downloader while the original Release metadata remains bound to the admitted repository and
asset identity.

The package is inspected without executing plugin code. It contains a canonical static manifest,
package identity, license metadata and text, an integrity table, and one self-contained runtime
entry artifact. Admission verifies, in order:

1. source and Release identity;
2. downloaded byte count and GitHub SHA-256;
3. archive path, type, file-count, per-file, and total-size bounds;
4. no absolute paths, parent traversal, links, devices, duplicate paths, or case-fold collisions;
5. package, manifest, Release tag, entry point, and integrity-table identity parity;
6. manifest/SDK/capability/host compatibility and bounded localization/settings declarations;
7. declared SPDX license metadata and retained license text; and
8. permission review before the package can be enabled.

These checks establish package integrity and contract validity, not legal ownership or benevolent
behavior. The UI must describe that distinction. A missing digest, license declaration, compatible
runtime, or permission explanation is a rejection, never a warning that can be bypassed during
ordinary installation.

## Storage and lifecycle

Downloaded bytes first enter an application-owned staging directory. Admitted packages are safely
expanded into immutable content-addressed directories below application data. Workspaces, current
repositories, browser storage, and arbitrary renderer paths never select an install destination.

An atomic host-owned index records installed, selected, previous-known-good, pending, disabled, and
quarantined versions. Install, update, rollback, and uninstall prepare a transaction and then request
one coordinated application restart. The running process never overwrites the package it is using.
Startup validates the selected package again before activation, records an activation attempt, and
promotes it to known-good only after a bounded healthy-start checkpoint. Crash or handshake failure
restores the previous known-good selection on the next start and surfaces a diagnostic. Interrupted
staging is disposable; interrupted index replacement is recovered from the last valid generation.

Bundled first-party code remains the fallback for the transition period, but the UI must distinguish
`bundled`, `installed`, `update available`, `pending restart`, `rollback available`, `incompatible`,
and `quarantined`. It must not claim that a downloaded external package is active before the
isolated runtime has accepted it.

## Runtime isolation and capabilities

External plugin JavaScript will not be imported into the main WebView, evaluated through a blob,
loaded through a project path, or given Tauri internals. Asterlyn will ship a supervised plugin-host
sidecar with an embedded non-Node JavaScript engine. Each active external plugin runs in its own
child process with:

- no ambient filesystem, process, network, credential, DOM, WebView, or Tauri APIs;
- one bounded, versioned request/result transport;
- startup, request, output, memory, and CPU limits enforced by the host/supervisor;
- explicit cancellation and process-tree termination;
- capability calls that carry the activating plugin identity and are independently reauthorized;
  and
- transactional contribution publication after manifest, handshake, and activation succeed.

CPU supervision uses a rolling 60 CPU-second budget over the latest 60 seconds of
monotonic wall time, sampled at most four times per second with bounded history.
It must not impose a cumulative lifetime CPU expiry on a long-lived helper.
Inherited OS limits are preserved. macOS counters use the Mach timebase; Linux
uses process user/system ticks; Windows uses process kernel/user times. Memory,
request deadlines, process-tree ownership and fail-closed sampling remain
independent. Excess is reported as `resourceLimit` with the applicable window in
the termination detail. This replaces the earlier host-imposed Unix RLIMIT_CPU
and Windows per-process job lifetime allowance; see the
[boostCleaner incident and acceptance](../../engineering/2026-10-27-boostcleaner-lsp-recovery.md).

The package runtime entry is a self-contained bundle targeting the published plugin-host runtime.
Callbacks in the build-time SDK are represented across the process boundary by opaque handles and
typed messages, not serialized executable closures. Existing host capabilities remain authoritative:
the plugin may request tasks, process queries, tool operations, storage, notifications, targets, or
Run plans only through their admitted contracts.

## Settings and marketplace presentation

Settings → Plugins becomes one host-owned management surface with `Installed` and `Marketplace`
views. Installed keeps enablement, compatibility, permissions, version/source, diagnostics,
plugin-declared settings, update/rollback/uninstall state, and restart state. Marketplace lists the
bounded source catalog, supports explicit refresh, and provides source add/edit/remove management.

Repository descriptions entered by the user are local presentation data; they cannot override the
admitted plugin name, manifest, publisher identity, permissions, or version. Plugin packages still
provide only bounded plain data and localization keys. All controls, dialogs, progress, permission
review, errors, keyboard/focus behavior, and accessibility remain host-owned.

## Compatibility and publication policy

- Package schema, SDK, plugin-host protocol, capability protocols, persisted installation index,
  and marketplace-source schema remain separate version axes.
- First-party plugin repositories must publish the same package consumed by clean host acceptance;
  a checked-in host artifact is not a second hidden distribution format.
- A developer publication command must validate the archive locally and emit its filename, size,
  SHA-256, manifest summary, and Release upload checklist before GitHub publication.
- Unsupported packages remain inspectable as bounded marketplace diagnostics but are not installed
  or executed.
- Downgrade is an explicit rollback to an already admitted artifact; the host never downloads an
  older version as an automatic recovery guess.

## Consequences

- Asterlyn can grow an ecosystem without operating a central registry or copying plugin metadata
  into the host repository.
- Users choose repositories directly and can audit the exact Release that supplies a package.
- GitHub rate limits and availability become visible source state rather than hidden startup risk.
- Runtime installation requires substantial native admission, recovery, and isolation work before
  arbitrary third-party activation can be enabled.
- First-party plugins use the same Release and package rules, while retaining an embedded recovery
  path during migration.

## Alternatives rejected

- **Central Asterlyn marketplace service:** rejected for the initial ecosystem because it adds
  hosting, account, moderation, and availability infrastructure that the direct-source model does
  not need.
- **Dynamic import into the main WebView:** rejected because a worker, blob, local script, or ESM
  import would not provide sufficient Tauri, memory, crash, and capability isolation.
- **Trust any `.tgz` from a configured URL:** rejected because URL trust alone does not bind a
  package to a Release, digest, static identity, safe archive, compatible runtime, or license.
- **Install immediately without restart:** rejected because it would mix package replacement with
  active contribution and task lifecycles and make rollback ambiguous.
- **Treat the GitHub digest as publisher signing:** rejected because it proves the bytes served by
  that repository Release, not an independent publisher identity or code review.

## Revisit triggers

Revisit when private-source authentication is required, GitHub changes the Release digest or API
contract, a non-GitHub source is proposed, an operating system supplies a stronger sandbox that can
replace the sidecar boundary, or ecosystem scale requires an optional curated index over the same
repository-source protocol.
