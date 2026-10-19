# Plugin diagnostics and migration

Status: experimental public policy for Asterlyn `0.1.11` and Plugin SDK `1.8.0`.

## Identify the failing phase

| Phase | Evidence | Typical cause | Recovery |
| --- | --- | --- | --- |
| Source discovery | Marketplace source status, cached/stale marker, GitHub Release link | Offline/rate limit, no stable Release, wrong tag, missing/ambiguous asset or digest | Keep bounded stale metadata, correct the Release, then refresh manually |
| Download | Exact repository, version, asset, size and digest | Asset replaced, size/digest mismatch, timeout or cancellation | Publish a new immutable version; never overwrite old bytes |
| Package admission | Canonical inspector error and admission report | Unsafe archive, identity/version drift, unsupported contract, missing license, surplus file, integrity mismatch | Fix source package and release a new version |
| Install/restart | Installed pending/current/known-good state and restart reason | Interrupted atomic write, unavailable version, restart declined | Retry the exact transaction or cancel pending selection |
| Activation | Plugin ID/version/digest, runtime protocol failure, contribution error | Bundle syntax/identity mismatch, undeclared authority, activation exception | Fix and publish; host retains or restores known-good |
| Runtime request | Capability, operation and bounded failure code | Missing permission, stale workspace, bad arguments, unavailable executable/artifact, limit/timeout | Correct declaration/request; retry only when the failure is explicitly retryable |
| Update health | Attempt count, quarantine reason, selected known-good version | Crash, handshake/activation failure or unhealthy startup window | Inspect diagnostics, roll back, disable, or remove the failed version |

Marketplace and Installed diagnostics are host-owned plain text. A plugin cannot hide, restyle, or
rewrite admission, permission, runtime, quarantine, rollback, or uninstall results.

## Collect a support packet

Record only bounded non-secret evidence:

- Asterlyn version and operating system;
- normalized plugin repository, plugin ID and version;
- Release asset name, byte count and SHA-256;
- canonical inspector JSON or rejection text;
- declared capabilities and permissions;
- lifecycle state: pending/current/known-good/quarantined/disabled;
- failure phase, bounded error code/message, and whether retryable;
- workspace generation only when the issue is workspace-scoped; and
- reproduction steps plus whether rollback or clean reinstall succeeds.

Do not attach credentials, repository secrets, full environment dumps, unbounded task transcripts,
or private workspace files. The host's app data and immutable package storage are implementation
details, not public plugin APIs; do not ask users to edit them manually.

## Compatibility axes

The following versions are independent:

1. Plugin SDK semantic version controls developer-facing declarations.
2. SDK major is the earliest runtime module compatibility handshake.
3. Package schema controls static pre-execution admission.
4. Plugin-host protocol controls process framing and runtime values.
5. Individual capability protocols control request/result semantics.
6. Host compatibility range controls which Asterlyn releases may admit the package.
7. Plugin-owned persisted-data schemas control settings/workspace-state migration.

Do not infer one axis from another. A plugin can use SDK `1.8.0`, SDK major `1`, package schema `2`,
and runtime protocol `1` while independently increasing its own version.

## Classify a contract change

| Change | Required release treatment |
| --- | --- |
| Optional field with deterministic fallback | Additive SDK minor or compatible capability revision; retain oldest-host fixture |
| New enum value that an old consumer may receive | Add an explicit unknown fallback or version the contract |
| Required field, renamed stable ID, changed meaning or reordered security action | New incompatible SDK major, package schema or capability protocol |
| New permission or broader filesystem/process/network/UI authority | New named authority, threat review and explicit user-facing permission expansion |
| Tighter count/text/time/memory bound | Compatibility review, rejection fixture and migration guidance |
| Contract removal | Deprecation window, bounded diagnostics, replacement guide, then removal only at an incompatible boundary |

Raising `distribution.hostCompatibility.minimum` is appropriate only when old hosts cannot safely
provide the required contract. Use `maximumExclusive` to fail closed before a known incompatible
host line; do not use it as a routine update mechanism.

## Migrate settings and workspace state

Setting IDs and values are durable public identities. Prefer additive settings with defaults. If a
value changes meaning, introduce a new value or setting ID and translate explicitly; never reinterpret
old bytes silently.

Workspace-state values are plugin-owned versioned strings. Store an explicit schema version in the
value, parse defensively, migrate within the current plugin namespace, and keep a deterministic
fallback when data is absent, old, corrupt, or from a newer unsupported schema. Writes remain
bounded and non-secret.

Removing a plugin may retain or delete plugin settings/cache/state according to the host-owned
review choice. A plugin must work after clean reinstall with no retained data.

## Update, rollback and quarantine

Each version is immutable. An update is admitted beside current and known-good, selected as pending,
and activated only after restart. The host revalidates the exact bytes and records an activation
attempt before launch. Healthy-start promotion makes that exact version current and known-good.

If handshake, activation, runtime health, or startup completion fails, the host quarantines the
failed digest and selects the previous known-good version. Rollback is an exact version selection,
not a new download. A quarantined version does not silently retry every startup.

Plugin authors should reproduce both upgrade and downgrade paths. Never require new persisted data
to make the previous known-good version start; use forward-compatible data or a plugin-owned migration
strategy that preserves rollback.

## Deprecation sequence

1. Document the replacement and the first host/SDK version that supports it.
2. Keep accepting the old form with a bounded diagnostic during the published window.
3. Add current-host and oldest-supported-host fixtures for both forms.
4. Update the template, SDK, capability catalog and contract registry together.
5. Remove only at the declared incompatible boundary; stale packages then fail admission without
   executing code.

## Before requesting support

Run `npm ci`, `npm audit --audit-level=high`, `npm run verify`, and the template's deterministic
package check. Confirm the exact asset was not replaced, the GitHub digest matches local SHA-256,
the inspector host version is inside the manifest range, and every requested runtime operation has
both its capability and permission. Then reproduce with retained state disabled or a clean reinstall
to distinguish code defects from plugin-owned migration defects.
