# ADR-0033: Structured local diagnostics

Status: accepted; core infrastructure and plugin/task execution coverage implemented on 2026-10-22.

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

Asterlyn owns one local structured diagnostic stream. The native host writes newline-delimited JSON
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

The active file is `asterlyn.jsonl`. It rotates at 5 MiB, retains five prior files, uses owner-only
permissions on Unix, and flushes every event so crash evidence is durable. Oversized events are
replaced with a bounded `diagnostics.event_truncated` record. Home-directory prefixes and common
authorization/token forms are redacted before serialization.

Frontend `error` and `unhandledrejection` events, startup failures, plugin lifecycle operations,
plugin capability operations, native task-process lifecycle events, and isolated-runtime
terminations enter the same stream. Task process output is represented only by byte counts,
truncation totals, status, and exit code. Panic events are recorded before the prior panic hook runs.

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
