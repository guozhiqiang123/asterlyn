# Plugin authority, crash containment, and recovery hardening plan

Status: in progress — local hardening implemented through PCR6; packaged cross-platform gates remain

Date: 2026-10-21

## Outcome

Make plugin execution least-privileged before making plugin failure isolated, observable, and
recoverable. A package declaration must not be able to turn a narrow capability into arbitrary
local command execution, workspace bytes must not mint executable trust, and the bytes activated
later must remain bound to the package admitted originally. For every executable plugin, Asterlyn
must also keep the native host and core workbench usable, remove the failed plugin's complete
contribution batch, revoke its capabilities, terminate its process tree, persist a safe version
selection, and prevent an automatic crash loop.

The immediate delivery adds fail-closed policy without changing plugin-host protocol `1`. The
authority migration intentionally revises the public package/SDK declaration surface: external
packages may request only host-owned semantic operations, never executable paths or raw argv. The
final delivery also removes the remaining in-WebView execution path for bundled plugins so
"bundled" describes distribution provenance rather than weaker isolation.

Related contracts and plans:

- [`ADR-0032`](../architecture/decisions/0032-decentralized-github-release-plugin-marketplace.md)
- [`external-plugin-runtime-plan.md`](external-plugin-runtime-plan.md)
- [`plugin-marketplace-lifecycle-plan.md`](plugin-marketplace-lifecycle-plan.md)
- [`plugin release package contract`](plugin-release-package-contract.md)
- [`plugin capabilities and permissions`](../plugins/capabilities-and-permissions.md)
- [`plugin-contracts.md`](../governance/plugin-contracts.md)

## Implementation status — 2026-10-21

| Phase | State | Evidence / remaining gate |
| --- | --- | --- |
| PAH0 | implemented locally | Admission and activation both reject package-selected executable/argv authority. The temporary Android `0.5.7` compatibility mapping has been deleted; every schema-2 authority package now fails closed. Cross-platform packaged evidence remains before the public release gate. |
| PAH1 | implemented locally | Package schema `3`, Plugin SDK `1.10.0`, typed host-operation declarations, repository-bound native registry lookup, hostile legacy-schema rejection, and Android `0.5.8` migration are present. |
| PAH2 | core implemented locally | Every semantic process operation requires active plugin/workspace trust, executable resolution is limited to canonical host-approved Android SDK roots, execution rechecks trust and identity immediately before spawn, and symlink escape tests pass. Packaged macOS/Windows provenance evidence remains. |
| PAH3 | core implemented locally | Canonical all-file content digest, installation schema `2`, fail-closed migration, retained authenticated archive, owner-only read-only generation sealing, activation verification, quarantine/fallback integration, and manifest/runtime tamper tests are present. Packaged replacement-race evidence remains. |
| PAH4 | core implemented locally | Fresh installs are disabled, Install and Enable are separate reviews bound to exact digest and semantic authority, and Settings merges lifecycle, runtime, diagnostics, settings, rollback, and uninstall into one card per plugin identity. Broader interaction/accessibility and authority-diff packaged acceptance remain. |
| PCR1 | implemented locally | Native sessions now have an idempotent process watcher, exact-session eviction, bounded final diagnostics, one-shot termination receipts, and a Tauri observer that cancels/revokes session-scoped tool authority before emitting the window event. Focused idle-crash, duplicate-event, expected-replacement, and process-tree tests pass. Packaged platform evidence remains. |
| PCR2 | implemented locally | The desktop event is strictly parsed and exact-session matched. Fatal events clear the health timer, abort renderer projections, atomically remove the external contribution batch, surface localized persisted/non-persisted recovery state, and keep graceful transitions within a host-owned stop budget. Packaged evidence remains. |
| PCR3 | implemented locally | Exact-digest healthy crashes are quarantined idempotently, the newest prior known-good version is selected, sibling sessions in every window stop, and renderer reconciliation restarts only a marketplace-confirmed fallback. Persistence failure stays stopped and fail-closed. Packaged multi-window evidence remains. |
| PCR4 | platform adapters implemented locally | Linux applies address-space and CPU limits; Windows uses a Job Object for process memory, CPU, child count, and tree cleanup; macOS applies a CPU limit plus resident-footprint watchdog. Stderr remains continuously drained and bounded. Windows compilation, released-plugin measurements, stronger macOS memory enforcement, sandbox/restricted-token work, and packaged stress evidence remain, so no hard cross-platform isolation claim is made. |
| PCR5 | implemented locally | Android `0.5.8` is embedded as a digest-pinned schema-3 package, admitted into the immutable installation store at startup, enabled only on first install, and executed through the sidecar. The WebView dependency and direct executable module import are removed; bundled packages may be disabled but not uninstalled. Packaged parity and helper-kill smoke remain release gates. |
| PCR6 | local fault suite expanded | Idle exit, invoke crash, mismatched protocol response, stderr flood, exact-session replacement, peer isolation, renderer teardown, fallback, and persistence-failure tests are present. Deterministic hang/CPU/memory fixtures plus macOS and Windows release-artifact smoke remain the release gate. |

