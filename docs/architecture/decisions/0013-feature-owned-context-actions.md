# ADR-0013: Feature-owned context actions with a shared window menu host

- **Status:** Accepted for the context-action and R5 foundation
- **Date:** 2026-09-15

## Context

Asterlyn needs contextual actions in Files, Changes, Branches, History, and commit details. The
reviewed behavior draft contains repeated presentation requirements—one open menu per window,
keyboard navigation, submenus, blocked-action explanations, edge placement, focus restoration, and
localized styling—but each surface has different target identities, selection semantics, policy,
application services, and safety requirements.

The current frontend already follows feature-owned state and scoped rendering. Files, Changes, Git
History/Details, Git Operations, Remote/Push, Editor, and Shell have separate controllers or views,
while `AsterlynApp` still coordinates some cross-feature workflows. The only existing true context
menu is the CodeMirror Git Blame gutter menu. It uses a module-global active menu, owns its own
document/window listeners, implements only click and Escape behavior, and does not restore focus or
support a submenu. Other anchored menus independently implement related but not identical behavior.

Putting every new menu in its owning feature would duplicate difficult desktop interaction and
accessibility behavior. Putting all menu contents, availability rules, target state, and execution
inside Shell or one global menu manager would violate ADR-0007 and recreate an application
monolith. System-native menus would also move dynamic product policy into the Tauri boundary and
cannot uniformly provide Asterlyn's focusable blocked actions and explanatory activation behavior.

Several requested actions additionally depend on capabilities that do not yet exist: stable
directory authorization, recoverable create/move/copy/trash operations, arbitrary-ref mutation,
commit-range analysis, historical blob documents, range Diff, and commit-anchored History. A menu
must not become an alternate implementation of those capabilities.

## Decision

Asterlyn uses a hybrid ownership model:

```text
feature view/binding
  -> resolves an exact feature target
  -> feature context-action provider builds an immutable menu snapshot
  -> shared window ContextMenuHost presents and navigates it
  -> provider receives an opaque action ID plus the captured target
  -> feature controller or typed application port runs the use case
  -> domain capability and adapter revalidate authority and state
  -> versioned reconciliation projects the accepted outcome
```

### Shared window host

One `ContextMenuHost` exists per application window. It is a presentation service created and
disposed by the Shell composition lifecycle, but it contains no Files, Git, Editor, repository, or
workspace policy.

The host owns only:

- one stable overlay root and at most one open business context-menu session;
- pointer and keyboard anchors, viewport clamping, one-level submenu placement, and pointer intent;
- WAI-ARIA menu roles, roving focus, type-ahead, Home/End, arrow keys, Enter/Space, Escape, and
  focus return;
- closing on replacement, outside activation, owning-surface scroll, window blur/resize, workspace
  replacement, feature disposal, or explicit invalidation;
- generic command, checkbox, radio, submenu, separator, shortcut-label, danger, busy, and blocked
  item presentation;
- listener, timer, observer, and DOM disposal.

The host accepts already-localized text and opaque namespaced action IDs. It does not look up
repository state, infer whether an action is safe, execute Git/filesystem commands, mutate feature
selection, or persist an open menu. It uses a custom WebView overlay rather than Tauri's native menu
as the product surface. Operating-system reveal and trash behavior remain platform adapters behind
typed capabilities.

### Feature-owned providers and targets

Each applicable feature owns one or more context-action providers beside its controller/view
boundary. A provider:

- resolves a DOM hit or keyboard focus into a complete immutable target identity;
- decides whether right-click also changes primary selection, creates only a context highlight, or
  preserves a multi-selection;
- builds the ordered item snapshot from the feature's current canonical projection;
- omits actions that are conceptually inapplicable and marks applicable but currently blocked
  actions with a specific reason;
- validates that the captured target still belongs to the current workspace/query/repository
  generation before invocation;
- routes an accepted action through its existing controller or an explicit typed application port;
- restores focus by stable feature identity when the original virtual row no longer exists;
- closes or invalidates its menu when the target-owning state changes.

The shared host never owns `ProjectFile`, `FileChange`, `BranchSummary`, `CommitSummary`, commit-file
selection, History range selection, or internal file-operation clipboard state. Context target and
primary selection are distinct concepts. Each feature keeps the behavior recorded in the reviewed
draft instead of receiving one global selection rule.

### Menu snapshot contract

The internal model is a closed, presentation-only union:

- command item: stable item ID, localized label, action ID, optional shortcut label, visual tone,
  and availability;
- check/radio item: the same identity plus selected state;
- submenu item: stable ID, localized label, availability, and one level of child items;
- separator.

Availability is `enabled`, `blocked(reason)`, or `busy(label)`. A blocked item remains focusable and
activatable so the feature can explain the current reason without crossing the capability boundary.
Native `disabled` is reserved for controls that must not receive activation at all; it is not the
default for context actions. A busy item cannot start a second operation.

Snapshots contain no DOM nodes, arbitrary HTML, CodeMirror objects, Tauri handles, repository
objects, or executable command strings. Item IDs are unique within one snapshot, separators cannot
be leading/trailing/adjacent, submenu depth is limited to one in the first version, and an empty
submenu is omitted. Menus are built synchronously from already-observed state so opening requires
no Git, filesystem, network, or Tauri round trip.

### Invocation and command reuse

An item activation closes the menu unless the item explicitly represents an in-menu check/radio
choice. The host passes the opaque action ID to the provider that created the session. The provider
then revalidates target currency and dispatches a typed use case.

