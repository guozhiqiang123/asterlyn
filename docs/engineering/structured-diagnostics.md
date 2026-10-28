# Structured diagnostics operations guide

Status: core implemented 2026-10-22; privacy, concurrent persistence and handled-error hardening implemented 2026-10-23.

## Location and retention

The native application resolves its platform log directory and stores files under `diagnostics/`.
On macOS the current development installation writes to:

```text
~/Library/Logs/dev.asterlyn.desktop/diagnostics/<sessionId>/asterlyn.jsonl
```

Each launch owns a `session-<epochMs>-<pid>-<nonce>` directory and lifetime owner lock.
`asterlyn.jsonl` is that session's active stream; `asterlyn.1.jsonl` through `asterlyn.5.jsonl`
are its archives. Rotation happens before a write would exceed 5 MiB. Concurrent launches never
rotate each other's files. Cleanup retains at most five inactive sessions within 30 MiB, while
leaving live sessions untouched (up to 30 MiB per active session). A registration lock prevents
cleanup racing with launch. Legacy `diagnostics/asterlyn*.jsonl` files remain readable and are
not rewritten or deleted by this migration. Unix session directories/files use 0700/0600.

Find a session by `processId` / `sessionId`, rather than assuming a shared active filename.
Session timestamps are creation times; file modification time changes as more events arrive.

## Event contract

Every line is an independent JSON object with:

- `schemaVersion`: currently `1`;
- `timestampEpochMs` (event creation), `sessionId`, `processId`, `buildId`, and a session-local
  monotonic `sequence` assigned in file-write order;
- `level`, `target`, and stable `event`;
- optional `traceId` for one activation/callback chain;
- `thread`; and
- `fields`, containing bounded event-specific metadata, and `fieldsTruncated` when preparation
  omitted metadata. Trace IDs are generated separately from output sequence numbers.

The plugin task path emits:

- `plugin.runtime.activation.started|completed|failed`;
- `plugin.runtime.callback.started|completed|failed`;
- `plugin.capability.request.started|completed|failed`; and
- `plugin.runtime.session.terminated`;
- `task.execution.prepare.started|completed|failed`;
- `task.execution.start.requested|accepted|failed`;
- `task.execution.run.status|completed`; and
- `task.execution.output.truncated` and `cancel.completed|failed`.

Process-query completion includes status, exit code, truncation, and base64 byte counts. Cache
events include status, fingerprint file count, payload size, and stale/dirty reasons. Callback
completion includes result size plus task count and cache state when the result is a task snapshot.
Task execution records the reviewed plugin/provider/task identifiers, run status, duration, exit
code, output event count, stdout/stderr byte totals, and omitted byte total. Output bodies and task
arguments are never copied to the diagnostic stream.

## Diagnosing a plugin task refresh

1. Note the timestamp immediately before reproducing.
2. Filter events at or after that time and find `plugin.runtime.callback.started` for the refresh
   plan, then `task.execution.prepare.started` for the Gradle discovery process.
3. Follow the task review ID into `task.execution.start.requested`; its trace covers the native
   process from acceptance through terminal status.
4. Confirm `task.execution.run.completed` reports `succeeded`, exit code 0, and a nonzero stdout
   byte count. A task timeout appears as `cancel.completed` followed by a cancelled terminal event.
5. Follow the later plugin callback trace that applies the task result.
6. Confirm `taskCache.computeFingerprint` and `taskCache.write` results.
7. Read `plugin.runtime.callback.completed.fields.result` for the final status, task count, cache
   status, and stale reason. If the callback fails, correlate `session.terminated` and its bounded
   runtime diagnostics metadata.

Example local inspection:

```sh
jq -c 'select(.target == "plugin.runtime" or .target == "plugin.capability" or .target == "task.execution")' \
  "$HOME/Library/Logs/dev.asterlyn.desktop/diagnostics"/session-*/asterlyn*.jsonl
```

## Privacy and support packets

The log excludes callback payload bodies, Gradle stdout/stderr bodies, file contents, environment
variables, and secrets. Workspace roots are hashed in operational events. Strings are bounded;
home-directory prefixes, sensitive object keys, case-insensitive common authentication headers,
URL user info and common credential query values are redacted. This is defense in depth, not a
promise to recognize every secret embedded in arbitrary free-form text. Frontend rejected objects
are summarized by type and a bounded code/kind; object bodies are never stringified. The app does not
upload logs.