## Audit verification — 2026-10-21

The supplied independent audit was materially correct when received. The findings were checked
against source rather than accepted as instructions. The table below preserves that audit snapshot;
the implementation-status table above records the remediation now present in this working tree.

| Finding | Verdict | Current evidence and qualification |
| --- | --- | --- |
| `host.process.query` can execute arbitrary commands | confirmed, critical | Package admission bounds counts, length, timeout, and output, but accepts arbitrary one-segment PATH names and arbitrary non-NUL arguments in `asterlyn-plugin-package::tool_authority`. The native manager resolves inherited PATH and calls `Command::new(executable).args(args)`. A package can therefore declare an interpreter such as `sh`, `bash`, or `powershell` with a command argument. The same raw executable/template problem also exists in package-declared `toolOperations`; typed parameter slots do not make plugin-owned literal argv or executable candidates safe. |
| Workspace files influence executable selection | confirmed, high | `WorkspaceProperty` turns values such as `local.properties:sdk.dir` into an executable root, and Android SDK discovery prioritizes that workspace value. The final path is canonicalized and checked for executability, but it is not constrained to a host-approved SDK root and the process capability does not require workspace trust. The shipped Android provider calls `adb.devices` during provider startup, so this is not only a manually initiated path. |
| Activation is not bound to the admitted package digest | confirmed, high | Download verifies the archive digest and stores it in the installation identity, but activation re-reads the extracted tree and checks only identity plus internal manifest/file consistency. `manifest.json` is deliberately outside its own integrity table, and the recomputed tree is never compared with a digest derived during admission. The digest-shaped directory name is not an integrity boundary. |
| No OS memory/CPU limit | confirmed, high | The helper has process-group cleanup, protocol/output/time bounds, and Boa loop/recursion/stack limits, but no enforced per-helper OS memory, CPU, or child-count budget. |
| A post-health crash leaves stale contributions/active state | confirmed, medium | Fatal invocation paths evict native sessions, but there is no proactive child-exit lifecycle event to the renderer and no post-health persisted crash transition. |
| Deactivation can wait for stale RPC before killing native session | confirmed, medium | `ExternalPluginRuntime.clearActive()` awaits renderer session disposal before native deactivation, while disposal waits for all pending calls without its own deadline. Native calls are normally bounded, but workspace replacement still inherits that wait and has no independent small transition budget. |
| Installed UX duplicates identity and enables by default | confirmed, medium | lifecycle cards and management-catalog cards can represent the same installed plugin separately, admission review shows permission IDs rather than concrete authority, and a newly admitted installation is created with `enabled: true`. |

The positive architectural observations are also valid: archive traversal/link/size checks, the
Boa sidecar boundary, bounded framing and output, window/workspace identity binding, transactional
contribution publication, process-tree cleanup, and known-good/quarantine lifecycle provide a good
base. They do not compensate for raw process authority, because that capability crosses the sidecar
boundary and asks the host itself to execute package-selected commands.

Accordingly, all public plugin contracts remain `experimental-public`. Asterlyn must not describe
the current catalog as safe for arbitrary untrusted third-party plugins or graduate it to `stable`
until PAH0–PAH4, PCR1–PCR4, and the packaged hostile-plugin gate in PCR6 pass.

## Current baseline and gaps

The installed-plugin path already has a meaningful containment boundary:

- every active installed plugin runs in its own `asterlyn-plugin-host` child process and process
  group;
- JavaScript callback failures are returned as bounded remote errors;
- activation and callback deadlines, protocol bounds, loop/recursion/stack limits, bounded stderr,
  and process-tree termination are implemented;
- activation publication is transactional; and
- failed or interrupted activation attempts can be quarantined and rolled back.

The remaining gaps prevent this from being a complete authority and crash-recovery contract:

1. External package schemas let a package select executable candidates and literal argv for
   `processQueries` and `toolOperations`. Permission admission is therefore much broader than the
   names `host.process.query` and `host.tool.execute` imply.
2. Workspace properties can introduce a new executable root without trusted-workspace review or
   containment to a host-approved toolchain installation.
3. Activation revalidates a mutable extracted tree for self-consistency but does not bind that tree,
   including `manifest.json`, to an admission-time content digest.
4. Admission review shows capability and permission IDs but not semantic operations, executable
   provenance, mutation intent, or enablement consequence; new installations default to enabled.
5. Child exit is discovered only when a later invocation observes the closed protocol pipe. There
   is no proactive process-exit watcher.
6. A fatal native session error removes the supervisor session but does not notify the renderer.
   The renderer therefore retains stale commands/providers until a workspace or plugin reload.
7. Fatal exit after the health checkpoint has no persisted lifecycle transition. The version stays
   `knownGood`, so the next start can run the same crashing bytes again.
