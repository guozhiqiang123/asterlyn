# Plugin authority and content-binding hardening — 2026-10-21

## Scope

This record covers the local implementation of the plugin authority, content-binding, lifecycle,
crash-recovery, bundled-plugin convergence, and initial process-resource slices. It does not claim
complete cross-platform resource isolation or safe installation of arbitrary third-party packages;
those claims remain gated by released artifacts and packaged hostile-plugin evidence.

## Implemented boundaries

- External packages with legacy `processQueries` or `toolOperations` executable/argv declarations
  are rejected at both download admission and activation.
- No legacy compatibility mapping remains. Schema-2 authority packages fail closed even when they
  match the former Android `0.5.7` repository, identity, version, and digest.
- Packages without process/tool authority remain admissible.
- Package inspection computes a canonical SHA-256 digest over every sorted normalized file path,
  regular-file type marker, size, and file SHA-256, including `manifest.json`.
- Installation schema `2` persists that content digest. Schema-1 records load without trusting the
  mutable extracted tree, but activation is denied until the exact Release is reinstalled.
- The verified source archive is retained by digest, completed generations are sealed owner-only and
  read-only, and management or activation re-verifies both the archive and extracted generation.
- Settings manifest reads and runtime activation recompute the extracted-content digest. A mismatch
  blocks activation before process authority is registered or the helper starts; an activation-time
  mismatch follows the existing exact-version quarantine path.
- Package schema `3` and Plugin SDK `1.10.0` expose only host-owned semantic operation IDs. Native
  resolution receives typed parameters, requires active plugin-scoped workspace trust, and resolves
  tools only beneath canonical host-approved Android SDK roots.
- Fresh installations remain disabled until an exact digest and operation set is explicitly reviewed.
  Installed Settings renders one merged identity card with lifecycle, runtime, diagnostics, rollback,
  settings, and uninstall state.
- The first-party Android `0.5.8` schema-3 package is embedded by exact archive digest, admitted into
  the same immutable installation store before startup recovery, and executed through the same
  sidecar/lifecycle/resource boundary. First installation remains available offline and defaults on;
  later user disablement is preserved. The WebView runtime dependency has been removed.

## Hostile cases covered

- `sh`, `bash`, `cmd`, `powershell`, and `pwsh` command modes;
- generic PATH, environment, workspace-property, and Android Build Tools executable candidates;
- package-controlled literal arguments in process queries and tool operations;
- attempted reuse or drift of the removed compatibility identity;
- runtime-only modification, post-admission file injection, and coordinated runtime plus manifest
  integrity-table modification; and
- legacy installation metadata without an admission content digest.

## Executed local gates

- Rust formatting and strict workspace Clippy passed.
- Plugin package, marketplace lifecycle/migration, and host plugin tests passed.
- The complete Rust workspace suite passed after the authority and content-binding slices.
- TypeScript checking, desktop protocol validation, focused plugin runtime/management tests, the
  complete 1,254-test script suite, production build, and Rust ownership budget passed during this
  implementation slice.

## Remaining release limits

Android `0.5.8` now supplies the schema-3 runtime package and is embedded into Asterlyn as a pinned
isolated artifact; the old compatibility mapping and WebView runtime import are gone. Windows Job
Object code is exercised by the existing Windows runtime job only after these changes reach CI;
macOS currently has a CPU limit plus resident-footprint watchdog, not a claimed hard kernel memory
ceiling. Released-plugin measurements, OS sandbox/restricted-token work, deterministic
memory/CPU/timeout fixtures, and packaged macOS/Windows host-liveness smoke all remain open. Product
copy therefore continues to label the public plugin catalog experimental and unsupported for
arbitrary untrusted third-party packages.

## Crash-containment extension

- Each admitted helper has an independent process watcher after insertion into the session table.
- Fatal transitions remove only the matching owner/plugin/session tuple and publish at most once.
- The host retains bounded diagnostics and a one-shot exact termination receipt before releasing the
  child handle.
- Tauri cancels session-owned native operations and revokes tool authority before publishing a
  window-scoped termination event.
- The renderer validates the event, ignores stale identities, clears the health timer, aborts all
  projections, and removes the complete external registry batch synchronously.
- A pre-health crash consumes the native receipt through the existing failed-activation mutation;
  a replaced or gracefully stopped session does not create a crash incident.
- A post-health crash atomically quarantines the exact digest, selects the newest prior known-good
  version, stops sibling sessions across windows, and reconciles only after persistence succeeds.
- Persistence failure remains stopped and fail-closed; it never hot-restarts the failed digest.
- Linux helpers receive address-space and CPU limits, Windows helpers are attached to a Job Object
  with memory/CPU/process-count/tree policy, and macOS helpers receive CPU enforcement plus a
  resident-footprint watchdog. Protocol sequence gaps, malformed frames, invoke crashes, and stderr
  floods are covered by the local hostile fixture suite.