Before sharing a support packet, select only the relevant time range and review it. Do not attach
task-cache files: they can contain task names and project structure and are separate from the
diagnostic stream.

## Verification gates

- Unit tests must prove JSON-line validity, secret redaction, trace restoration, and rotation order.
- Type checking must cover the frontend global-error bridge.
- Plugin-runtime integration evidence must show a single trace spanning process execution, parsing,
  cache handling, and the final callback result.
- Packaged-app acceptance uses the installed binary and the persisted log, without screenshot-based
  assertions.

## Persistence health and failure behavior

A dedicated thread owns disk I/O and file sequence numbers. Ordinary events may occupy 256 queue
slots; 64 additional slots are reserved for errors. When full, an error can evict an ordinary event.
Disk failure retains at most 64 prepared records, evicts the oldest on overflow, and retries every
250 ms even without new events. Queue/retry evictions and rejected late records increment `dropped`.
Metadata preparation limits strings to 4 KiB, nesting to 8, nodes to 256 and field bytes to 12 KiB,
followed by a final 32 KiB serialized event cap. JSON object overhead means the queue is bounded
by both record size and node count; it is not a promise that heap usage equals serialized size.

`diagnostic_log_health` returns `queued`, `retryBuffered`, `written`, `dropped`, `writeFailures`,
`recoveries`, `truncated`, and `persistenceAvailable`. `health.changed` records loss/recovery when
persistence is available again, and orderly shutdown requests a `health.snapshot`. A directory
path from `diagnostic_log_directory` identifies the preferred location, not its health. If the
platform directory cannot be resolved, that command returns an error and the logger is memory-only.
A body-free stderr notice marks a transition to unavailable persistence. A missing log file must
not be interpreted as proof that no business operation failed.

Each completed write is flushed to the OS, without fsync guarantees. Shutdown waits at most 500 ms;
panic waits at most 200 ms, and a writer-thread panic does not report back into itself. Abrupt
termination or persistent disk failure can lose buffered records. The bounded queue is intentionally
best effort: normal business calls never wait for disk I/O or durability acknowledgement.

## Correlation and lifecycle semantics

The transport adds optional `diagnosticTraceId` only to the four commands declared in
`protocol/desktop-protocol.v1.json`: plugin activation/callback and task prepare/start. The native
host validates its format and reuses it for native lifecycle events; callback capabilities and task
output aggregates inherit/capture the same ID. Existing callers that omit it continue to work.
The ID grants no authorization. Remote Git workers explicitly enter their operation's trace scope.

Frontend `command.failed` covers command/response-validation failures; `operation.handled_error`
covers errors delivered to the app's notification path. Both retain the original error's trace.
Context-menu failures have their own events. Selected plugin/task calls log frontend command
start/completion; other successful commands log completion only when they take at least one second.
No command arguments or return bodies are copied. Frontend reporting caps successful events at
100/second and allows errors up to 120 total/second. Cumulative `suppressed` and `bridgeFailures`
are carried by later reports; failures of the log bridge never recursively report themselves.
Frontend messages/stacks are bounded before IPC, and native ingress rejects oversized strings.

Plugin activation includes validation errors in its terminal event. Callback completion means all
returned subscription events have been published to the window; failed publication records failure.
An operation scope dropped before completion records `failed` with `outcome: abandoned`, rather
than claiming a particular timeout or cancellation reason.

When an isolated plugin helper closes its protocol pipe unexpectedly, the host makes a bounded,
non-destructive exit-status probe before terminating the process tree. The termination detail
records the original child exit code or signal when available, or explicitly says that the child
was still running/unavailable at observation time. A cleanup-generated force-stop status must not
be presented as the helper's original crash cause; the existing containment, timeout, and resource
limits remain unchanged.

Every record carries a build ID (revision, dirty/clean status and build stamp). `application.starting`
also includes package version and OS/architecture. `application.native_ready` means native window
creation succeeded; `application.frontend_ready` means frontend startup completed. During exit,
`application.shutdown_dispatched` means cleanup/cancellation requests were sent, not that all child
processes have terminated or the OS has completed process exit.

A Gradle refresh still spans multiple commands: follow review/run IDs between those commands.
This change correlates each frontend/native command and its worker events; it does not introduce
an implicit global trace that could mix concurrent user actions. Windows/Linux execution and slow
filesystem behavior require target-platform acceptance beyond the macOS evidence.