8. Process-query/tool authority is not revoked as one atomic part of every unexpected runtime exit.
9. Graceful deactivation waits for renderer pending calls before requesting native process
   termination, so a stale RPC can delay a workspace replacement or plugin reload.
10. The design promises process memory/CPU/idle enforcement, while the implementation currently has
   VM, protocol, wall-time, output-capture, and process-tree bounds but no complete OS-level
   memory/CPU policy and no defined safe idle-rehydration behavior.
11. Bundled plugins remain compile-time reviewed code imported into the WebView. Activation errors
   are contained, but a hard loop, memory exhaustion, or engine-level failure can still make the
   renderer unusable.
12. Existing tests prove normal isolation and lifecycle cleanup, but do not exercise hostile
   executable declarations, workspace-directed tool substitution, extracted-package mutation, or
   installation enablement policy. They also do not kill a healthy helper unexpectedly and assert
   host liveness, immediate contribution removal, authority revocation, fallback, and absence of
   orphan descendants in one end-to-end scenario.

## Failure taxonomy

The implementation must classify failures before applying policy.

| Class | Examples | Session action | Version action |
| --- | --- | --- | --- |
| Recoverable plugin error | thrown callback, rejected Promise, capability denial, invalid user input | return bounded error; keep session | none |
| Fatal session fault | child exit/panic/signal, protocol EOF/corruption, request timeout, resource-limit termination | remove exact session, kill process tree, revoke authority, publish one termination event | quarantine according to health state |
| Host-request cancellation | workspace replacement, disable, update, window/app exit | graceful shutdown then force cleanup | abandon only an unfinished health attempt |
| Host implementation fault | supervisor/adapter panic, poisoned state, invalid host event | fail closed and report as host fault | never blame plugin without exact evidence |

`Remote` callback errors are not crashes. `Timeout`, `Protocol`, `Crashed`, and resource-policy
violations are fatal. Expected shutdown must never be reported or persisted as a crash.

## Required invariants

1. No external package field can select an executable path, PATH program, environment variable,
   workspace property, shell/interpreter, or raw literal argv. Packages request versioned semantic
   operation IDs; the host owns executable resolution, argument construction, validation, timeout,
   output limits, and mutation policy.
2. Workspace content is data, not authority. It may select among already approved host toolchains,
   but it cannot introduce a new executable root. External process/tool operations require current
   workspace trust and fail closed on trust revocation.
3. Every activation proves that the exact manifest and file set match an admission-time content
   digest bound to plugin ID, version, repository, and archive digest. Internal self-consistency and
   a digest-shaped directory name are insufficient.
4. A newly installed external plugin is disabled until the user explicitly enables the reviewed
   version and authority set. Settings presents one card per plugin identity.
5. A plugin process exit cannot terminate the Tauri host, blank Settings, remove core workbench
   features, or unregister another plugin.
6. Exactly one terminal event is produced for an unexpected session exit.
7. Every terminal event carries owner/window, plugin ID, version, package digest, session ID, and a
   bounded reason. No raw plugin value, unbounded stderr, or executable path enters the event.
8. Cleanup compares the exact session ID/digest. A late exit from a replaced process cannot evict
   the replacement session.
9. Native capability authority and owned operations are revoked before the failed plugin can issue
   another request.
10. The renderer removes the complete contribution batch before awaiting slow diagnostics or
   lifecycle persistence.
11. A fatal exit before health promotion quarantines the pending digest using the existing failed
   activation path.
12. A fatal exit after health promotion quarantines that exact digest and never automatically
   restarts it in the same process.
13. The newest compatible prior `knownGood` digest may be activated once as fallback. The embedded
   bundled version is only eligible after it has itself become a distinct known-good digest; otherwise
   show the plugin as unavailable.
14. A fault in one window invalidates the same plugin/version/digest in every window; sibling
    sessions are stopped as expected shutdowns and do not create duplicate crash records.
15. Workspace replacement, disable, update, and app/window shutdown request native cancellation
    before waiting for renderer promises and complete within a bounded transition budget.
16. Resource-policy setup either succeeds with a documented guarantee or external execution fails
    closed with a host-owned diagnostic.
17. Plugin protocol `1` remains unchanged unless a plugin-visible wire message is genuinely needed.
    Host lifecycle events are a desktop bridge concern, not plugin ABI.

## Authority flow after hardening

```text
external package manifest
        |
        | semantic operation ID + narrow intent only
        v
package admission ---- rejects legacy executable/argv declarations
        |
        v
user reviews operation, data scope, mutation intent, and enablement
        |
        v
trusted workspace + exact admitted content digest + active session identity
        |
        v
host-owned operation registry builds fixed executable and validated argv
        |
        v
approved toolchain root + OS resource/process container
```

At no point may package-controlled text or workspace-controlled bytes become an executable identity
or an unvalidated argument template.

## Target flow

