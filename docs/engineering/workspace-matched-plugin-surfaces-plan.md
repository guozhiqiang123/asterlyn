# Workspace-matched plugin surfaces implementation plan

Date: 2026-10-16

Status: planned

Governing decision: [ADR-0028](../architecture/decisions/0028-workspace-matched-plugin-surfaces.md)

## Outcome

Show the Tasks activity entry only when the current workspace has at least one active provider from
an enabled, matching plugin. Make Android/Gradle match a complete bounded root-wrapper Gradle
workspace, and keep matching semantics in the independent plugin repository.

## Delivery slices

### WPS0 — Record contracts and ownership

- Add ADR-0028, this plan, and central registry entries for `plugin.workspace-match` and
  `host.activity-availability`.
- Record that plugins own domain predicates while the host owns evidence, preferences, activation,
  committed-contribution observation, layout, focus, and visibility.

Commit boundary: documentation only.

### WPS1 — Add host activity availability policy

- Add a pure three-state activity policy (`available`, `disabled`, `hidden`).
- Preserve existing core and Git activity behavior; make Tasks an optional contribution-backed
  surface.
- Render hidden activity entries without deleting them from persisted order.
- Reconcile an open optional tool to a closed layout when its availability is revoked.
- Cover initial shell rendering, runtime updates, ordering, keyboard/drag exclusion, and layout
  reconciliation.

Commit boundary: host shell policy and focused tests; no plugin-specific imports.

### WPS2 — Publish committed provider availability

- Derive Tasks availability from the host's current provider projection, not from plugin IDs or
  Settings metadata.
- Publish changes after activation, deactivation, enable/disable, workspace replacement, and failed
  activation.
- Wire the window composition root to reconcile layout and rerender the activity rail.

Commit boundary: plugin composition seam, Tasks host, and lifecycle tests.

### WPS3 — Correct Android/Gradle matching

In `/Users/gzq/PrivateProjects/asterlyn-plugin-android-gradle`:

- Require a complete bounded catalog and the platform-matching wrapper at workspace root.
- Allow ordinary Gradle wrapper projects; keep Android evidence for quick-action classification.
- Reject build-script-only, wrapper-metadata-only, nested-wrapper, wrong-platform, truncated, and
  malformed evidence.
- Bump, verify, package, checksum, and pin the independent artifact in the host.

Commit boundary: independent plugin release followed by one host artifact-rollout commit.

### WPS4 — Acceptance and local installation

- Verify FilesRecovery shows Tasks when Android/Gradle is enabled.
- Disable the plugin and verify Tasks closes and disappears; re-enable and verify it returns.
- Open a plain folder, build-script-only fixture, nested-wrapper fixture, and valid Gradle wrapper
  fixture and verify exact visibility.
- Run plugin verification, focused host tests, the complete frontend/native gates, production build,
  signed macOS packaging, recoverable local replacement, and installed-app liveness.

Commit boundary: acceptance evidence only when tracked evidence changes.

## Acceptance matrix

| Workspace/plugin state | Tasks activity result |
| --- | --- |
| No workspace | Hidden |
| Plain folder | Hidden |
| Root build/settings file only | Hidden |
| Wrapper metadata or nested wrapper only | Hidden |
| Complete catalog + POSIX root `gradlew` | Visible on POSIX |
| Complete catalog + Windows root `gradlew.bat` | Visible on Windows |
| Wrong-platform root wrapper only | Hidden |
| Matching plugin disabled | Hidden; an open Tasks panel closes |
| Matching plugin activation fails or contributes no provider | Hidden |
| Any enabled matching plugin commits a provider | Visible without host plugin-ID changes |
| Unrelated catalog changes | No availability churn when the plugin evidence key is unchanged |
| Re-enable matching plugin | Visible again in its persisted activity order |

## Rollback

The host policy can temporarily mark Tasks as a stable core activity without changing the Plugin
SDK or persisted preferences. The Android/Gradle artifact remains pinned and recoverable by exact
version and checksum; rolling back the artifact restores its previous Android-only match predicate.
