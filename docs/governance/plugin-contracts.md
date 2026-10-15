# Plugin contract registry and evolution policy

## Purpose

This registry keeps plugin contracts discoverable and reviewable as the ecosystem grows. It is an
index and lifecycle record, not a duplicate field specification: executable declarations in
`packages/plugin-sdk`, host protocol types, and their validators remain authoritative for exact
fields and limits.

Every new plugin-facing capability must enter this registry in the same change that introduces its
first public declaration. A feature is not a plugin contract merely because it is reusable inside
the host.

## Required entry fields

Every contract entry records:

- stable contract ID;
- provider and consumer ownership;
- stability state;
- compatibility/version axis;
- authoritative declarations and governing decision;
- resource and text bounds;
- validation, failure-isolation, and fallback behavior; and
- conformance tests and acceptance evidence.

## Current registry

| Contract ID | Owner / consumer | Stability | Version axis | Authoritative source and policy |
| --- | --- | --- | --- | --- |
| `plugin.package-manifest` | plugin declares; host admits | stable | package manifest schema `1` | `SdkPluginPackageManifest`; ADR-0023; identity parity tests |
| `plugin.localization` | plugin supplies text; host validates/resolves/renders | stable | Plugin SDK `1.1` additive contract | `SdkPluginLocalization`, `SDK_PLUGIN_LOCALIZATION_LIMITS`; ADR-0023 |
| `plugin.settings` | plugin declares; host persists/renders | stable | Plugin SDK major `1` | `SdkSettingDescriptor`; host settings adapter and value validation |
| `plugin.commands` | plugin declares/handles; host discovers/routes | stable-first-party | Plugin SDK major `1` | `SdkPluginCommandContribution`; contribution registry bounds |
| `plugin.hierarchical-collection` | plugin supplies semantics; host renders/interacts | stable-first-party | Plugin SDK major `1` | `SdkHierarchicalCollection`, `SDK_COLLECTION_LIMITS`; ADR-0022 |
| `plugin.tasks` | plugin supplies snapshots/plans; host discovers/reviews/executes | stable-first-party | Plugin SDK major `1` plus host task protocols | task SDK declarations; ADR-0019 through ADR-0023 |
| `plugin.task-authorization` | plugin declares policy/copy; host persists/enforces/renders | stable-first-party | capability protocol `1`; additive Plugin SDK minor | ADR-0025; native authorization store and task-review fixtures; [acceptance](../benchmarks/2026-10-15-plugin-task-authorization.md) |
| `plugin.task-cache` | plugin requests; host fingerprints/stores/invalidates | stable-first-party | task-cache protocol `1` | task-cache SDK/protocol declarations; ADR-0020 |
| `host.presentation` | host supplies; features consume | experimental-host | host-private contract `1` | ADR-0024; `src/presentation/host-presentation.ts`; `scripts/host-presentation.test.mjs`; [acceptance](../benchmarks/2026-10-15-host-presentation-system.md); not yet a public plugin capability |
| `host.task-terminal-session` | task execution supplies; Terminal and shell layout consume | experimental-host | host-private contract `1` | ADR-0026; ordered reviewed-task session projection; not a Plugin SDK capability and never an executable shell-string channel |
| `host.notifications` | host features publish; host queue/presentation renders | experimental-host | host-private contract `1` | ADR-0027; typed severity, bounded queue, deduplication, deterministic dismissal, and window-scoped disposal; [acceptance](../benchmarks/2026-10-15-host-notification-and-plugin-feedback.md) |
| `plugin.notifications` | plugin requests by localization key; host validates/resolves/publishes | experimental-first-party | additive Plugin SDK `1.3`; optional activation capability | ADR-0027; semantic severity and admitted localization key only; no DOM, styling, duration, actions, history, or observation authority; [acceptance](../benchmarks/2026-10-15-host-notification-and-plugin-feedback.md) |

`stable-first-party` means the contract is exercised across the independent Android/Gradle
repository boundary but is not authorization for dynamic third-party loading. External admission
continues to depend on the PPF5–PPF8 security gates in the public plugin foundation plan.

## Version axes

The following versions solve different compatibility problems and must not be collapsed:

- **Plugin SDK semantic version:** developer-facing source compatibility and published declarations.
- **Plugin SDK major handshake:** earliest fail-closed executable-module compatibility check.
- **Package manifest schema:** static, pre-execution package inspection and admission.
- **Capability/protocol version:** request/result compatibility for one host-owned authority.
- **Persisted-data schema:** migration, downgrade, retention, and recovery of host-owned data.
- **Host presentation contract:** internal semantic component evolution; it becomes public only after
  a separate plugin schema and adapter are accepted.

## Change classification

| Change | Required treatment |
| --- | --- |
| Optional field with a deterministic old-host fallback | additive SDK minor or compatible capability revision |
| New enum value an old consumer may receive | compatibility review; add an `unknown` fallback or version the contract |
| Required field, changed meaning, renamed stable ID, or reordered security action | new major/schema/capability version |
| Tighter count, text, time, or memory bound | compatibility change with migration and rejection evidence |
| New permission or broader filesystem/process/network/UI authority | new named capability and security review |
| Removal | deprecation window, diagnostics, migration guide, oldest-host fixture update, then major removal |

## Lifecycle

1. **Proposal:** ADR identifies ownership, threat boundary, version axis, limits, fallback, and
   rejection behavior.
2. **Experimental:** declarations and validators land with fixtures; production plugins cannot rely
   on long-term compatibility unless explicitly pinned.
3. **Stable:** at least one independent plugin integration and current/oldest-host fixtures pass;
   documentation, diagnostics, and rollback behavior are complete.
4. **Deprecated:** hosts continue accepting the old form with bounded diagnostics while a migration
   path and removal release are named.
5. **Removed:** only at the declared incompatible boundary; stale packages fail admission without
   executing plugin code.

## Presentation-specific rules

- Plugins provide localization keys and plain data, never rendered strings containing markup.
- Plugin notifications provide a localization key and semantic severity only. The host owns source
  attribution, resolution, queueing, visual treatment, timing, accessibility, and dismissal.
- Action intent is semantic (`recommended`, `neutral`, `destructive`, or `quiet`), not a color or CSS
  class. The host permits at most one recommended action in a state or dialog action group.
- Host security dialogs do not accept plugin-provided action layout, labels, callbacks, or styling.
- A declarative panel state must distinguish blocking/centered presentation from an inline notice
  that preserves usable content.
- Future search and panel-opening contracts receive their own stable IDs, capabilities, limits, and
  action results. They are not added as untyped callbacks to `host.presentation`.
- Unknown component/state/action kinds fail closed at the adapter and produce one bounded plugin
  diagnostic; they cannot blank another plugin or core surface.

## Review checklist

- Is the contract actually needed across a plugin boundary, or is it still a host primitive?
- Are owner, authority, and dependency direction explicit?
- Can the package be inspected and rejected without executing plugin code where applicable?
- Are identities stable and values bounded, escaped, cloned, and frozen at admission?
- Does denial or partial availability leave unrelated contributions usable?
- Do oldest-supported and current-host fixtures cover additive and rejected forms?
- Are localization, keyboard/focus, accessibility, theme, performance, memory, diagnostics, and
  rollback evidence recorded?