```text
plugin helper exits / times out / violates protocol / exceeds a resource limit
                 |
                 v
native session monitor claims the exact terminal transition once
                 |
                 +--> remove exact supervisor session and kill process group
                 +--> cancel/revoke native capability operations
                 +--> persist quarantine and select safe fallback
                 `--> emit bounded session-terminated event to affected windows
                                      |
                                      v
renderer matches exact session identity
                 |
                 +--> unregister contribution batch immediately
                 +--> reject/close projected callbacks and subscriptions
                 +--> report a host-owned diagnostic/notification
                 `--> activate one safe fallback or leave plugin unavailable
```

## Lifecycle policy after a fatal exit

### Before the health checkpoint

Reuse the existing `mark_activation_failed` transaction: quarantine the exact version/digest,
clear the pending selection, and restore the prior known-good selection. Projection failure and a
process crash during the checkpoint have the same persisted outcome.

### After the health checkpoint

Add a marketplace mutation dedicated to runtime crashes. It must:

1. accept only the exact active/known-good version and digest reported by the native session;
2. change that version to `quarantined`;
3. retain a bounded failure record containing reason class and occurrence time, never arbitrary
   plugin output;
4. select the most recently admitted compatible `knownGood` version excluding the failed digest;
5. clear active/known-good pointers when no safe installed fallback remains; and
6. commit the complete mutation atomically before any automatic fallback activation.

The host stops every sibling session for the failed digest. Each window may then reconcile once to
the selected installed fallback. An embedded bundled version participates only as another isolated,
previously known-good digest; no in-process fallback exists. Otherwise the plugin remains unavailable
with Rollback, Update, Disable, Diagnostics, and explicit Retry actions in Settings.

Retry is always user-initiated and exact-digest scoped. It creates one new pending health attempt;
it does not silently clear other quarantined versions or enter an automatic restart loop.

## Delivery phases and commit boundaries

### PAH0 — Immediate public-channel containment

1. Keep all marketplace/runtime contracts `experimental-public` and add an explicit product warning
   that arbitrary untrusted third-party installation is unsupported.
2. Reject newly admitted external packages that contain legacy raw `processQueries` or
   `toolOperations` executable/argv declarations. A temporary compatibility mapping may name an
   exact first-party repository, plugin ID, version, and archive digest, but the mapping itself must
   supply host-owned fixed operation implementations. It must never execute executable candidates
   or literal argv read from that package, must not be ID-only, and must expire when PAH1 ships.
3. Refuse activation of an already installed legacy-authority package unless it matches that exact
   compatibility mapping. Ignore its raw process declarations and expose only the fixed host-owned
   operations. Do not silently preserve broad authority for an old package.
4. Update admission and diagnostics copy so blocked packages explain which legacy declaration caused
   rejection and how to migrate. Never fall back to unsupervised execution.
5. Add regression fixtures for `sh -c`, `bash -c`, `cmd /C`, PowerShell command modes, generic PATH
   tools, environment candidates, workspace-property candidates, and equivalent literal templates
   in `toolOperations`.

Exit gate: an external package outside the exact host-owned compatibility mapping cannot cause
`Command::new` to receive a package-chosen executable or literal argv on any supported platform.

Commit boundary: admission policy, exact temporary mapping, host-owned fixed operations,
user-facing diagnostics, and hostile package tests.

### PAH1 — Replace raw process authority with host-owned semantic operations

1. Introduce a versioned host operation registry. Initial operations cover only proven needs, for
   example `android.listDevices`, `android.inspectApk`, `android.installApk`,
   `android.uninstallApplication`, and `android.launchApplication`.
2. Each registry entry owns supported platforms, executable resolver, fixed argument grammar,
   parameter kinds, workspace/artifact containment, query/mutation intent, timeout, output limit,
   cancellation, and redaction policy.
3. Replace public manifest `executables` and `args` fields with operation IDs and the narrow
   parameters required for declaration. Remove `Path`, `Environment`, `WorkspaceProperty`, and
   `AndroidSdkBuildTools` candidates from the external package schema.
4. Bump package schema and Plugin SDK capability version. Reject the legacy form for external
   packages rather than trying to infer whether raw argv is safe. Keep migrations explicit in the
   developer guide and diagnostics.
5. Make the native command accept the admitted operation ID and typed values only. It must look up
   implementation from host code; no package-derived executable or literal argv crosses that lookup.
6. Move the first-party Android declarations to the new operations, publish a migrated package, and
   delete the exact compatibility mapping from PAH0.

Exit gate: searching the public package/SDK schema finds no external executable-candidate or raw
argv declaration, and hostile packages cannot express a shell or new local program.

Commit boundary: schema/SDK revision, native operation registry, Android migration, compatibility
diagnostics, and contract tests.

### PAH2 — Trusted workspace and executable provenance

1. Require active plugin-scoped workspace trust for every semantic operation that starts a local
   process, including read-only discovery. Trust revocation cancels outstanding operations and
   revokes operation authority atomically.
