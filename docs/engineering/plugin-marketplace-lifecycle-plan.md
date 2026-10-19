# Plugin marketplace lifecycle and recovery plan

Status: implementation plan, MKT7  
Date: 2026-10-19

## Outcome

An admitted plugin package is not trusted merely because it was downloaded and unpacked. Asterlyn
must be able to try the exact immutable package, prove that its isolated runtime remains healthy,
promote it, and recover to the previous known-good package after a crash or failed activation.
Every transition is persisted by the host. Plugin code cannot edit lifecycle state.

## Ownership boundaries

- The marketplace domain owns installed versions, exact package digests, enablement, pending
  selection, active selection, known-good selection, quarantine, rollback, and removal policy.
- The native runtime adapter owns package reinspection, sidecar launch, handshake, session identity,
  and process-tree shutdown.
- The renderer only coordinates host-owned UI and the bounded health checkpoint. It may report the
  exact activation identity returned by native code, but it cannot choose a different version or
  digest.
- Plugin packages own neither restart nor recovery. Bundled fallback is a host policy, not an
  undeclared import from the host bundle.

## Persisted version states

| State | Meaning | Activatable |
| --- | --- | --- |
| `pendingRuntime` | admitted, selected for its first isolated activation | yes, once per recovery cycle |
| `pendingRestart` | reviewed transaction requires the installed app to restart | no |
| `active` | exact version/digest is inside the bounded health window | yes only for another window in the same process |
| `knownGood` | completed isolated activation and health checkpoint | yes |
| `quarantined` | activation, identity, or unclean-start recovery failed | no |

`pendingVersion`, `activeVersion`, and `knownGoodVersion` are explicit pointers. Multiple historical
versions may retain `knownGood` evidence, but the pointer identifies the rollback target.

## State transitions

1. Admission stores immutable bytes and selects the version as `pendingRestart`. A controlled app
   restart advances it to `pendingRuntime`; the process that admitted the package cannot activate
   the new bytes.
2. Native activation atomically changes the selected exact version/digest to `active` before it
   reinspects or launches the package. This persisted `active` state is the activation-attempt
   marker.
3. Reinspection, helper handshake, contribution projection, and registry publication must all
   succeed. The renderer then waits a bounded stability interval while the session remains alive.
4. A host command promotes the same plugin/version/digest from `active` to `knownGood`, moves all
   three pointers to that version, and clears the pending selection.
5. A synchronous activation or projection failure quarantines the exact digest, clears a matching
   pending selection, and selects the previous `knownGoodVersion` as active fallback.
6. At process startup, any persisted `active` version is evidence of an interrupted health window.
   Recovery quarantines it and selects the previous known-good pointer. A graceful exit before the
   checkpoint instead abandons the attempt back to `pendingRuntime`; it must not create a false
   quarantine.

All mutations are generation-incrementing, atomic installation-index writes. Commands reject stale
or mismatched version/digest/session identities.

## Restart and destructive actions

- Install/update may be downloaded and admitted while the app is running, but activation selection
  is committed through the restart coordinator when a currently active version would be replaced.
- Restart first blocks new plugin work, cancels supervised plugin operations, records a clean
  handoff, and relaunches the same installed application.
- Disable stops active sessions before persisting disabled state. An unfinished health attempt is
  returned to `pendingRuntime`. Re-enable selects the last active/known-good version for the next
  controlled restart and never clears quarantine.
- Rollback is an exact reviewed selection of an existing known-good version and requires restart
  when another version is active.
- Uninstall presents the exact versions to remove. Active removal requires restart. Settings and
  caches are retained or deleted by a separate explicit policy. A bundled fallback remains only
  when the host declares `bundledFallback`.

## Delivery slices

### MKT7A — Lifecycle domain

- Add atomic prepare, healthy, failed, interrupted-start recovery, enablement, rollback selection,
  and uninstall mutations to `PluginInstallationStore`.
- Strengthen index invariants so every pointer references a compatible non-quarantined record.
- Cover successful promotion, failed first install, failed update with fallback, interrupted active
  recovery, stale identity rejection, and idempotent mutation.

### MKT7B — Runtime handshake

- Recover interrupted attempts before any installed plugin can activate.
- Mark the exact attempt before package reinspection and launch.
- Report projection failure immediately; promote only after the bounded health timer and a live
  session check.
- Refresh Settings snapshots after every lifecycle mutation.

### MKT7C — Restart and Installed UI

- Add the restart coordinator and recovery banner.
- Add enable/disable, update, rollback, uninstall, fallback, retained-data choice, diagnostics, and
  non-color status to the Installed view.
- Keep Marketplace source management independent of installed lifecycle state.

### MKT7D — Cleanup and fault injection

- On startup, recover the installation index before reading packages. A missing or corrupt current
  generation falls back to the previous valid generation; a stale `next` generation is never
  promoted implicitly. The recovered generation is republished atomically before activation.
- Remove abandoned download staging, extraction staging, uninstall tombstones, and immutable
  package directories that are not referenced by the recovered installation index.
- Every plugin retains all versions named by `pendingVersion`, `activeVersion`, or
  `knownGoodVersion`. Outside those protected pointers, retain at most three quarantined versions
  admitted during the last 30 days, then the newest known-good history, with a hard ceiling of
  eight retained versions per plugin. Cleanup never removes plugin settings, trust decisions, task
  caches, or other plugin-owned data.
- Inject failure at every index write, package reinspection, launch, handshake, projection,
  promotion, restart, rollback, and removal boundary.

The cleanup order is index-first and bytes-second: persist a pruned, valid generation, derive the
exact set of referenced `(pluginId, version, digest)` package directories from that generation, and
only then delete unreferenced bytes. This keeps a crash on either side of cleanup resolvable to a
complete old-good or new-good generation.

## Acceptance gates

- The installation index always resolves to old-good or new-good after interruption; it never
  exposes a half-installed active package.
- A crash between `current -> previous` and `next -> current`, a corrupt current generation, and a
  stale `next` file all recover without losing the last valid installation selection.
- Repeated startup cleanup is idempotent, never follows package-store symlinks, and leaves every
  package referenced by the surviving index present.
- A deliberately broken update is quarantined and the prior known-good version activates on the
  next attempt.
- A healthy first install is promoted only after the exact session survives the checkpoint.
- Disable, rollback, uninstall, window close, and app exit leave no plugin host process or pending
  capability operation.
- The Android GitHub Release package passes install, restart, activation, update failure, rollback,
  disable, uninstall/fallback, and clean reinstall smoke tests in the installed signed app.
