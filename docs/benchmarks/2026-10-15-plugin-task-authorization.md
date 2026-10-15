# Plugin task authorization acceptance

Date: 2026-10-15

Representative workspace: `/Users/gzq/AndroidStudioProjects/FilesRecovery`

Application version: `0.1.8`

## Accepted behavior

- Android/Gradle `0.1.4` owns the workspace-trust and remembered-task declarations together with
  their English and Chinese copy. The host contains no Android-specific authorization label,
  default grant, command, storage path, or custom plugin UI.
- The host renders the current workspace's trust as a real switch under **Settings → Plugins →
  Android / Gradle**. Authorization state is keyed by canonical workspace and plugin ID. Turning the
  switch off writes an explicit denial, cancels active work in that workspace, and clears every
  remembered task grant in that plugin/workspace scope.
- A trusted task review shows the plugin-localized remember option only when the plugin declares
  it. The checkbox is unchecked by default. Checking it and confirming remembers only that exact
  reviewed invocation.
- Every later invocation still passes through native preparation. The visible dialog is skipped
  only when the live review matches canonical workspace, plugin, provider, task ID, executable
  path and content identity, arguments, and working directory. A changed wrapper or command asks
  again.
- Version-1 path-only workspace trust remains a read-only compatibility fallback. New writes use
  the version-2 plugin-scoped schema. Corrupt, unsupported, oversized, stale, or mismatched state
  fails closed.

The governing design is [ADR-0025](../architecture/decisions/0025-plugin-scoped-task-authorization.md),
the phased delivery is [Plugin task authorization rollout](../engineering/plugin-task-authorization-plan.md),
and the public inventory is [Plugin contract registry](../governance/plugin-contracts.md).

## Delivery boundaries

| Phase | Repository / commit |
| --- | --- |
| Decision and rollout plan | host `73a5059` |
| SDK 1.2 declaration and validation | host `e543161` |
| Android/Gradle declaration and localization | plugin `99d82de` |
| Android/Gradle 0.1.4 artifact record | plugin `837813a` |
| Pinned reviewed plugin artifact | host `73f6255` |
| Native plugin-scoped persistence and exact task grants | host `17079ba` |
| Settings switch and remembered-review interaction | host `e026a70` |
| Presentation/protocol ownership split | host `e5c01af` |
| Startup-boundary isolation | host `c0a1e65` |

The pinned `asterlyn-plugin-android-gradle-0.1.4.tgz` is 26,458 bytes with SHA-256
`e39608b6baa04bdfdb4a9151f72a0577718e69e95ffeb45a884ad8119030d844` and npm integrity
`sha512-ItUl8UmDurHJUfDPtsIdJGQQFIx92Evq+49XtNxJg+C8dP2dXPV0p2VUpmOcdLgstwxXtEVi/ZnnpW93I2J5rQ==`.
The previous plugin artifacts remain checked in for dependency rollback.

## Automated validation

| Check | Result |
| --- | --- |
| Android/Gradle `npm run verify` | passed; type check, 41 tests, ESM build |
| Focused authorization, execution, Settings, management, protocol, SDK, and artifact checks | passed |
| Host `npm run test:scripts` | passed; 1,139 tests, 0 failures |
| Host `npm run check` | passed |
| Host `npm run build` | passed; 653 modules; unchanged 500,000-byte startup-code gate |
| Native format check | passed |
| Native `cargo test -p asterlyn` | passed; 96 tests, 2 platform probes ignored by design |
| Built executable rendered smoke | passed within the 6-second gate |
| Installed executable rendered smoke | passed within the 6-second gate |
| Built, staging, installed, and retained-backup strict signature verification | passed |

Focused native tests prove canonical plugin/workspace isolation, compatibility fallback, corruption
and size rejection, concurrent atomic updates, exact task fingerprint matching, wrapper-content and
argument invalidation, and grant clearing on revocation. Frontend tests prove plugin-owned copy,
escaped Settings and dialog text, fail-closed switch states, unchecked consent, remembered
background start without a dialog, stale-response rejection, and per-workspace reload.

One unrelated XML-folding timing fixture failed during the first parallel full-suite run and passed
immediately in isolation and in the repeated complete 1,139-test run; no folding source was changed.

## Resource and accessibility evidence

| Bound / observation | Result |
| --- | ---: |
| Authorization file ceiling | 256 KiB |
| Plugin-scoped workspace decisions | at most 512 |
| Exact remembered task grants | at most 1,024 |
| Installed process point sample with FilesRecovery open | 62,128 KiB RSS, 0.0% CPU |
| Installed executable | 25,538,336 bytes |
| Installed executable SHA-256 | `7b13f4d629b1b152614a7e04e4d08ae51df3aad39b9a6d914c6b824e53f0e134` |

The switch uses native checkbox semantics with `role="switch"`, visible plugin copy, keyboard focus,
and checked/disabled state. The remember option is a labeled native checkbox in the host-owned
dialog; it never becomes selected implicitly. Automatic execution does not open or steal focus
from a dialog. These checks complement, but do not replace, the manual interaction acceptance
below. The resource sample is a point observation rather than a long-duration leak proof.

## Local package and recovery

| Item | Value |
| --- | --- |
| Archive | `target/release/bundle/macos/Asterlyn-0.1.8-local-20261015-161228-plugin-task-authorization.app.zip` |
| Archive size | 9,849,262 bytes |
| Archive SHA-256 | `c13043f837729f46a491bbabcb2e321779cc879941b2bba7b8f688083558881d` |
| Installation | `/Applications/Asterlyn.app` |
| Previous-app backup | `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261015-161228-plugin-task-authorization/Asterlyn.app` |
| Previous executable SHA-256 | `045690db360380b598fbf1ad8a740c16c1728a4062b370cb3cd343950479c565` |

The installed executable exactly matches the verified build. The retained backup exactly matches
the installation that was replaced. Asterlyn is open on FilesRecovery for human acceptance.

## Human acceptance checklist

1. Open **Settings → Plugins → Android / Gradle** and verify **Trust this workspace** is shown as a
   switch for FilesRecovery.
2. Turn it off, return to Tasks, and start a known safe Gradle task. Verify the workspace trust
   review appears and that trusting the workspace updates the Settings switch.
3. On the now-trusted review, leave **Do not ask again for this exact Gradle task** unchecked once
   and verify the next run still asks.
4. Run it again with the option checked. Repeat that same task and verify it starts in the Tasks
   panel without reopening the dialog.
5. Choose a different task and verify it still asks. Turn workspace trust off and verify the
   previously remembered task asks again after trust is restored.

Dynamic third-party plugin loading, grant synchronization between machines, wildcard approvals,
and task-name-pattern approvals remain outside this slice. Plugins declare authorization policy and
copy, while storage and process authority intentionally remain inside the native host boundary.