2. Maintain host-approved toolchain roots from application settings, a reviewed environment import,
   or a host installer. A workspace property may match/select one approved canonical root; it may
   not add a root.
3. Resolve and canonicalize the exact executable immediately before spawn, prove it remains beneath
   the approved root, reject symlink/reparse-point escapes, and bind the resolved identity used by
   the spawn path. Host PATH lookup is permitted only inside a host-owned operation implementation
   with an explicit executable-name allowlist.
4. Store bounded executable provenance in diagnostics: operation ID, source class, approved-root ID,
   and tool version. Do not expose secrets or treat a path string alone as proof.
5. Revalidate trust, workspace generation, plugin/session identity, content digest, and operation
   authority at execution time, not only when the capability object is created.

Exit gate: a malicious `local.properties`, environment change, PATH prefix, symlink swap, stale
workspace generation, or revoked trust cannot redirect an admitted operation to another program.

Commit boundary: trusted-toolchain store, canonical containment, execution-time authorization,
diagnostics, and platform path-substitution tests.

### PAH3 — Bind activation to immutable admitted content

1. During admission compute a canonical extracted-content digest over sorted normalized path, file
   type, size, and SHA-256 for every package file, including `manifest.json`. Bind it to repository,
   plugin ID, version, and verified archive digest in the installation index.
2. Retain the verified source archive or another independently authenticated immutable source. Use
   atomic extraction into a fresh generation, prohibit links/special files, and make completed
   generations owner-only and read-only before they become selectable.
3. Before every activation recompute the canonical content digest and compare it with the persisted
   admission record. Identity parity and manifest self-consistency remain additional checks, never
   substitutes for the digest comparison.
4. Treat any mismatch as package corruption: do not admit authority or start the helper; quarantine
   the exact version/digest, retain bounded evidence, and select the normal known-good fallback.
5. Minimize the verification-to-execution race. The supervisor must activate the exact verified
   generation and runtime entry; generation replacement is atomic and active generation directories
   are never updated in place.
6. Migrate installation-index schema safely. Existing records without a content digest must be
   re-derived from a still-verified retained archive or be marked for reinstallation; never bless
   the mutable current tree as original merely because it is self-consistent.

Exit gate: changing only runtime bytes, only `manifest.json`, both manifest and its integrity table,
or the selected generation after admission always blocks activation before authority is registered.

Commit boundary: package digest model, installation-index migration, immutable generation storage,
activation verification, quarantine integration, and tamper tests.

### PAH4 — One comprehensible install, permission, and enablement model

1. Render one Installed card per plugin identity by merging source, admitted versions, selected
   digest, enablement, runtime health, permissions, semantic operations, diagnostics, rollback,
   update, disable, and uninstall state.
2. Make newly installed external plugins disabled by default. Installation stores verified bytes;
   a separate explicit Enable review selects the exact version/digest and authority set. If product
   design keeps one-step flow, the action must be labeled unambiguously as “Install and enable after
   restart” and receive equivalent review evidence; default-disabled remains the release target.
3. Admission/enable review displays operation names, query versus mutation intent, parameter/data
   scopes, trusted-toolchain source, workspace-trust requirement, and resource bounds. A permission
   ID alone is not informed consent.
4. Re-review on any authority expansion, executable provenance change, package digest change, or
   requested mutation operation. Updates with identical or narrower authority may use a concise
   diff, but must still show the exact new digest.
5. Show blocked legacy declarations, package corruption, quarantine, fallback, and resource-policy
   failures on that same card with host-owned recovery actions.

Exit gate: a fresh install cannot activate without explicit reviewed enablement, each plugin appears
once, and a user can understand what local tools and mutations the exact version may request.

Commit boundary: installation default/migration, unified view model and UI, authority-diff review,
localization, accessibility, and interaction tests.

### PCR0 — Freeze the crash contract

1. Land this plan and link it from the documentation map.
2. Reconcile the stronger claims in ADR-0032 and the external-runtime plan with the actual staged
   gates below.
3. Freeze the failure taxonomy, exact-session identity, fallback policy, and acceptance matrix.

Exit gate: code review can distinguish callback failure, fatal plugin fault, expected shutdown, and
host fault without guessing.

Commit boundary: documentation only.

### PCR1 — Proactive native session supervision

1. Add a product-neutral `PluginSessionTermination` model and termination-reason enum to
   `asterlyn-plugin-runtime`.
2. Start one lightweight process watcher only after a session is inserted successfully. It observes
   child exit independently of callback traffic and owns no plugin protocol authority.
3. Make the terminal transition idempotent across process watcher, protocol reader, invocation
   timeout, explicit stop, and `Drop`.
4. Remove a session only when key plus session ID still match. A stale watcher records nothing and
   cannot remove a replacement.
5. Retain a bounded final diagnostic snapshot before releasing the child handle.
6. Expose a host-owned termination observer from the runtime crate without adding a Tauri
   dependency.
