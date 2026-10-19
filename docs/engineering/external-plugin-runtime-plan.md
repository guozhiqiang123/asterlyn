# External plugin runtime implementation plan

## Outcome

Turn an admitted schema-2 plugin package from inert `pendingRuntime` bytes into an isolated,
supervised plugin process without granting JavaScript ambient desktop authority. The host remains
the only owner of filesystem, process, network, credentials, workspace state, terminal, task, and
presentation capabilities. A plugin can only request a named operation already admitted from its
manifest and re-authorized for the current workspace.

This plan is the executable MKT5 detail for the
[`GitHub Release plugin marketplace plan`](github-release-plugin-marketplace-plan.md) and follows
[`ADR-0032`](../architecture/decisions/0032-decentralized-github-release-plugin-marketplace.md).
It does not enable install/update/restart UI ahead of MKT6/MKT7 recovery guarantees.

## Frozen runtime boundary

- Runtime protocol: `1`.
- Transport: one child process per active external plugin, with stdin/stdout reserved for framed
  protocol traffic and bounded stderr reserved for host-owned diagnostics.
- Frame: four-byte unsigned big-endian JSON byte length followed by exactly that many UTF-8 bytes.
- Maximum frame: 1 MiB. Zero-length, truncated, oversized, invalid UTF-8, unknown message, unknown
  field, and wrong-protocol frames terminate the session.
- JavaScript engine: embedded non-Node ECMAScript runtime. The first implementation pins Boa
  `0.21.1`, the newest Boa line compatible with the workspace Rust 1.88 baseline. An engine upgrade
  is a reviewed runtime-compatibility change, not an incidental dependency update.
- Runtime entry: the immutable, digest-verified package file declared by `distribution.runtime`.
- Ambient globals: no Node APIs, `fetch`, WebSocket, DOM, Tauri bridge, shell, environment, host
  filesystem, or credential API. Required language primitives and explicitly documented safe
  codecs may be supplied by the runtime.
- Authority: every capability request carries the active plugin identity and workspace identity;
  the supervisor checks the admitted manifest permission, active workspace generation, operation
  schema, and current user/workspace policy before dispatch.
- Registration: activation contributions are validated as one transaction. One invalid or
  duplicate contribution rejects the entire activation and publishes none of it.
- Lifecycle: disable, workspace replacement, window exit, application exit, protocol violation,
  crash, startup timeout, request timeout, idle timeout, or output overflow cancels pending calls
  and terminates the complete child process tree.

## Protocol state machine

```text
spawned
  -> hello (runtime identity + package digest)
  -> helloAck (host session identity + admitted capability set)
  -> activate (bounded workspace/presentation context)
  -> activationReady (transactional contributions + callback handles)
  -> active
       <-> invoke/result/error
       <-> capabilityRequest/capabilityResponse
       <-> event
       -> cancel
  -> shutdown
  -> shutdownAck
  -> exited
```

Any message that is invalid for the current state is a protocol violation. Request and callback
identifiers are opaque, bounded, session-local strings; they are never JavaScript source or host
object references. Diagnostics are severity-tagged, size-limited data and are rendered only by the
host. Plugin markup is never accepted.

## Resource limits

The protocol crate owns byte/count/string bounds so the child and parent reject the same input.
The process supervisor additionally owns platform enforcement and wall-clock policy.

| Resource | Initial limit |
| --- | ---: |
| protocol frame | 1 MiB |
| identifier | 128 UTF-8 bytes |
| diagnostic message | 4 KiB |
| contributions per activation | 64 |
| callbacks per contribution | 32 |
| in-flight calls per plugin | 64 |
| activation wall time | 10 seconds |
| ordinary request wall time | 30 seconds |
| shutdown grace | 2 seconds |
| captured stderr per session | 256 KiB |
| JavaScript loop iterations per turn | 5,000,000 |
| JavaScript recursion depth | 256 |
| JavaScript stack budget | 512 KiB |

Memory/CPU/process-tree enforcement must use platform-native supervision where available. An
engine loop limit is defense in depth, not a substitute for the parent deadline and child kill.

## Delivery stages and commit boundaries

### EPR1 — Runtime protocol and hostile framing fixtures

Status: implemented on 2026-10-19. The shared crate owns protocol-1 message types, strict
length-prefixed framing, identity and contribution validation, and hostile framing fixtures. It is
kept independent from Tauri and the JavaScript engine.

