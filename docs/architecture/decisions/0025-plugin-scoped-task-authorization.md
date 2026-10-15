# ADR-0025: Plugin-scoped task authorization and remembered review

Date: 2026-10-15

Status: accepted

## Context

Task execution currently has two deliberately separate user decisions:

1. whether a workspace may execute tasks at all; and
2. whether one prepared task invocation may start.

The native host already persists the first decision by canonical workspace path, but the record is
host-global and cannot be managed from the owning plugin's Settings entry. The second decision is
always transient, so routine Gradle discovery and a repeatedly used exact task require the same
review on every invocation.

Moving either security decision into ordinary browser preferences would make the user experience
more convenient but would weaken the native execution boundary. Hard-coding Android/Gradle IDs,
labels, or state in the host would also violate the plugin ownership established by ADR-0023.

## Decision

Introduce the independently versioned `plugin.task-authorization` contract.

### Plugin declaration

A plugin may declare a bounded task-authorization descriptor in its package manifest:

- a workspace-trust Settings entry ID, label key, and optional description key; and
- an optional remembered-task-confirmation label and description.

The plugin owns these identifiers and localized messages. The host validates the declaration and
renders all controls. A declaration does not grant authority and cannot supply markup, callbacks,
storage paths, default trust, or an executable command.

### Native authorization state

The host persists authorization in its protected application-data directory, but every value is
namespaced by the canonical workspace and stable plugin ID. This is plugin-owned state hosted by a
generic capability, not an Android/Gradle field in host preferences.

Workspace trust has three fail-closed states: `unknown`, `trusted`, and `denied`. The plugin Settings
switch is on only for `trusted`; turning it off writes `denied`, cancels any active task in that
workspace, and removes remembered task confirmations for that plugin and workspace.

The previous path-only trust store remains a read-only compatibility fallback. The first explicit
plugin-scoped decision overrides it. This preserves existing user trust without making new plugin
records path-global.

### Remembered task review

Remembering a task is explicit. A trusted review may show a plugin-localized “do not ask again”
checkbox. It is unchecked by default. Confirming with it checked stores a bounded native grant for:

- canonical workspace;
- plugin ID;
- provider ID;
- exact task ID; and
- a native fingerprint of the canonical executable, executable content identity, arguments, and
  working directory.

A future invocation still goes through native preparation. It may skip the visible confirmation
only when workspace trust remains `trusted`, the plugin still declares this capability, the
remembered grant matches the newly prepared native fingerprint, and the review remains current.
Executable, argument, provider, task, workspace, or plugin changes fail closed and show review
again. Revoking workspace trust clears all grants in that plugin/workspace scope.

### Boundary and lifecycle

- Plugins contribute policy and text; the host owns persistence, Settings controls, review UI,
  fingerprinting, cancellation, and process execution.
- Plugin code never receives the authorization store or a method that starts an unreviewed process.
- Workspace trust and task-review memory are not ordinary `plugin.settings` values and are never
  synchronized as browser-local global preferences.
- Store sizes, identifier lengths, and grant counts are bounded. Corruption, unsupported versions,
  unknown plugins, stale reviews, and unavailable storage fail closed.
- `plugin.task-authorization` has its own capability version and acceptance fixtures; it is not
  hidden inside the presentation or task-cache contracts.

## Consequences

Routine Gradle discovery and repeated exact tasks can become one-click flows after explicit consent,
while a changed wrapper or command cannot silently inherit an old approval. Plugin Settings becomes
the durable place to inspect and revoke the current workspace's trust.

The host must coordinate an asynchronous native authorization snapshot with the synchronous plugin
management view. External plugins remain deferred: this contract defines declarative ownership and
host enforcement but does not authorize dynamic code loading or direct IPC access.

## Rejected alternatives

- **Store trust in ordinary plugin preferences.** Browser storage is not the native process
  execution boundary and current preferences are global rather than workspace-scoped.
- **Automatically remember every confirmed task.** Confirmation would silently create durable
  authority; the explicit unchecked checkbox is safer and reversible.
- **Remember only the task ID.** A plugin or build change could reuse the ID with a different
  executable or arguments.
- **Let the plugin render its own switch or dialog.** This would bypass host accessibility,
  presentation, validation, and security-action ordering.
- **Keep path-global workspace trust.** One plugin's decision would implicitly authorize every task
  plugin in the same project.
