# FilesRecovery managed-plugin and task-cache acceptance

Date: 2026-10-15

Representative workspace: `/Users/gzq/AndroidStudioProjects/FilesRecovery`

Application version: `0.1.8`

## Delivered behavior

- Settings has a host-owned Plugins section. Bundled plugins remain visible when they do not match
  the current workspace, default to enabled, and can be disabled or re-enabled without restarting
  the application.
- Android / Gradle exposes one declarative `taskPresentation` setting. Both `All tasks tree` and
  `Quick actions tree` retain module-aware tree semantics and exact Gradle task identities.
- A framework-owned Settings action is shown beside Close for a plugin-owned tool. It opens the
  owning plugin entry, focuses the requested setting, and is hidden for host-owned or ambiguous
  tools.
- The Android plugin restores a persisted snapshot before any Gradle discovery. Restored tasks are
  runnable only after the current workspace fingerprint matches the snapshot fingerprint.
- Gradle configuration files, version catalogs, wrapper metadata, `buildSrc`, `build-logic`, and
  Android manifests participate in invalidation. Source-only changes do not. Watcher ambiguity and
  overflow conservatively mark the snapshot stale but never start Gradle automatically.
- Validating or stale trees remain visible, explain their state without relying on color, and keep
  Run disabled. Refresh is explicit, cancellable, and replaces the cache only after a successful
  bounded discovery.
- Cache addressing is bound to the active canonical workspace, plugin, and provider. Native writes
  are atomic; corrupt entries become recoverable misses; schema changes do not reuse incompatible
  data; least-recently-used cleanup enforces entry and byte ceilings.

## FilesRecovery measurement

The uncached Asterlyn discovery used the same command issued by the Android plugin:

```text
./gradlew tasks --all --console=plain --no-daemon --no-scan
```

It completed in 12.98 seconds (`user` 26.99 seconds, `sys` 2.71 seconds) and produced 16,031 lines /
1,364,975 bytes. This is an application-cache cold run, not a claim that the operating-system and
Gradle dependency caches were cold.

The checked-in benchmark driver then parsed that captured output, round-tripped the task snapshot,
accepted it into the Tasks controller, and rendered both presentation modes without invoking
Gradle:

| Stage | Result |
| --- | ---: |
| Authorized project catalog | 2,944 files in 90.50 ms |
| Fingerprint input | 35 files / 77,185 bytes |
| Parsed task catalog | 15,980 tasks across 9 modules in 29.34 ms |
| Derived Quick Actions | 415 |
| Decoded task payload | 3,929,863 bytes |
| Base64 transport payload | 5,239,820 bytes |
| Cache encode | 96.10 ms |
| Cache decode | 205.36 ms |
| Controller acceptance | 11.71 ms |
| Complete-tree render batch | 67.63 ms / 84,818 HTML bytes |
| Quick-Actions-tree render batch | 2.94 ms / 388,209 HTML bytes |

The 15,980-task snapshot remains below the 32,768-task and 16 MiB decoded-payload limits. The
1.36 MiB Gradle output remains below the 2 MiB discovery-output limit. Rendering is batched, so the
complete task set is searchable without mounting 15,980 task rows at once.

Reproduce the projection measurement with:

```text
node scripts/benchmark-android-task-cache.mjs \
  /Users/gzq/AndroidStudioProjects/FilesRecovery \
  /tmp/asterlyn-filesrecovery-gradle-tasks-20261015.txt
```

## Lifecycle and interaction evidence

Deterministic frontend coverage verifies:

- plugin enable/disable/re-enable, preference persistence, corrupt-field fallback, and a single
  activation owner;
- typed Settings deep links, focused plugin settings, and the framework tool-header action;
- module/group/action tree semantics, search, accessible tree roles, Quick Actions projection, and
  disabled execution while validating or stale;
- restore without a Gradle refresh plan, fingerprint mismatch/expiry/corruption handling, explicit
  refresh, failed-refresh retention, watcher and overflow invalidation, and invalidation winning an
  in-flight write;
- exact task execution identities and rejection of unknown or stale task IDs;
- workspace/plugin/provider cache scoping, strict protocol bounds, cache round-trip, and safe
  behavior when the native cache capability is unavailable.

The release native executable rendered its application shell with FilesRecovery as the startup
workspace under an isolated desktop profile. The standard rendered-native build smoke also passed.
These smoke probes establish production build/start/render health; they do not simulate human mouse
clicks in the macOS WebView. Detailed control behavior is covered by the deterministic DOM and
controller interaction suites above.

## Validation

| Check | Result |
| --- | --- |
| `npm run test:scripts` | 1,131 passed |
| `npm run build` | passed |
| `cargo fmt --check` | passed |
| `cargo clippy --all-targets -- -D warnings` | passed |
| `cargo test --workspace` | passed; 93 application tests passed and 2 unrelated OS watcher probes remained ignored, with all other workspace suites passing |
| `npm run test:native:rendered:build` | passed; release executable rendered within the 6-second gate |
| FilesRecovery release-executable smoke | passed; version 0.1.8 rendered with the representative workspace argument |

## Limits and rollback

- The cache is acceleration data, not task authority. Removing the application-cache entries loses
  only warm startup; the next explicit Refresh rebuilds them.
- A configuration input generated outside the authorized catalog, or a filesystem event whose path
  cannot be classified, yields a visible stale state and requires Refresh. A future provider may
  broaden its evidence set without migrating old snapshots because the evidence key changes.
- The cache retains at most 32 entries and 128 MiB globally. Oversized, expired, future-dated,
  wrong-root, wrong-schema, symlinked, escaped, and corrupt entries are treated as misses or
  quarantined rather than trusted.
- Disabling the Android / Gradle plugin immediately removes its contributions but deliberately
  preserves preferences and disposable cache data for later re-enable. Rolling back the feature can
  ignore or delete that cache without touching the Android project.
