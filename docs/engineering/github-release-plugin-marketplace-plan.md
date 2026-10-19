# GitHub Release plugin marketplace implementation plan

## Outcome

Deliver a decentralized plugin marketplace in Settings. First-party and user-configured GitHub
repositories act as sources; the host discovers stable Releases, statically validates and installs
bounded packages, activates external code only in a supervised plugin-host process after restart,
and supports update, rollback, disable, and uninstall without placing plugin authority in the
renderer or a workspace.

The governing decision is
[`ADR-0032`](../architecture/decisions/0032-decentralized-github-release-plugin-marketplace.md).
This plan deliberately completes the PPF5–PPF8 gates from the
[`public plugin foundation plan`](public-plugin-foundation-plan.md) instead of adding a download
button ahead of admission and isolation.

## Frozen identities and initial limits

The following identities are frozen before implementation tracks split:

- source identity: normalized lowercase GitHub `owner/repository`;
- first-party Android source: `guozhiqiang123/asterlyn-plugin-android-gradle`;
- source schema: `1`;
- installation-index schema: `1`;
- installable package schema: `2` (schema `1` remains build-time/bundled only);
- external plugin-host protocol: `1`;
- package suffix: `.asterlyn-plugin.tgz`;
- maximum sources: 64;
- maximum Release metadata: 1 MiB per source;
- maximum package download: 64 MiB;
- maximum archive entries: 2,048;
- maximum expanded package: 128 MiB;
- maximum individual file: 32 MiB; and
- retained admitted versions: current plus one previous known-good per plugin, excluding a bounded
  quarantine record.

Changing a bound is a compatibility/security change and requires migration and rejection evidence.

## Delivery phases and commit boundaries

### MKT0 — Decision, threat boundary, and rollout plan

1. Accept ADR-0032.
2. Add this implementation plan and register the source, distribution, admission, installation,
   runtime, and restart contracts.
3. Record GitHub API/digest assumptions, unauthenticated rate limits, explicit limitations, and
   rollback ownership.

Exit gate: implementation can be reviewed against one ordered admission and lifecycle model.

Commit boundary: documentation only.

### MKT1 — Static package schema and standalone validator

1. Add schema-2 SDK declarations for repository identity, host/runtime compatibility, permissions,
   license, entry point, and integrity table.
2. Keep schema 1 readable for existing bundled artifacts but reject it from runtime installation.
3. Add a native package-inspection crate/library that reads bounded `.tgz` bytes without extraction,
   validates archive paths/types/collisions, parses static JSON, verifies every declared file digest,
   and produces a frozen admission report without executing code.
4. Add hostile fixtures: traversal, absolute/Windows paths, links/devices, duplicate/case-colliding
   names, decompression bombs, unknown required capability, identity/version drift, digest mismatch,
   missing license, unsupported host/SDK/runtime, and surplus executable files.
5. Add a plugin-repository validation command/script that emits upload metadata.

Exit gate: arbitrary package bytes can be accepted or rejected offline with deterministic bounded
diagnostics and no file writes outside a disposable staging directory.

Commit boundary: SDK/package schema, validator, fixtures, and developer documentation.

### MKT2 — Host-owned source catalog

1. Add a native, versioned, atomic source store under application data.
2. Seed the immutable Android source descriptor; merge custom sources by normalized repository
   identity without duplicating first-party entries.
3. Validate GitHub URLs and plain `owner/repository` input, bounded name/description text, duplicate
   identity, maximum count, corrupt persistence, and cross-window change generations.
4. Expose list/add/edit/enable/remove commands. Built-in sources may be refreshed or locally
   described but cannot be removed or have their repository identity changed.
5. Keep source data independent from installed packages and plugin enablement.

Exit gate: source management survives restart, corruption affects only the source catalog, and no
renderer-provided URL reaches a network command directly.

Commit boundary: native source domain/storage, protocol/bridge, demo adapter, and focused tests.

### MKT3 — GitHub Release discovery and cached marketplace catalog

