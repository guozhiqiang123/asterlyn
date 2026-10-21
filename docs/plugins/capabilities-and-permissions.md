# Plugin capabilities and permissions

Status: experimental public catalog rooted at Asterlyn `0.1.17`; current SDK `1.10.0`, package schema `3`, and
plugin-host protocol `1`.

Security containment in `0.1.17`: installable packages cannot receive authority from legacy raw
`processQueries` or `toolOperations` executable/argv declarations. Every schema-2 authority package
is rejected, including the formerly pinned Android `0.5.7` identity. Plugin authors declare only
`hostOperations`; the host expands each admitted ID into a fixed operation owned by the registered
plugin repository.

## Two declarations, one authority check

A capability names a host-owned interface or contribution family. A permission names the authority
the package asks the host to exercise. Declaring one does not imply the other. Unknown capability
or permission IDs fail package admission, and a runtime request without its admitted permission
fails with `capability.permission-denied`.

The host may also deny an admitted request because the workspace is stale, an executable or artifact
cannot be resolved, arguments are invalid, the operation is unavailable, a trust/review gate is not
satisfied, or a resource limit is reached. Denial is scoped to that request; unrelated healthy
contributions remain available.

## Supported capabilities

| Capability ID | Plugin-facing use | Required permission(s) | Boundary |
| --- | --- | --- | --- |
| `workspaceCatalog` | Receive bounded workspace evidence for matching and discovery | `host.workspace.catalog.read` | Read-only host snapshot; no path handle or arbitrary file read |
| `tasks` | Contribute task snapshots, hierarchy, refresh and reviewed run plans | `host.tasks.discover`; `host.tasks.execute` only when executing | Host owns trust, terminal, cancellation, output, artifacts and task state |
| `taskAuthorization` | Supply localization keys for host-rendered workspace trust and exact-task memory | `host.tasks.execute` for the eventual run | Declarative policy/copy only; it cannot self-approve a task |
| `taskCache` | Fingerprint, read, write and dirty a plugin/provider task cache | `host.tasks.cache` | Current workspace and plugin namespace only |
| `processQueries` | Runtime transport for admitted host-owned queries | `host.process.query` | Executable/argv declarations are blocked; only schema-3 `hostOperations` can populate this capability |
| `toolOperations` | Runtime transport for admitted host-owned typed operations | `host.tool.execute` | Command construction stays in the repository-bound host registry |
| `workspaceState` | Read/write bounded non-secret plugin state for the current workspace | `host.workspace.state` | Plugin/workspace namespace only; no repository file write |
| `executionTargets` | Contribute transient execution targets such as attached devices | `host.execution-targets.read` | Bounded metadata; target validity is rechecked before use |
| `runConfigurations` | Contribute configuration metadata and staged run plans | No additional metadata permission; each task/tool phase needs its own admitted permission | The host never guesses an ambiguous configuration or target |
| `notifications` | Publish semantic info/success/warning/error by localization key | `host.notifications.publish` | Host owns resolved text, source attribution, timing, accessibility and dismissal |

SDK `1.10.0` retains legacy candidate types only so migration tooling can diagnose old source. The
schema-3 package manifest forbids those fields, no bundled code executes in the WebView, and runtime
authority is granted only through semantic IDs.

Capabilities not listed here are not available to installable packages. Host presentation primitives,
dialogs, arbitrary panels, search internals, Git writes, credentials, terminals, sockets, WebViews,
and raw filesystem/process/network APIs are not implicit capabilities.

## Supported permissions

| Permission ID | Authority admitted | Does not grant |
| --- | --- | --- |
| `host.workspace.catalog.read` | Bounded host-produced workspace catalog evidence | Arbitrary file reads, watches, writes, or paths outside the active workspace |
| `host.tasks.discover` | Publish task metadata and hierarchy | Task execution or shell access |
| `host.tasks.execute` | Submit an exact reviewed task plan to the host lifecycle | Silent trust, unrestricted argv, PTY ownership, or execution after workspace change |
| `host.tasks.cache` | Use bounded plugin/provider cache storage and fingerprints | General storage or another plugin's cache |
| `host.process.query` | Request an admitted host-owned query ID declared through `hostOperations` | Package-selected executable, argv, environment, stdin, process handle, or mutation intent |
| `host.tool.execute` | Request an admitted host-owned typed operation ID declared through `hostOperations` | Package-selected command construction, shell interpolation, or unreviewed workspace mutation |
| `host.workspace.state` | Store bounded non-secret strings under plugin/workspace keys | Credentials, global state, repository files, or cross-plugin access |
| `host.execution-targets.read` | Discover and describe bounded transient targets | Device mutation by itself; install/launch still requires admitted tool operations |
| `host.notifications.publish` | Request one host-rendered localized notification | HTML, actions, custom duration, styling, notification history, or observation |

## Runtime methods

Protocol `1` exposes only these direct capability operations:

| Capability | Operations |
| --- | --- |
| `taskCache` | `computeFingerprint`, `read`, `write`, `markDirty` |
| `processQueries` | `execute` |
| `workspaceState` | `read`, `write` |
| `notifications` | `publish` |

All other plugin behavior crosses validated contribution callbacks. A plugin never receives the
native implementation object behind a capability.

## Static query and operation rules

The inspector still parses and bounds schema-2 legacy process-query/tool-operation declarations so
old packages fail with a controlled migration diagnostic. Marketplace admission and activation
reject schema-2 authority packages without an exception. Schema-3 packages expose only versioned
semantic operation IDs and narrow typed values; unknown IDs or an unregistered repository/identity
pair fail before activation.

## Public resource limits

| Area | Current bound |
| --- | --- |
| Downloaded package | 64 MiB |
| Archive | 2,048 entries; 128 MiB expanded; 32 MiB per file |
| Manifest | 1 MiB |
| Runtime protocol | 1 MiB frame; 128-byte identifier; 4 KiB diagnostic; 64 contributions |
| Runtime turn | 64 capability requests and 64 events |
| Localization | 16 locales; 512 messages/locale; 4,096 characters/value; 262,144 total characters |
| Notifications | 128-character key; 512-character resolved message |
| Process queries | 32 declarations; 64 arguments; 60-second timeout; 1 MiB output |
| Tool operations | 32 declarations; 16 parameters; 64 arguments; 300-second timeout; 1 MiB output |
| Task collection | 32,768 nodes; depth 64; 16 metadata entries/node |
| Targets/configurations | 256 entries/provider; 32 metadata entries/item |
| Task cache | 4,096 fingerprint files/64 MiB; 16 MiB entry; 32 entries/128 MiB total |
| Workspace state | 128 keys; 128-byte key; 16 KiB value; 256 KiB file |

Exact field-level bounds are exported as `SDK_*_LIMITS` from `@asterlyn/plugin-sdk`; native package,
runtime, cache, and workspace-state limits remain authoritative in the host. A tighter bound is a
compatibility/security change and requires migration and rejection evidence.

## Failure behavior

- Unknown package declarations: reject before extraction or execution.
- Missing permission: reject the request with a bounded non-retryable failure.
- Stale workspace/generation: cancel or reject and discard late results.
- Invalid result or contribution: reject the activation transaction or the offending callback.
- Runtime crash/timeout/protocol violation: terminate the plugin process and revoke contributions.
- Repeated unhealthy start after update: quarantine the new digest and select known-good rollback.
- Disable/uninstall/app exit: cancel work, dispose contributions, and terminate the process tree.

Do not catch a capability denial and silently replace it with broader behavior. Surface bounded,
localized diagnostics and leave unrelated features usable.
