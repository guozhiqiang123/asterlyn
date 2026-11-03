# Gradle task Java runtime recovery

Status: implemented and locally installed, 2026-11-03; automated/native and user acceptance passed.

## Incident and evidence

The installed boostCleaner workspace uses Gradle 8.13. Eight recent discovery runs failed in
7–10 seconds with exit code 1. The corresponding Gradle daemon logs identify JDK 25 and
`:tasks → :outgoingVariants → DefaultReportContainer → Type T not present`. The isolated plugin
completed its callbacks normally; no runtime timeout or output truncation occurred.

Controlled unchanged-project probes on 2026-11-03 reproduced the failure with JDK 25 in
8.412 seconds. JDK 17 completed the same task scan in 9.963 seconds; the actual plugin parser
accepted 13,676 tasks. Evidence: `/tmp/asterlyn-boost-task-diagnosis-20261103/` and installed
session `session-1793684552984-20176-0` (notably events 387–407).

The task process currently inherits Java from the application's environment, whereas packaged
analysis already resolves declared Java tools. On an icon launch with no JAVA_HOME, macOS selects
the system's newest JDK, even if that JDK cannot run the project's wrapper.

Reference: [Gradle Java compatibility](https://docs.gradle.org/current/userguide/compatibility.html).

## Scope and boundaries

- Keep task execution, trust, cancellation and output limits generic. Isolate wrapper/version
  policy in a small native Gradle execution adapter; share bounded installed-JDK inspection with
  packaged analysis where practical. Do not add Gradle or Java compiler logic to the frontend.
- Apply the adapter to the reviewed root `gradlew`/`gradlew.bat` only. Discovery, ordinary tasks
  and Android Run build stages all use the same reviewed native task path. Other executables keep
  their existing behavior. This repair does not require an SDK/protocol or plugin release.
- Read only bounded fixed configuration inputs. Do not execute Gradle/Java merely to discover a
  version, copy IDE tools, provision JDKs, change global JAVA_HOME, upgrade the target wrapper,
  change business dependencies, or weaken TLS verification.
- Respect explicit Gradle Java configuration. Reject incompatible or unsupported explicit
  selections with an actionable message rather than silently overriding them. An incompatible
  inherited/default Java may be replaced with a compatible installed standalone JDK.
- Resolve before review, bind the selected Java and configuration identity into authorization,
  and reject changes before start. Task-cache fingerprints must include the effective runtime,
  rather than only the inherited JAVA_HOME string.

## Implementation plan

| Priority | Work | Acceptance |
| --- | --- | --- |
| P0 | Bounded Java inventory and wrapper compatibility selection; deterministic choice, explicit configuration and unsupported-version failure | JDK 25/Gradle 8.13 rejected; installed JDK 17 selected; fixtures cover version boundaries, config precedence and unsafe/missing paths |
| P0 | Integrate runtime with prepare/start, authorization identity, scoped child environment and cache fingerprint | All wrapper tasks use the reviewed Java; changed Java/config requires fresh review; unrelated task execution stays unchanged |
| P1 | Structured runtime decision and failure metadata, plus clear discovery errors | Logs identify wrapper version, Java major, selection reason and failure category without environment values or task-output bodies |
| P1 | Focused regression, real boostCleaner scan and native delivery | Required Rust/frontend checks, fresh signed package, exact installed binary, two icon-bookmark readiness receipts, 13,676-task scan through the installed task path |

## Verification and limits

Use controlled fixture roots for malformed, oversized and symlinked configuration, absent JDKs,
explicit overrides, runtime changes, cache invalidation, and task authorization. Keep subprocess
arguments structured. Unit tests must not depend on a particular machine's installed JDKs.

The compatibility table must be explicit and bounded: unknown future wrapper versions fail with
guidance rather than assuming support. Gradle daemon JVM criteria and command-line overrides must
either be honored or rejected explicitly; they must never bypass the selected runtime silently.
Preserve cancellation and the 2 MiB task-output cap. Report resource/performance observations and
platform limitations honestly; native delivery is verified on macOS, with portable selection tests
covering Windows/Linux path conventions where feasible.

## Implementation and acceptance

The root-wrapper native adapter now reads bounded wrapper/project/user properties, checks the
stable Gradle compatibility table (through 9.8), and selects a compatible installed Java. Explicit
command-line Java home wins over user properties, then project properties; a compatible inherited
JAVA_HOME is retained, otherwise installed modern Java is preferred deterministically. The native
child receives scoped JAVA_HOME and an exact daemon Java-home option. No global configuration,
plugin package, SDK or protocol changes were needed. Installed-JDK inventory is shared with
packaged analysis, without executing candidate tools.

The review and remembered-task authorization bind the runtime/configuration digest. Authorization
lookup and start re-resolve and reject changes. Root-wrapper task-cache fingerprints use the same
selected-runtime digest, so changing Java binaries/release metadata or relevant Gradle configuration
invalidates prior snapshots. Unrelated tasks retain their original behavior.

Output classification adds fixed Java/TLS/dependency/lock/storage/general-build descriptions to
terminal failures. Native events retain categories; frontend task surfaces remove diagnostic
prefixes while preserving actionable details. Inspection is capped at 2 MiB; retained stream tails
are detached 256-byte allocations. Output budgets, cancellation and task result semantics remain
unchanged.

Validation before native delivery: 189 native tests passed (3 pre-existing ignored), 1,411 script
tests passed, type check/build and strict native lib/test Clippy passed. The native suite covers
child JAVA_HOME, changed-JDK rejection and authorization identity, as well as existing cancellation
and output behavior. Selection tests cover config precedence, absent JDKs, version boundaries,
unsafe symlinks, size limits, stable/changing identities and context overrides.

The exact production TaskManager was exercised on unchanged boostCleaner with JAVA_HOME removed:
Gradle 8.13 selected JDK 17 (`compatible-installed`), prepared in 20 ms and finished successfully in
10.424 s, exit 0, zero stderr bytes and no truncation. The actual Android plugin parser accepted all
13,676 tasks. Receipts: `/tmp/asterlyn-gradle-runtime-production.log` and
`/tmp/asterlyn-gradle-runtime-parser.json`. The temporary local probe caller was removed afterward.

Known limits: this initial adapter explicitly rejects nonempty Gradle daemon JVM criteria,
project/settings/build context override flags, ambiguous property continuations/unicode escapes,
non-UTF-8/oversized configuration, prerelease/custom wrapper filenames and versions outside the
reviewed table. It does not silently ignore these inputs or provision tools. Java 8–16 still
requires a matching installed JDK for older wrappers. Portable selection tests run on the current
platform; Windows/Linux native process/package acceptance remains outstanding. Native package and
installed refresh receipts follow below.


### Signed installation and installed refresh

Fresh signed macOS application executable: 40,417,424 bytes, SHA-256
`27661dc6334ab6234c30acd5e1751447b57d2768dfe692ce8e6f1c81a6890b81`.
Strict bundle verification passed with `dev.asterlyn.desktop`, adhoc/runtime and sealed resources v2.
The native log/health probe (PID 34445, session `session-1793687444381-34445-0`) opened boostCleaner
and passed frontend readiness plus the exact existing Android 0.6.3/LSP 0.3.10 package checkpoints.
Two pre-existing `existing_project_directories` invalid-path errors remain outside this repair.
The visible native version marker and project shell were also inspected through accessibility.

Verified archive: `target/release/bundle/macos/Asterlyn-0.1.25-gradle-java-runtime-macos.app.zip`,
25,368,812 bytes, SHA-256
`eec594e8b7b35c36c6040d413bc98d5e4ee7838dac4647c7150a7a82914dd2f9`;
complete ZIP CRC passed. Canonical installer receipt:
`/tmp/asterlyn-gradle-runtime-install/installation.json`. The installed executable digest matches
and application-root device/inode remains `16777234/203606126`. Both saved-icon launches passed
frontend readiness; final reopen PID 35372, session `session-1793687520366-35372-0`.

In that installed boostCleaner session, an actual Tasks refresh was confirmed without enabling a
new remembered authorization. Native events 124/125 prepared Gradle 8.13 with JDK 17 in 1 ms;
131 recorded the selected runtime, 132 accepted the run, and 135 completed `run-2` successfully
in 9,746 ms, exit 0, 1,012,226 stdout bytes, zero stderr and zero omitted bytes. Plugin event 148
returned `ready`, 13,676 tasks, cache `ready`, no stale reason and no error. Accessibility confirmed
the restored task count and enabled controls; correctness is established from this log timeline,
not a screenshot. Receipt: `/tmp/asterlyn-gradle-runtime-installed-refresh.json`.

The no-JAVA_HOME production-manager probe above separately proves automatic selection when the
launch environment has no Java home; the icon-launched receipt retained a compatible inherited
JDK 17. Both paths are exercised rather than assuming identical launch environments. The original
JDK-25 failure and fixed no-JAVA_HOME case use the unchanged project. The project and Android plugin
Git worktrees remain clean. The user confirmed manual acceptance on 2026-11-03 and authorized sequential local commits.
No release, version bump or remote publication was requested.