1. Derive API and browser URLs from the admitted source identity.
2. Query only the latest stable Release with fixed headers, redirect/timeout/output limits, and no
   shell; parse draft/prerelease/tag/assets/digest/rate-limit state.
3. Select exactly one conforming plugin asset and reject missing/ambiguous/null-digest releases.
4. Cache ETag/Last-Modified and the last successful bounded result. Manual refresh uses conditional
   requests; failure/rate-limit preserves a visibly stale result.
5. Coalesce concurrent source checks and reject late results after source generation changes.

Exit gate: Settings can display available version, asset size, Release link, digest availability,
and actionable source failure without downloading or executing a package.

Commit boundary: GitHub adapter, discovery service, protocol, cache, and tests.

### MKT4 — Download, admission, and immutable package storage

Status: implemented for schema-2 package admission on 2026-10-19. The Settings flow exposes an
explicit review, content-addressed immutable storage, and a recovered atomic installation index.
Admitted packages remain `pending runtime`; activation intentionally stays gated on MKT5/MKT7.

1. Start downloads only from an exact discovery token that binds source, Release, asset, size,
   digest, and source generation.
2. Stream into application-owned staging with cancellation, timeout, byte cap, and visible progress;
   recompute SHA-256 and byte count before inspection.
3. Run the MKT1 validator, present identity/compatibility/license/permission review, and require one
   explicit install confirmation.
4. Safely expand admitted files into a content-addressed immutable directory and atomically record
   a pending selection while retaining current/known-good state.
5. Quarantine rejected bytes only as bounded diagnostic metadata; do not retain an untrusted
   executable archive by default.

Exit gate: an admitted package is reproducibly stored but cannot run before restart or before the
external runtime gate exists.

Commit boundary: staged downloader, admission transaction, storage/index, review UI, and fault tests.

### MKT5 — Supervised external plugin host

1. Add the packaged `asterlyn-plugin-host` sidecar with an embedded non-Node JavaScript runtime.
2. Define protocol-1 framing, handshake, identity, activation, contribution, callback-handle,
   cancellation, diagnostics, and shutdown messages with strict byte/count/time bounds.
3. Remove ambient filesystem/process/network/credential/DOM/Tauri facilities; map every host
   request through an admitted named capability and current plugin/workspace identity.
4. Supervise one process per active external plugin with startup/request/idle/memory/CPU/output
   limits and complete process-tree cleanup on disable, workspace replacement, window/app exit,
   crash, or timeout.
5. Make contribution registration transactional and prove one crash cannot blank Settings, core
   features, or another plugin.

Exit gate: a fixture plugin and the Android plugin run through the sidecar with parity; malicious
fixtures cannot access ambient authority or survive lifecycle cleanup.

Commit boundary: sidecar/runtime protocol first, host adapter second, Android artifact migration
third.

### MKT6 — Installed and Marketplace Settings experience

1. Split Settings → Plugins into host-owned `Installed` and `Marketplace` views.
2. Marketplace renders source cards, manual refresh, cached/stale/error/rate-limit states, add/edit/
   remove source dialogs, Release details, and install/update entry points.
3. Installed renders origin, installed/active/pending/known-good versions, compatibility,
   permissions, diagnostics, enablement, plugin settings, update, rollback, and uninstall.
4. Add search over bounded local catalog data, keyboard/focus restoration, non-color status,
   screen-reader announcements, and localized host copy.
5. Preserve existing typed deep links from plugin workbenches to their Installed detail/settings.

Exit gate: plugin management is usable with no workspace, no network, a stale cache, an invalid
source, or a pending restart, and never accepts plugin markup.

Commit boundary: Settings controller/view/binding/styles/localization and interaction tests.

### MKT7 — Restart, recovery, update, rollback, and uninstall

1. Add a host restart coordinator that blocks new plugin work, cancels supervised operations,
   persists pending selection, relaunches the same installed app, and reports recovery on startup.
2. Validate pending packages again before sidecar launch; use an activation-attempt marker and a
   bounded healthy-start checkpoint before promoting known-good.
3. On failed handshake/activation or an unclean startup, select the previous known-good version and
   quarantine the failed digest for explicit user inspection/removal.