1. Add a dependency-light native protocol crate with protocol-1 messages, shared limits,
   length-prefixed framing, identity validation, activation transaction validation, and explicit
   protocol errors.
2. Cover truncated/oversized/zero/unknown/wrong-version frames, invalid identities, duplicate
   contribution/callback handles, excessive counts, and clean shutdown round trips.
3. Keep the crate independent from Tauri and the JavaScript engine so both sides share it.

Exit gate: arbitrary pipe bytes cannot cause unbounded allocation or produce an accepted ambiguous
message.

### EPR2 — Embedded JavaScript plugin-host executable

1. Add `asterlyn-plugin-host` as a separately packaged executable using the shared protocol crate.
2. Load only the admitted immutable entry file, parse it as an ECMAScript module, and validate its
   exported plugin identity before activation.
3. Expose a frozen capability proxy instead of ambient APIs; convert plugin callbacks and
   subscriptions into opaque handles.
4. Apply runtime limits, bounded job draining, deterministic error normalization, and graceful
   shutdown.
5. Add fixtures proving absence of Node/filesystem/network/DOM/Tauri authority, startup timeout,
   infinite-loop interruption, malformed export rejection, and callback/capability round trips.

Exit gate: a fixture plugin activates and serves callbacks solely through protocol 1, while hostile
fixtures fail without changing host or workspace state.

### EPR3 — Host supervisor and transactional contribution adapter

1. Resolve the packaged helper without accepting a renderer/plugin path; spawn it with piped
   protocol handles and no secrets in arguments or environment.
2. Bind the child to the admitted plugin/version/digest and current workspace generation.
3. Re-authorize each typed capability call against the manifest and current host policy.
4. Stage contributions in the existing plugin registry and publish only after complete activation;
   dispose them together on failure or lifecycle stop.
5. Add crash/backpressure/deadline/cancellation/process-tree/application-exit tests and bounded
   diagnostic projection.

Exit gate: one plugin crash cannot blank core UI, Settings, or another plugin, and no descendant
process survives its owner.

### EPR4 — First-party Android parity

1. Activate the admitted Android Release package through the external runtime without a bundled
   source import.
2. Map its declared task, execution-target, run-configuration, workspace-state, cache, process,
   terminal/tool, and notification calls onto the typed host capability handlers.
3. Compare detection, Tasks tree, device discovery, Run, terminal lifecycle, settings/deep link,
   localization, cache invalidation, and shutdown behavior with the bundled baseline.
4. Keep an explicit bundled fallback until MKT7 healthy-start promotion and rollback are complete.

Exit gate: the Android package reaches functional parity through the child process, and disabling
or replacing the workspace removes every contribution, subscription, request, and process.

## Packaging and release gates

- Desktop packaging must build the helper for the exact target triple and include it through the
  native bundle configuration; development must not silently fall back to a globally installed
  executable.
- Host startup verifies that the resolved helper is inside the installed application, is a regular
  file, and matches the version/protocol expected by the host build.
- CI exercises the helper handshake and shutdown from packaged macOS, Windows, and Linux artifacts.
- Marketplace install remains labelled `pending runtime` until EPR3 exists. External enablement and
  automatic selection remain unavailable until EPR4 plus MKT7 recovery evidence exists.

## Required acceptance evidence

- Protocol unit and pipe fuzz fixtures with peak allocation bounded by the frame limit.
- Engine fixtures for self-contained ESM, async jobs, missing/invalid export, infinite loops, thrown
  values, and forbidden globals.
- Supervisor fixtures for crash, timeout, cancellation, stderr flood, protocol flood, child-tree
  cleanup, workspace replacement, disable, and application exit.
- Android Release parity against one small Gradle workspace and the existing large multi-module
  workspace.
- Packaged helper resolution and handshake on all supported desktop targets.
- Steady-state child memory/CPU and activation/request latency recorded in a dated benchmark page.

## Explicitly deferred

MKT5 does not by itself provide Marketplace/Installed redesign, automatic restart, healthy-start
promotion, rollback, uninstall, repository signing, remote plugin workers, or a stable binary ABI.
Those remain owned by MKT6–MKT8. Protocol 1 is JSON and capability-oriented so its transport or
engine can evolve without exposing host implementation objects to plugins.