Actions already exposed by a toolbar, ordinary click, command surface, or keyboard binding reuse
the same feature/application method. One entry point must not programmatically click another
entry's DOM. Cross-feature navigation uses explicit ports such as opening a document, revealing a
workspace path, installing a History query, opening a Diff source, or opening a reviewed Git plan.
The composition root wires those ports but does not switch on every context action ID.

Action IDs are namespaced by their owner, for example `files.copy-path`, `changes.show-diff`,
`branches.merge-into-current`, or `history.copy-commit-id`. The first implementation does not add a
global extension registry or one exhaustive application-wide action enum. Internal contribution
points may be introduced after feature contracts have production evidence; the public extension
ABI remains deferred under ADR-0001.

### Validation and mutation boundary

Menu availability is explanatory presentation, not authorization. Every read rechecks its exact
workspace/repository/object/path identity and every mutation follows its owning reviewed or
recoverable application service. Expensive topology, directory, remote, and mutation preflight
happens after activation in a named progress/review surface, not while the context menu is opening.

Accepted mutation outcomes declare precise workspace and repository invalidations. They enter the
same WindowSession/RepositoryIntegrationCoordinator commit boundary as toolbar and dialog actions.
Menus cannot patch Files, Changes, History, refs, editor tabs, or repository snapshots directly.

### Existing and adjacent menus

The ordinary-editor and side-by-side Diff Git Blame gutter menu becomes the first compatibility
migration to `ContextMenuHost`; its CodeMirror adapter receives a narrow presentation port instead
of using module-global menu state, direct body rendering, global listeners, and manual close calls.
The Editor feature retains exact worktree/HEAD/parent/commit source mapping, availability, loading,
result generations, and stale-result rejection. The host sees only a checked/busy/blocked item,
anchor, stable target, invocation callback, and focus fallback. This proves editor-adapter, focus,
disposal, and per-window ownership without adding or rewriting a domain capability.

Anchored project, History-filter, editor-tab, remote-action, and Push-mode menus are not context
action providers. They may later share lower-level overlay positioning and focus utilities after
behavioral parity tests, but this ADR does not force unlike selection and toggle lifecycles into one
state model.

## Invariants

1. There is at most one open business context menu per window and no process-global active menu.
2. The host owns presentation lifecycle only; a feature owns target identity, item policy, and
   action routing.
3. Opening a menu performs no native, Git, filesystem, network, or workspace mutation request.
4. A target identity never consists solely of visible text, a row index, a short object ID, or a
   mounted DOM node.
5. A menu snapshot cannot authorize an operation. The owning service revalidates exact current
   state immediately before reading or writing.
6. Feature controllers and application services remain the single action source for toolbar,
   keyboard, command-surface, and context-menu entry points.
7. No menu writes repository or workspace projections directly; accepted outcomes reconcile through
   the versioned session boundary.
8. A feature rerender, virtual-row reuse, query/root change, or disposed owner cannot redirect an
   open action to a different target.
9. Blocked actions remain understandable to keyboard and assistive-technology users and activating
   one does not cross the capability boundary.
10. Closing restores focus to the stable target when possible or to the owning feature's valid
    fallback, never to an unrelated row occupying the same virtual position.
11. The host and every feature binding dispose all listeners, timers, observers, callbacks, and
    menu nodes on window/feature disposal.
12. Product code, protocol types, Git/workspace crates, and persisted state remain independent of
    the current WebView menu implementation.

## Consequences

- Menus gain one accessible and cross-platform interaction implementation without centralizing
  business state.
- Feature providers remain small, testable projections over existing controller state.
- Shared action labels and pure item builders may reduce repetition, while target-specific policy
  stays with its owner.
- New bottom-layer capabilities can land and be tested before their context-menu placement becomes
  visible.
- `AsterlynApp` still needs targeted extraction of cross-feature navigation ports; adding context
  action switch statements there is prohibited.
- A custom WebView menu requires its own native-platform interaction acceptance, but keeps Tauri
  replaceable and supports Asterlyn's feedback rules consistently.

## Rejected alternatives

- **One menu implementation per feature:** duplicates positioning, focus, accessibility, submenu,
  lifecycle, and platform defects.
- **One global manager containing every item and handler:** becomes a second application state
  owner, sees unrelated feature internals, and grows a central action switch.
- **System-native menus as the product model:** ties dynamic policy and content assembly to the
  desktop adapter, complicates blocked-action explanation, and weakens deterministic frontend tests.
- **DOM callbacks or synthetic clicks:** capture replaceable nodes and create entry-point-specific
  behavior instead of reusable commands.
- **Async capability preflight before opening:** makes right-click latency depend on Git/filesystem
  work and lets state change while menu geometry is unstable.
- **A public plugin contribution API now:** freezes action and permission contracts before internal
  features have established a stable capability model.

## Revisit triggers

- Public extensions require third-party context-action contributions or declarative placement.
- A supported platform demonstrates that the custom overlay cannot meet measured accessibility,
  input-method, screen-reader, or windowing requirements.
- More than one submenu level or more than a compact desktop action set becomes a repeated product
  requirement; that should first trigger command-surface redesign rather than deeper menus.
- Cross-window context actions or remote workspaces require a target identity broader than one
  window-scoped workspace session.
- Feature event ordering requires a transactional command dispatcher beyond explicit typed ports.
