# Structured diagnostics operations guide

Status: core infrastructure and the plugin/task execution path implemented on 2026-10-22.

## Location and retention

The native application resolves its platform log directory and stores files under `diagnostics/`.
On macOS the current development installation writes to:

```text
~/Library/Logs/dev.asterlyn.desktop/diagnostics/asterlyn.jsonl
```

`asterlyn.jsonl` is the active stream. Files `asterlyn.1.jsonl` through
`asterlyn.5.jsonl` are previous generations. Rotation happens before a write would exceed 5 MiB.

## Event contract

Every line is an independent JSON object with:

- `schemaVersion`: currently `1`;
- `timestampEpochMs`, `sessionId`, `processId`, and a session-local monotonic `sequence`;
- `level`, `target`, and stable `event`;
- optional `traceId` for one activation/callback chain;
- `thread`; and
- `fields`, containing bounded event-specific metadata.

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
  "$HOME/Library/Logs/dev.asterlyn.desktop/diagnostics/asterlyn.jsonl"
```

## Privacy and support packets

The log excludes callback payload bodies, Gradle stdout/stderr bodies, file contents, environment
variables, and secrets. Workspace roots are hashed in operational events. Strings are bounded;
home-directory prefixes and common bearer/authorization/token forms are redacted. The app does not
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
