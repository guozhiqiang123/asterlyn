# Host notification and plugin feedback acceptance

Date: 2026-10-15

Decision: [ADR-0027](../architecture/decisions/0027-host-notification-center-and-plugin-notifications.md)

Plan: [Host notification and plugin feedback](../engineering/host-notification-and-plugin-feedback-plan.md)

## Accepted behavior

- Plugin tasks remain supervised through one authoritative terminal result. The native event stream,
  task-row terminal state, and retained Terminal transcript are unchanged by notification delivery.
- Failed and crashed user-started plugin tasks publish one localized bottom-right host error tip that
  names the task. Success and cancellation stay in the task row and Terminal; discovery and cache
  refresh do not produce user-task completion tips.
- The window-scoped host notification center owns one visible item, a bounded pending queue, exact
  duplicate coalescing, semantic severity, deterministic dismissal, informational/success timeout,
  observer isolation, and disposal.
- The Plugin SDK `1.3.0` exposes an optional notification capability. Plugins provide only
  `info`/`success`/`warning`/`error` plus a key in their admitted localization catalog. The host binds
  plugin identity, resolves current/default locale copy, and owns all UI.
- A released activation cannot publish. Plugins cannot inspect notification history, dismiss another
  notification, inject markup, choose styling/timing/position, add actions, or gain process, Terminal,
  filesystem, network, or panel authority.
- Plugins compiled against SDK `1.2` remain compatible because the capability is optional and the
  major handshake is unchanged. The bundled Android/Gradle `0.1.5` artifact passed the full host
  suite unchanged.

## Bounds and lifecycle evidence

| Boundary | Accepted limit / behavior |
| --- | --- |
| Visible plus pending host notifications | 8 |
| Host message | 1,024 UTF-16 code units |
| Plugin-resolved notification message | 512 UTF-16 code units |
| Plugin message key | 128 characters and admitted key syntax |
| Plugin source | host-bound; request cannot override it |
| Informational/success lifetime | 4 seconds, timer owned by presentation |
| Warning/error lifetime | explicit dismissal |
| Window disposal | listener and timer released; center cleared; late publication is a no-op |
| Workspace replacement | released activation and identity guard reject stale feedback |

Focused tests cover queue order, deduplication, overflow, invalid values, listener isolation,
automatic advancement, severity/live-region mapping, plugin locale fallback, missing/oversized keys,
optional oldest-host behavior, activation revocation, localized task results, and text bounds. The
existing task execution suite continues to cover stream completion, failure, crash, cancellation,
stale events, subscription release, native-run disposal, Terminal retention, and background/user
mode separation.

## Automated evidence

- `npm run test:scripts`: 1,160 passed, 0 failed.
- `npm run check`: passed.
- `npm run build`: passed; the startup chunk is 499,895 bytes, 105 bytes below the current 500,000
  byte architecture gate. The gate was not changed.
- Focused notification/plugin/task result suite: 50 passed, 0 failed.
- macOS Tauri Release application bundle: passed after ad-hoc signing and strict deep verification.

No native protocol or Rust implementation changed in this slice, so the already-tested native task
supervisor remains the process authority. The full script suite re-exercised its frontend protocol,
lifecycle, stale-event, and shutdown fixtures.

## FilesRecovery evidence

Workspace: `/Users/gzq/AndroidStudioProjects/FilesRecovery`

The real Gradle wrapper produced a deterministic non-zero terminal result without changing project
sources:

```text
./gradlew __asterlynNotificationProbeMissingTask__ --console=plain --no-daemon --no-scan
Task '__asterlynNotificationProbeMissingTask__' not found in root project 'FilesRecovery' and its subprojects.
BUILD FAILED in 8s
```

This verifies the real project can produce the failure terminal condition consumed by the host task
runtime. The installed application is open on FilesRecovery for manual confirmation of the final
bottom-right tip and retained Terminal transcript.

## Packaging and recoverability

| Item | Evidence |
| --- | --- |
| Installed app | `/Applications/Asterlyn.app` |
| Installed executable SHA-256 | `da07b521939919c3bb2992b1482dcac4962e220aa73658daaf321c03e2cf890a` |
| Acceptance archive | `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.8-local-20261015-193507-host-notifications.app.zip` |
| Archive bytes | 9,865,388 |
| Archive SHA-256 | `d38dd76dd46e8309f99d76f58f6b71c9bb7ff62059d46b454cf6afde22ac7e71` |
| Previous-app backup | `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261015-193507-host-notifications/Asterlyn.app` |
| Previous executable SHA-256 | `391c436700545d4632f6d90abe963ab08cf37087aa2e346ce324bdbdc0320d47` |
| Relaunched process | PID `5952`, FilesRecovery argument supplied |

The built, installed, and retained-backup bundles passed strict deep signature verification. The
installed executable exactly matches the accepted build. Restoring the retained backup is the
rollback path if manual product acceptance finds a regression.