7. On Tauri integration, cancel plugin-owned native operations and revoke process-query/tool
   authority before publishing a window-scoped lifecycle event.
8. Keep clean disable, replacement, window close, application exit, and restart on the existing
   expected-shutdown path.

Exit gate: an idle helper killed externally is evicted and reported without waiting for another
invoke; a replaced session survives a late old-process exit; the event is emitted exactly once.

Commit boundary: runtime supervisor, native lifecycle coordinator, and focused Rust tests.

### PCR2 — Renderer teardown and visible degraded state

1. Add a strictly parsed desktop event such as `plugin-runtime-terminated`; include exact session
   identity and a bounded host reason. Do not reuse plugin-generated subscription events.
2. Subscribe from `ExternalPluginRuntime` and ignore events whose owner/session/version/digest do
   not match its current entry.
3. Add an abort path distinct from graceful `dispose()`. It marks the external session closed,
   rejects future callback projection, clears listeners, and releases the complete registry batch
   immediately without waiting for already failed native calls.
4. Reorder every graceful stop path: mark closing and release contributions, request native
   deactivate/cancellation immediately, then settle or abandon renderer promises within a small
   host-owned deadline. Workspace replacement, disable, update, and window/app close must not wait
   for a stale plugin RPC before terminating its native process.
5. Clear the health timer before any asynchronous follow-up. During the health window call the
   existing failed-activation path exactly once.
6. Surface one localized host notification and one Installed-plugin diagnostic. Do not render
   plugin-supplied error markup.
7. Ensure command palette, Tasks, execution targets, run configurations, subscriptions, and
   plugin Settings targets all observe the same atomic registry removal.

Exit gate: after a synthetic termination event no failed-plugin contribution remains in any host
surface on the next render turn; core and unrelated-plugin contributions remain unchanged. A
blocked renderer call cannot hold workspace replacement past the transition budget.

Commit boundary: desktop event schema/adapter, external runtime teardown, localization, and
frontend tests.

### PCR3 — Persisted quarantine, multi-window reconciliation, and fallback

1. Add the exact-digest post-health crash mutation and installation-index migration.
2. Select fallback deterministically: newest compatible prior known-good version, including a safe
   retained embedded version, then unavailable.
3. Coordinate one global incident per plugin/version/digest. Stop sibling window sessions, but
   persist only the originating fatal event.
4. Reconcile each open window once after the mutation. Never hot-restart the failed digest.
5. Make persistence failure fail closed for the current process: keep the external plugin stopped,
   retain core UI, and show that recovery state could not be saved.
6. Add Settings presentation for crash reason class, quarantined version, selected fallback,
   diagnostics, explicit Retry, Update, Rollback, and Disable.
7. Preserve graceful app-exit semantics so clean shutdown during a pending checkpoint remains
   retryable rather than quarantined.

Exit gate: a healthy version that crashes cannot enter a startup loop; every open window converges
to the same fallback; restart does not reactivate the quarantined digest without explicit review.

Commit boundary: marketplace lifecycle mutation/migration, multi-window coordinator, Settings
state, and recovery tests.

### PCR4 — Enforced resource policy

1. Introduce a `PluginProcessResourcePolicy` owned by the native supervisor. Freeze numeric limits
   only after measuring the released first-party Android plugin on every supported architecture,
   with explicit startup and steady-state headroom.
2. Enforce a hard per-helper memory ceiling using supported platform primitives. Prefer Windows Job
   Objects on Windows and a reviewed macOS process policy/watchdog; do not claim a guarantee from a
   no-op or advisory limit.
3. Put the JavaScript helper in the narrowest supported OS sandbox/restricted-token boundary: it
   needs read-only access to its exact verified package generation and protocol pipes, but no
   workspace filesystem, network, or process-spawn authority. If a supported platform cannot
   provide a claimed sandbox guarantee, document the limitation and keep the contract experimental.
4. Apply a separate per-operation resource and environment policy to host-owned semantic tool
   processes. Each registry entry defines working directory, inherited environment, child-process
   policy, memory/CPU budget, and any required workspace/artifact access; the plugin cannot widen it.
5. Enforce bounded CPU/runaway behavior with the existing VM turn limit plus parent wall-clock
   deadline and a platform process guard. Classify guard termination as a resource-limit fault.
6. Keep protocol/stdout and diagnostic/stderr memory bounded while continuously draining pipes so
   a noisy plugin cannot deadlock its helper.
7. Apply limits to the complete plugin-owned process group where the platform supports it and
   retain unconditional process-tree termination as the final cleanup.
8. Define idle behavior honestly. Either add safe lazy deactivation/rehydration for sessions with
   no callbacks or subscriptions, or remove the unimplemented idle-timeout guarantee from current
   architecture documents. Do not kill a valid provider merely because it has been quiet.
