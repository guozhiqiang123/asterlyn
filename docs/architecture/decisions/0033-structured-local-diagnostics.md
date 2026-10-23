# ADR-0033: Structured local diagnostics

Status: accepted; core implemented on 2026-10-22, privacy/persistence/lifecycle hardening on 2026-10-23.

## Context

Asterlyn spans a webview, a native host, supervised commands, and isolated plugin processes. A UI
notification identifies the final failure but does not show which boundary consumed the time or
rejected the data. Screenshots are also unsuitable as primary evidence because foreground state can
change while a diagnosis is running.

The plugin task-discovery incident exposed this gap. The same user-visible timeout could originate
in Gradle, process-output transport, the isolated JavaScript engine, cache persistence, or the
frontend projection. Increasing a global timeout would hide the responsible phase and weaken the
runtime containment policy.

## Decision

Asterlyn owns one logical local structured diagnostic stream. The native host writes newline-delimited JSON
events and is the authority for timestamps, sequence numbers, retention, redaction, and file
permissions. Frontend failures cross a narrow native command; plugins do not receive filesystem log
authority.

Every event carries a launch-scoped session ID, process ID, and session-local sequence. Each plugin
activation and callback receives a correlation ID. Native capability calls inherit that ID on the
executing thread, which produces one ordered timeline across callback dispatch, external
process execution, output sizing, cache operations, callback completion, and runtime termination.
Events record identifiers, status, duration, counts, byte sizes, and bounded error summaries. They
do not record source text, command output bodies, environment dumps, credentials, or callback
payload bodies.

Each launch owns `diagnostics/<sessionId>/asterlyn.jsonl` and an exclusive lifetime lock. It rotates
at 5 MiB and retains five prior files. A registration lock serializes new-session ownership with
cleanup; active sessions are never pruned. Up to five inactive sessions share a 30 MiB budget.
Each active process may additionally retain up to 30 MiB, and legacy shared files remain readable.
Directories use 0700 and files use 0600 on Unix. Windows owner locks use exclusive sharing.

Callers prepare bounded metadata and enqueue it without disk I/O. One background writer allocates
output sequence numbers, serializes writes and rotates files. The queue admits 256 ordinary events
and reserves 64 further slots for errors, with a 64-event retry buffer. Queue/retry loss is counted.
Directory/write/rotation failures never prevent application startup, are visible in diagnostic
health, retry every 250 ms, and produce a body-free stderr notice on a failure transition. Missing
platform log-directory resolution falls back to memory-only diagnostics.

The writer flushes each written event into the OS; this is not fsync/power-loss durability. Exit
requests a 500 ms drain and panic a 200 ms drain. Abrupt kills can lose queued records. Oversized
metadata is bounded by depth, node count and bytes before serialization, with a final 32 KiB event
cap. Secret object keys, case-insensitive common authorization/token forms and URL user info are
redacted. An unrecognized secret embedded in free-form text can still require manual review.

Frontend `error` and `unhandledrejection` events, startup failures, plugin lifecycle operations,
plugin capability operations, native task-process lifecycle events, and isolated-runtime
terminations, handled frontend errors and desktop command failures enter the same stream.
The frontend reporter is framework independent; only its adapter depends on Tauri. Rejected objects
are summarized by type/code rather than serialized. Plugin activation/callback and task prepare/start
commands accept optional transport diagnostic context, which joins frontend events to native work;
this ID grants no business authority. Task process output is represented only by byte counts,
truncation totals, status, and exit code. Panic events request a bounded drain before the prior panic hook runs. A writer-thread panic cannot
recursively enqueue or wait on itself.

## Boundaries

- Product and domain crates remain independent of Tauri and the concrete log writer.
- The native application layer owns persistence and redaction.
- The webview may submit only a bounded level, stable event name, message, and optional stack.
- Isolated plugins cannot choose a log path or append arbitrary records directly.
- Workspace identity is represented by a short SHA-256-derived hash in operational events.
- Full process stdout/stderr remains in its existing bounded result or runtime diagnostic buffer and
  is not copied into the persistent log.

## Consequences

Failures can be classified from a file without driving the UI. A support packet can include a
bounded time slice and correlate all relevant phases. The stream is intentionally local and is
never uploaded automatically. Additional subsystems should add stable event names and metadata
summaries at their application boundary instead of printing ad hoc text.

The initial coverage includes the plugin/task path and global frontend/native failures. Git, editor,
terminal, update, and workspace-mutation operations can adopt the same writer incrementally without
changing the schema or dependency direction.
