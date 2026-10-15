# ADR-0021: First-party plugin SDK and repository boundary

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

ADR-0019 and ADR-0020 established a bundled contribution kernel, host-owned Tasks, and managed
Android/Gradle task state. That work intentionally proves the contracts inside the Asterlyn host
before defining a public extension ABI. The next step is to make the proven boundary reusable by
first-party integrations without turning the desktop process into a runtime loader for arbitrary
code.

The first-party Android/Gradle implementation is also becoming large enough to benefit from an
independent repository: it needs its own fixtures, release cadence, compatibility tests, and
ownership. Moving it too early would freeze unstable internal types and make every host change a
cross-repository migration. Leaving it permanently inside the host would make the contribution
boundary accidental and encourage direct imports into Tasks, Settings, workspace, or Tauri.

## Decision

Asterlyn will introduce a small, versioned first-party plugin SDK and an explicit repository
boundary. First-party plugins are compiled and bound into a host build at build time. The host does
not discover, download, install, execute, or dynamically load third-party plugin code at runtime.

The SDK is a contract package, not a copy of host internals. It exposes only the minimum types needed
for a plugin to describe a manifest, contribute a project detector, provide hierarchical task data,
declare host-rendered settings, and request host-owned task execution. It does not expose Tauri,
DOM, CodeMirror, Rust structs, raw filesystem handles, Git objects, PTY sessions, credentials,
network clients, or arbitrary process spawning.

The host owns the import adapter. A plugin package exports a versioned SDK-compatible factory or
manifest value; the host binds it through a checked-in adapter at build time, validates the SDK and
capability versions, and converts it into the internal contribution kernel. The adapter is the only
place where SDK types become host types. A failed or incompatible plugin is rejected at startup and
cannot affect the editor, Git, terminal, or other plugins.

The repository rollout follows this order:

1. stabilize the SDK/import boundary;
2. extract the smallest `HierarchicalCollection` and Tasks contracts;
3. define the in-repository package boundary and keep the first adapter in-tree;
4. move the first-party plugin to its independent repository;
5. make the host consume a versioned, integrity-checked build artifact;
6. migrate the remaining plugin-shaped trees only after the first integration proves the boundary.

The independent plugin repository remains first-party source, reviewed under the same product
security and release policy. Its output is a versioned package or artifact selected explicitly by a
host dependency update. The host build records the exact version and integrity identity. Local
development may use a checked-out path or workspace override, but that override is explicit,
reproducible, and never becomes a production runtime fallback.

## Contract and safety rules

- SDK versions use explicit major/minor compatibility rules. A host rejects unsupported major
  versions and records diagnostics for unsupported optional capabilities.
- Plugin IDs, contribution IDs, task IDs, settings IDs, and collection paths are validated and
  bounded at the host boundary. A plugin cannot use a selector, URL, or arbitrary DOM fragment as an
  identity.
- `HierarchicalCollection` is a declarative, bounded projection. It owns stable keys, labels,
  parent/child relationships, ordering, and optional provider metadata; it does not own rendering,
  focus, execution, or repository truth.
- The Tasks host owns tree projection, search, keyboard behavior, trust, confirmation, execution,
  output, cancellation, stale-result rejection, and cache verification. Plugins return task
  identities and metadata only.
- Plugin source and build artifacts are reviewed and integrity checked. The host never evaluates a
  project-local plugin manifest or imports code from a workspace.
- Every release can pin the prior artifact and roll back one dependency update without changing the
  host protocol. A failed plugin build or compatibility check blocks the integration update rather
  than silently falling back to an untested version.

## Consequences

- The Android/Gradle plugin can evolve in a focused repository without claiming a third-party
  marketplace or runtime extension ABI.
- The host gains a stable seam for future first-party integrations while retaining process and
  failure isolation.
- The first extraction requires adapter code and duplicate compatibility tests, and cross-repository
  changes need coordinated commits.
- Plugin UI remains host-owned. A plugin can describe settings and task data, but cannot ship an
  arbitrary panel into the WebView.
- The first-party repository is not a security boundary by itself; review, artifact integrity, and
  host capability checks remain mandatory.

## Alternatives rejected

- **Runtime third-party loading:** rejected because it expands the Tauri process trust boundary and
  makes permissions, updates, crash containment, and rollback ambiguous.
- **Copying host internals into a public SDK:** rejected because it freezes implementation details
  and leaks UI/native ownership.
- **Moving the Android plugin immediately:** rejected until the minimal collection, Tasks, lifecycle,
  and compatibility contracts have focused tests inside the host.
- **Keeping all plugin code in the host indefinitely:** rejected because it preserves accidental
  imports and makes independent plugin ownership impossible.

## Revisit triggers

Revisit this decision only when at least two first-party plugins consume the SDK, one SDK compatibility
migration and one artifact rollback have been exercised, or an external-plugin threat model is
approved separately from this first-party build-time model.
