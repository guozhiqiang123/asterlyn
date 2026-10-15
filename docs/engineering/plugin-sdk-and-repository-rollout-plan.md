# First-party plugin SDK and repository rollout plan

## Outcome

Extract the smallest reusable first-party plugin boundary from the proven bundled contribution
kernel, then move Android/Gradle ownership to an independent first-party repository without adding
runtime third-party loading. The host remains responsible for lifecycle, authorization, Tasks UI,
execution, cache verification, settings rendering, diagnostics, and rollback.

The governing decision is [`ADR-0021`](../architecture/decisions/0021-first-party-plugin-sdk-and-repository-boundary.md).

## Delivery order

### SDK0 — SDK and import boundary

Define the versioned SDK package and the host import adapter. Keep the contract declarative and
small: manifest metadata, capability/version negotiation, detector evidence, settings descriptors,
task provider output, and typed host requests. Add compile-time ownership rules that reject imports
from Tauri, DOM, CodeMirror, Rust internals, workspace filesystem handles, Git internals, PTY,
credentials, and process spawners.

Commit boundary: SDK types, version constant, adapter, compatibility fixtures, and documentation.

Exit gate: a fixture plugin can be adapted without importing host implementation modules; unsupported
major versions fail closed; optional capabilities produce bounded diagnostics; no runtime loader or
workspace code path is introduced.

### SDK1 — Minimal `HierarchicalCollection` and Tasks contract

Extract only the collection and task data needed by the current host. `HierarchicalCollection`
contains bounded stable node keys, parent/child relationships, labels, group metadata, deterministic
ordering, and provider identity. Task descriptors retain exact executable identity through the host;
they do not contain shell strings or arbitrary callbacks.

The host Tasks feature continues to own tree presentation, projections, search, focus, keyboard
navigation, refresh, cache states, trust, confirmation, run/cancel/retry, output, and stale-result
rejection. Android Quick Actions remain a host projection of the complete collection.

Commit boundary: collection/task SDK types, host adapter, parser/limit tests, and no UI migration.

Exit gate: Android/Gradle can supply a fixture collection; duplicate/unsafe IDs, depth, node count,
label size, and ordering limits are rejected; existing Tasks tests remain green.

### SDK2 — In-repository package boundary

Create the package-shaped directories and dependency direction inside the host repository. The
plugin package may depend on SDK types and product-neutral utilities only. The host adapter may
depend on the SDK and host application ports; Tasks, Settings, workspace, and Tauri must not import
plugin implementation modules directly.

Keep Android/Gradle source in-tree during this phase. Add a package manifest, export surface,
focused compatibility test, fixture data, and a source-boundary check. Preserve the existing bundled
activation, cache, trust, and execution lifecycle while changing only import paths.

Commit boundary: package layout, import-boundary checks, and adapter migration.

Exit gate: dependency direction is machine-checked; a plugin failure is isolated; local production
builds use the same adapter path as CI; no behavioral change is hidden inside the package move.

### SDK3 — Independent first-party plugin repository

Create the separate Android/Gradle repository with the SDK as its only host contract dependency.
Move plugin implementation, fixtures, parser tests, and plugin-owned documentation there. Keep the
host adapter and host-owned Tasks/Settings/cache/execution code in Asterlyn.

Cross-repository change sequence:

1. land any additive SDK contract in the host and publish a development SDK artifact;
2. update the plugin repository against that exact SDK version and pass its standalone suite;
3. update the host adapter to consume the plugin artifact in a reviewable integration commit;
4. run host and plugin acceptance gates before declaring the migration complete.

Rollback is the reverse: pin the host to the last known-good plugin artifact, then revert the plugin
repository change independently. Never delete the old artifact until the host rollback window has
closed.

Exit gate: clean checkout builds on supported platforms; plugin tests do not require host source
paths; host tests prove missing, incompatible, failing, and disabled plugin behavior; artifact
identity is recorded.

