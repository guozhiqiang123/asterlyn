# ADR-0024: Host presentation contract and plugin contract governance

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

ADR-0022 established host-owned hierarchical collection behavior and ADR-0023 established a
host-governed public plugin foundation. The Android/Gradle integration now exposes the next repeated
boundary: host tokens and shared CSS exist, but Tasks cache states and task-execution review can
bypass the shared button, dialog, empty-state, focus, and accessibility conventions. A third-party
plugin API built on CSS class names or plugin-owned markup would freeze those inconsistencies and
give untrusted code presentation authority.

The plugin SDK already contains several independently evolving contracts: package identity,
localization, settings, commands, task providers, task execution, task cache, and hierarchical
collections. Search, tool-panel invocation, notifications, and other capabilities may follow. One
monolithic SDK version or an unstructured collection of ADRs is insufficient to show ownership,
stability, compatibility, limits, fallback behavior, and conformance evidence for each contract.

## Decision

Asterlyn will maintain one host presentation system and one plugin contract registry.

The presentation system has three layers:

1. semantic design tokens owned by the host;
2. host-rendered primitives and interaction patterns; and
3. bounded declarative plugin presentation contracts that map into those primitives.

Plugins describe meaning, never styling implementation. An action may be recommended, neutral,
destructive, or quiet; a state may be loading, empty, stale, error, or permission-required. The host
chooses color, typography, spacing, iconography, focus, keyboard behavior, accessibility roles,
theme adaptation, density, and disabled presentation. Plugin contracts cannot contain HTML, CSS,
selectors, host class names, scripts, DOM callbacks, or component imports.

The first shared host patterns are:

- action buttons with semantic intent;
- centered panel states for content-blocking loading, empty, stale, and error outcomes;
- inline notices for degraded states that retain usable content;
- application dialogs with one title hierarchy and one action area; and
- existing host-owned hierarchical collections and form controls.

Security and authorization surfaces remain entirely host-owned. In particular, a plugin may submit
a task execution plan but cannot provide, reorder, relabel, style, or handle the execution-review
dialog. Generic trust, permission, cancellation, execution, and lifecycle copy also remains owned by
the host.

## State presentation rules

State presentation depends on whether usable content remains:

| Condition | Host presentation |
| --- | --- |
| Loading or error with no usable content | centered panel state |
| Stale cache with no visible retained content | centered stale panel state with a primary refresh action |
| Validating, stale, or refresh failure with retained content | inline notice followed by the retained content |
| Successful ready state | ordinary content with optional low-emphasis count/status |

Copy must not claim that retained content is visible when the current projection contains none.
Filtering and plugin-selected projections therefore participate in this decision; cached provider
entries alone are not proof that a user-visible list exists.

## Plugin presentation boundary

Host primitives are not automatically public SDK components. A primitive becomes plugin-facing only
after a catalogued contract defines:

- a stable contract ID and owner;
- a separate schema or capability version when wire compatibility requires one;
- bounded plain-data fields and localization-key ownership;
- action dispatch through an authorized host capability;
- validation, failure isolation, fallback, and resource limits; and
- fixtures against the oldest supported and current hosts.

Until that gate is met, plugins continue contributing to known host surfaces such as Settings,
Tasks, commands, and hierarchical collections. Arbitrary plugin panels and dialogs remain
unsupported. A future custom surface requires a separately approved isolation and threat model; it
cannot reuse the main WebView DOM as an implicit extension API.

## Contract governance

[`Plugin contract registry and evolution policy`](../../governance/plugin-contracts.md) is the
navigation and lifecycle source for every plugin-facing contract. Executable TypeScript and protocol
declarations remain the field-level source of truth. Each catalog entry records ownership,
stability, version axis, source location, bounds, fallback/isolation policy, and conformance evidence.

Contracts progress through `experimental`, `stable`, `deprecated`, and `removed`. Additive optional
fields may use a compatible SDK minor or capability revision only when an older host has a safe
default. Semantic changes, newly required fields, weaker security assumptions, or changed action
meaning require a new major/schema/capability version. Bound tightening is a compatibility change
and requires migration evidence rather than being treated as a CSS or validation cleanup.

Plugin SDK package version, static manifest schema, individual capability protocol versions,
persisted-data schemas, and host-private presentation implementation versions remain separate. No
single global version is incremented to hide an incompatible change in one contract.

## Dependency direction

```text
plugin declarative data
        |
        v
host SDK adapter + validation + authorization
        |
        v
semantic host presentation model
        |
        v
host renderer/runtime -> tokens, focus, keyboard, accessibility, theme
```

The plugin SDK has no dependency on the host, DOM, Tauri, or a concrete UI framework. Host
presentation modules cannot import plugin implementations or business-specific controllers.
Features adapt their own state into business-neutral presentation models and translate semantic
action IDs back into feature commands.

## Consequences

- Host and plugin UI converge through reusable semantics instead of copied class lists.
- Third-party plugins can eventually look native without controlling host markup or security UI.
- Accessibility, theme, and interaction fixes apply at one host boundary.
- The contract registry adds review work, but makes compatibility and ownership visible before the
  number of capabilities grows.
- Existing feature-specific markup migrates incrementally; this decision does not require an
  all-at-once rewrite or a frontend framework change.

## Alternatives rejected

- **Publish host CSS classes as the plugin API:** rejected because class names and DOM structure are
  implementation details with no safe compatibility, authorization, or accessibility boundary.
- **Let plugins render arbitrary HTML dialogs or panels:** rejected because this bypasses host
  theming, focus, bounds, lifecycle, permissions, and failure isolation.
- **Use one SDK version for every contract:** rejected because package, capability, persistence, and
  presentation compatibility evolve independently.
- **Create a generic component framework before proven consumers:** rejected because host
  primitives must be extracted from repeated product behavior and remain small and testable.

## Revisit triggers

Revisit when a second plugin needs a presentation state that cannot be expressed by the catalogued
semantics, when a justified custom surface has an approved isolation model, or when a contract
cannot evolve under its current independent version axis without coordinated ecosystem breakage.