4. Make update and uninstall exact reviewed transactions; active removal requires restart, bundled
   fallback is explicit, and plugin settings/cache retention is a separate checkbox/policy.
5. Clean staging, orphaned immutable versions, and quarantine metadata under bounded LRU/age rules.

Exit gate: fault injection at every write/restart/handshake point produces either old-good or
new-good state, never a half-installed active package.

Commit boundary: restart/recovery domain and native commands, then UI orchestration and tests.

### MKT8 — First-party Release migration and public developer contract

1. Update the Android plugin build to emit one schema-2 self-contained package and validator report.
2. Publish a stable GitHub Release asset with GitHub SHA-256 and verify discovery, install, restart,
   activation, update, rollback, disable, and uninstall/fallback from the installed app.
3. Publish developer documentation, package templates, oldest/current host fixtures, permission
   catalog, source-add instructions, diagnostics guide, and migration policy.
4. Record performance, memory, process cleanup, accessibility, offline/rate-limit, hostile-package,
   cross-platform, signing/integrity, and rollback evidence.

Exit gate: a clean Asterlyn installation can add a second fixture repository, inspect/install it,
restart into isolated activation, and recover from a deliberately bad update without modifying a
workspace or host bundle.

Commit boundary: plugin repository release changes, host source migration, public docs, then final
acceptance evidence.

## Dependency order and parallel work

MKT0 and the frozen identities precede all implementation. After MKT1 and MKT2 public types are
stable, Release discovery and package validation fixtures may proceed independently. Settings may
prototype against demo snapshots after MKT2/MKT3 types freeze, but install buttons cannot be enabled
before MKT4 admission. External activation cannot be exposed before MKT5, and automatic restart or
package selection cannot precede MKT7 recovery.

No parallel track may redefine repository identity, asset naming, package schema, capability IDs,
installation-index fields, plugin-host protocol, or trust copy independently.

## Acceptance matrix

| Concern | Required evidence |
| --- | --- |
| Source identity | exact GitHub owner/repository normalization; duplicates and spoofed hosts rejected |
| Network | manual/coalesced checks; bounded metadata; cache validators; offline/rate-limit stale state |
| Supply chain | GitHub asset digest plus local SHA-256; exact Release/source/manifest/version parity |
| Archive safety | traversal/link/device/collision/bomb/limit fixtures; no writes before admission |
| Compatibility | package/SDK/runtime/capability/host matrices against oldest and current host |
| Permissions | plain-language host-owned review; denial leaves unrelated contributions usable |
| Isolation | no ambient authority; process/time/memory/output limits; crash containment |
| Lifecycle | atomic install/update/rollback/uninstall; interrupted-operation recovery; LKG fallback |
| Restart | task/process cleanup; exact app relaunch; pending-to-healthy promotion; loop prevention |
| Settings | Installed/Marketplace/search/sources/deep links/focus/keyboard/ARIA/localization |
| Performance | source refresh, package inspection, startup, steady memory/CPU, cleanup measured at limits |
| Delivery | plugin validator report, GitHub Release asset/digest, signed host package, installed smoke |

## Initial implementation slice

This development sequence begins with MKT0, then implements MKT1–MKT3 before exposing installation.
That produces a useful Marketplace catalog and source manager while preserving the existing bundled
Android runtime. MKT4 may stage only schema-2 packages and must label them `pending runtime` until
MKT5 lands; ordinary builds must not offer a misleading active/install success state. The first
publicly usable third-party installation milestone closes only after MKT5–MKT7.

## Known GitHub constraints

GitHub's latest-Release endpoint is available without authentication for public repositories, but
unauthenticated requests are limited per originating IP. Release asset metadata currently includes
an optional `digest` field; Asterlyn requires a `sha256:` value and rejects older/null-digest assets.
GitHub defines “latest” as the latest published full Release rather than the highest semantic
version, so Asterlyn additionally validates the tag and prevents an implicit downgrade. These are
adapter assumptions, not plugin package semantics, and must be covered by fixtures.