### SDK4 — Host consumption of versioned artifacts

Replace the development path override with an explicit versioned package or generated artifact.
Record SDK version, plugin version, source revision, and integrity digest in the host dependency
metadata and release evidence. CI must resolve the exact artifact from the approved first-party
source and reject checksum or major-version drift.

Local development remains supported through an explicit workspace/path override documented in the
plugin repository. The override must be opt-in, must not alter production lockfiles, and must run
the same SDK compatibility and host integration tests.

Exit gate: reproducible clean builds use the pinned artifact; offline/retry behavior is documented;
an intentionally corrupted or incompatible artifact fails before activation; reverting one host
dependency commit restores the prior plugin.

### SDK5 — Migrate remaining plugin-shaped trees

Only after SDK4 passes, migrate additional bundled integrations one at a time. For each tree,
identify the smallest SDK contract, add an adapter, and keep host-owned Tasks, Settings, cache,
workspace authority, and execution unchanged. Do not generalize from Android-specific metadata into
the SDK without a second consumer and a compatibility test.

Commit boundary: one integration migration per plugin, followed by its acceptance evidence.

Exit gate: at least two first-party plugins use the SDK, one compatibility migration is tested, one
artifact rollback is demonstrated, startup remains lazy, and the host has no direct imports from
plugin implementation packages.

## Cross-repository policy

- **Compatibility:** additive minor changes require host fallback or a coordinated version bump;
  major changes require a new adapter and explicit migration record.
- **Supply chain:** only approved first-party repositories and signed/reproducible CI artifacts are
  accepted; source revision and digest are retained in release evidence.
- **Local development:** explicit path/workspace override only; never load a plugin from the active
  workspace or infer a dependency from repository files.
- **Failure isolation:** discovery, activation, parser, or plugin initialization failures disable
  only that contribution and surface bounded diagnostics.
- **Release/rollback:** host and plugin changes are separate reviewable commits. The host pins the
  previous artifact until the new release passes packaged smoke tests.
- **Security:** SDK capabilities describe requests to host-owned ports; they do not grant direct
  filesystem, Git, process, network, credential, or WebView access.

## Acceptance matrix

Each phase records focused SDK/adapter tests, frontend type checking, host Rust checks when native
contracts change, dependency-boundary checks, clean-checkout reproducibility, startup/lazy-load
measurements, plugin failure containment, and rollback evidence. The first independent repository
also records standalone test results and the exact artifact consumed by the host.

## Implementation status

- SDK0 completed in `eaf73a6`; the versioned contract and fail-closed host adapter landed.
- SDK1 completed in `7a4c9ba`; bounded hierarchical collections gained deterministic validation.
- SDK2 completed in `0f65f28`; Android/Gradle lost every deep import into host implementation.
- SDK3 completed in sibling repository `asterlyn-plugin-android-gradle`; source commit `27ff403`
  builds and tests independently against the pinned SDK package.
- SDK4 completed with Android/Gradle `0.1.0`; the host vendors the reviewed tarball by exact SHA-256
  and package-lock integrity, and no longer contains the plugin implementation or plugin-owned tests.
- The host hierarchy presentation rollout completed in `c6d651f`, `fb45a14`, and `818ce9b`.
  `DisclosureState` now owns the plugin Tasks tree expansion model, while the declarative shared
  toolbar renders tree/flat, expand, and collapse commands for Changes, Files, Find, workspace
  replacement, History, Stash, and Push without feature-specific markup rewriting.
- SDK5 remains intentionally open until a second first-party plugin exists; host-internal tree
  surfaces can migrate to `HierarchicalCollection` without reopening the Android plugin boundary.

Acceptance evidence for this rollout: the Android/Gradle repository passes 36 standalone tests,
type checking, and its independent ESM build; the host passes 1,109 script tests, type checking, and
the production frontend build while consuming the pinned `0.1.0` artifact.