9. Record installed-app resource evidence for macOS and Windows and fail external activation with a
   clear diagnostic when the minimum policy cannot be established.

Exit gate: deterministic memory, CPU/runaway, timeout, output-flood, and descendant-process fixtures
terminate only the faulty helper; host memory remains bounded and the core UI stays responsive.

Commit boundary: platform resource adapters, policy configuration, diagnostics, measurements, and
cross-platform CI/packaged evidence.

### PCR5 — Converge bundled execution onto the isolated host

1. Package first-party bundled integrations as immutable embedded plugin artifacts admitted by the
   host, rather than importing executable plugin modules into the WebView.
2. Keep `bundled` as source/provenance and fallback policy; execute callbacks through the same
   helper, capability, lifecycle, and resource boundary as installed plugins.
3. Retain only host-owned declarative projection and management code in the renderer.
4. Remove the direct `@asterlyn/plugin-android-gradle` runtime import after packaged parity passes.
5. Preserve offline availability, localization, upgrade/rollback semantics, and first-launch
   behavior for the embedded artifact.
6. If any in-process plugin path remains, label it trusted/internal and exclude it from the claim
   that all plugin crashes are process-isolated.

Exit gate: no executable plugin implementation runs on the workbench WebView thread; killing the
embedded Android plugin helper has the same containment and fallback behavior as an installed
plugin.

Commit boundary: embedded-package admission, composition migration, Android parity, and removal of
the in-renderer runtime path.

### PCR6 — Fault-injection and packaged acceptance gate

1. Extend the fixture helper with explicit modes for exit-after-ready, panic/signal on invoke,
   malformed frame, mismatched sequence, request hang, memory pressure, CPU runaway, stderr flood,
   and descendant survival attempts.
2. Add native tests for proactive exit observation, exact-session races, once-only termination,
   authority revocation, timeout cleanup, and complete process-tree cleanup.
3. Add frontend tests for pre-health and post-health failure, immediate registry release, stale
   event rejection, multi-window convergence, bundled fallback, and persistence failure.
4. Add a packaged desktop smoke test that records host PID and helper PID, kills the helper, and
   proves:
   - the host PID remains alive;
   - Settings and one core Git/editor action still work;
   - the failed contribution batch disappears;
   - another plugin remains active;
   - no descendant process remains; and
   - restart does not reload the quarantined digest.
5. Run the same smoke on supported macOS and Windows release artifacts. Development-only mocks are
   insufficient for the exit gate.

Exit gate: the release pipeline has direct evidence for the user-visible claim "a plugin crash does
not crash Asterlyn and the failed plugin is safely taken offline."

Commit boundary: hostile fixtures, automated suites, packaged smoke harness, CI wiring, and
benchmark evidence.

## Expected code impact

| Area | Likely files/modules | Responsibility |
| --- | --- | --- |
| Package authority contract | `crates/asterlyn-plugin-package/src/tool_authority.rs`, package manifest models, `packages/plugin-sdk` | reject raw executable/argv authority and expose semantic host operation IDs |
| Host operation registry | `src-tauri/src/application/plugin_process_query.rs`, `plugin_process_executable.rs` | host-owned executable/argv mapping, trust and approved-root enforcement, cancellation |
| Package content binding | `crates/asterlyn-plugin-package/src/lib.rs`, marketplace installation storage and commands | canonical all-file digest, retained archive/read-only generations, activation-time equality |
| Native session lifecycle | `crates/asterlyn-plugin-runtime/src/lib.rs` | child watcher, exact terminal transition, process cleanup, bounded diagnostics |
| Helper/runtime limits | `crates/asterlyn-plugin-host/*` | VM/resource fixture behavior and reason normalization |
| Marketplace recovery | `crates/asterlyn-plugin-marketplace/src/lib.rs` | post-health quarantine, fallback selection, persisted failure metadata |
| Tauri coordination | `src-tauri/src/application/plugin_runtime.rs`, `src-tauri/src/commands/plugin_runtime.rs`, `src-tauri/src/lib.rs` | authority revocation, global incident coordination, lifecycle event publication |
| Desktop contract | `protocol/desktop-protocol.v1.json`, `src/protocol/plugin-runtime.ts`, generated adapters | strictly validated host lifecycle event and recovery commands |
| Renderer runtime | `src/composition/external-plugin-runtime.ts`, `src/application/plugins/plugin-registry.ts` | exact-event matching, abort, atomic contribution release, fallback reconciliation |
| Plugin management UI | plugin management controller/view/localization files | one-card identity, authority review, explicit enablement, degraded/quarantined state and recovery actions |
| Bundled migration | `src-tauri/resources/plugins`, marketplace startup admission, composition and packaging scripts | digest-pinned embedded artifact execution through sidecar with no renderer runtime import |
| Acceptance | `crates/asterlyn-plugin-runtime/tests`, plugin-host fixtures, `scripts/external-plugin-runtime.test.mjs`, packaged smoke scripts | crash injection and host-liveness evidence |

## Acceptance matrix

| Case | Host alive | Contributions removed | Version result | Required evidence |
| --- | --- | --- | --- | --- |
| external package declares shell/interpreter/raw argv | yes | never published | admission rejected | cross-platform hostile-package fixtures |
| package declares generic PATH/environment/workspace executable | yes | never published | admission rejected | package-schema contract tests |
| workspace property points to fake SDK/tool | yes | unchanged | operation denied | approved-root and trust tests |
| workspace trust revoked during operation | yes | unchanged or plugin taken offline by policy | operation cancelled and authority revoked | generation/trust race test |
| extracted runtime file changed | yes | never published | exact version quarantined | activation tamper test |
| manifest and integrity entries changed together | yes | never published | exact version quarantined | canonical-content-digest test |
| fresh external package installed | yes | not published until Enable | installed disabled | marketplace lifecycle and UI test |
| installed plugin represented in Settings | yes | n/a | one identity/card | view-model and accessibility test |
| callback throws/rejects | yes | no | unchanged | callback receives bounded error; next call can succeed |
| activation process exits | yes | never published | exact digest quarantined | native + renderer integration test |
| healthy process exits while idle | yes | yes, proactively | exact digest quarantined; fallback selected | real child exit test |
| process exits during invoke | yes | yes | exact digest quarantined; fallback selected | pending call rejects and process tree is gone |
| malformed/oversized protocol | yes | yes | quarantined | hostile framing fixture |
| request timeout/runaway loop | yes | yes | quarantined | bounded wall time and no orphan |
| memory/CPU limit exceeded | yes | yes | quarantined | packaged platform resource fixture |
| old replaced session exits late | yes | no change to replacement | unchanged | exact-session race test |
| expected disable/workspace/window/app stop | yes | yes | no false crash quarantine | lifecycle suite |
| pending RPC during workspace replacement | yes | yes within transition budget | no false crash quarantine | blocked-bridge deactivation test |
| one window crashes shared digest | yes | removed in every window | one persisted incident and one fallback | multi-window test |
| no known-good fallback | yes | yes | unavailable | frontend and marketplace test |
| bundled helper crashes after PCR5 | yes | yes | prior isolated known-good digest or unavailable | packaged smoke test |

## Validation required for each implementation phase

- `npm run check` and focused frontend tests;
- Rust formatting, strict Clippy, and focused crate tests;
- hostile package fixtures for raw shell/argv, executable substitution, manifest/runtime tampering,
  symlink races, and legacy-schema migration;
- generated desktop protocol drift check when the bridge changes;
- full `npm run test:scripts` and Rust workspace tests before phase completion;
- clean working tree except for the intended phase;
- macOS and Windows release-artifact smoke evidence for PCR4 and PCR6; and
- an update to this plan's phase status only after its exit gate is met.

## Priority and rollout

Recommended implementation order:

1. Ship PAH0 as an emergency fail-closed patch before any other marketplace work.
2. Implement PAH1 and PAH3 as separate commit series; they touch different trust boundaries and can
   converge at activation without weakening either gate.
3. Build PAH2 on the host operation registry from PAH1, then migrate/publish the Android package.
4. Land PAH4 after the new authority and digest models are stable enough to present accurately.
5. In parallel with the authority work, deliver PCR1, then PCR2, then PCR3; PCR2 consumes PCR1's
   exact termination event and PCR3 consumes both layers' incident identity.
6. Add PCR4 before making resource-isolation claims, use PCR6 as the public release gate, and treat
   PCR5 as the later convergence step for bundled code.

- **P0 immediate containment:** PAH0. Ship this before accepting another public external package.
- **P0 authority boundary:** PAH1–PAH3. Stable third-party positioning is blocked until raw process
  authority, workspace-derived executable trust, and mutable extracted-package activation are gone.
- **P0 informed lifecycle:** PAH4. External installation must be disabled by default and represented
  by one authority-aware management model.
- **P0 crash containment/recovery:** PCR1–PCR3. These close stale UI, blocked deactivation,
  crash-loop, authority-revocation, and multi-window gaps for installed plugins.
- **P1 resource guarantees:** PCR4. Do not advertise hard memory/CPU isolation before its packaged
  evidence passes.
- **P1 full-system isolation:** PCR5 is locally complete. Packaged parity and helper-kill evidence
  still gate the claim that every shipped executable plugin is isolated in release builds.
- **Release gate:** PCR6. No broad "plugins cannot crash the host" claim without the packaged smoke
  evidence.

PAH0 is the fail-closed baseline and is not reverted while legacy raw authority remains expressible.
Later phases are independently revertible only to that baseline. A failed renderer rollout can
disable lifecycle-event consumption while retaining native cleanup; a failed resource-policy
rollout disables external activation rather than falling back to an unbounded helper; a failed
bundled migration leaves the Android integration unavailable rather than restoring an in-process
WebView execution path.
