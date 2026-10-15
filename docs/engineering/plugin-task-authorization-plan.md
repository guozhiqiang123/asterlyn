# Plugin task authorization rollout plan

Status: implemented and packaged; manual interaction checklist pending user acceptance.

## Outcome

Make workspace trust durable, plugin-scoped, visible and revocable from the owning plugin's Settings
entry, while allowing an explicitly remembered exact task review to skip later confirmation only
when its native execution fingerprint still matches.

The governing decision is
[`ADR-0025`](../architecture/decisions/0025-plugin-scoped-task-authorization.md), and the central
inventory is [`Plugin contract registry and evolution policy`](../governance/plugin-contracts.md).

## Scope and non-goals

This slice covers the SDK declaration, Android/Gradle manifest and localization, native bounded
authorization storage, protocol/adapters, plugin Settings switch, review checkbox, automatic start
for an exact remembered review, revocation, migration fallback, tests, native packaging, and local
installation.

It does not introduce dynamic plugin loading, cloud synchronization, wildcard task approvals,
automatic approval by task-name pattern, plugin-supplied UI, or a general-purpose secret store.

## Delivery phases and commit boundaries

### PTA0 — Decision, contract, and rollout plan — complete

1. Record ADR-0025 and this phased plan.
2. Register `plugin.task-authorization` with an independent capability version.
3. Define plugin ownership, native enforcement, revocation, legacy fallback, and fingerprint rules.

Exit gate: implementation cannot confuse global preferences, workspace trust, and task review.

Commit boundary: documentation only.

### PTA1 — SDK declaration and Android/Gradle ownership — complete

1. Add the bounded declarative task-authorization descriptor as an additive Plugin SDK minor.
2. Validate and freeze the descriptor in the host adapter and registry.
3. Declare workspace trust and remembered review in the Android/Gradle repository with plugin-owned
   English and Chinese copy.
4. Verify, package, integrity-record, and pin a new Android/Gradle artifact in the host.

Exit gate: no Android/Gradle authorization ID or localized label is defined in host source.

Commit boundary: SDK and host adapter first; independent plugin and reviewed artifact second.

### PTA2 — Native authorization capability — complete

1. Evolve the bounded trust store to plugin-scoped workspace decisions and exact task grants.
2. Preserve old path-only trust as a compatibility fallback without writing new global decisions.
3. Add read/set workspace authorization and prepared-review confirmation queries.
4. Bind task grants to the native executable/arguments identity and clear them on revocation.
5. Keep start-time workspace trust, activation, review age, and executable identity verification.

Exit gate: forged IDs, changed commands, stale reviews, corruption, and revoked trust fail closed.

Commit boundary: native store, commands/protocol generation, adapters, and focused Rust/TypeScript
tests.

### PTA3 — Host Settings and review interaction — complete

1. Project the current workspace's plugin authorization state into plugin management.
2. Render the plugin-declared trust switch through the host Settings control grammar.
3. Render an unchecked plugin-localized remember checkbox only for trusted eligible reviews.
4. Skip visible review only after native preparation returns an exact remembered grant.
5. Preserve cancel, focus trap, Escape, background discovery, output, artifacts, and errors.

Exit gate: the Settings switch revokes trust and grants; remembered exact tasks start without a
dialog; changed commands ask again.

Commit boundary: management adapter/view, execution controller/runtime/view, copy resolution, and
focused interaction tests.

### PTA4 — Regression acceptance and local delivery — automated/package complete

1. Run plugin, SDK, authorization, Settings, execution, localization, and protocol focused suites.
2. Run the full script suite, type check, production build, relevant Rust tests, formatting, and
   native rendered smoke.
3. Exercise FilesRecovery trust, revoke, remember, repeat, and changed-command behavior.
4. Build a fresh signed local application, retain the previous installation, replace it, relaunch
   FilesRecovery, and record hashes, performance, memory, accessibility, rollback, and limits.

Exit gate: the installed application is ready for human interaction acceptance with recoverable
rollback evidence.

Commit boundary: acceptance evidence only after verified installation.

## Acceptance matrix

- **Ownership:** descriptor and localized copy ship from Android/Gradle; host code stays generic.
- **Workspace scope:** the same plugin/workspace remembers trust; another plugin or workspace does
  not inherit it.
- **Task scope:** only an explicitly remembered exact invocation skips review.
- **Invalidation:** executable, content, arguments, provider, task, plugin, or workspace changes ask
  again.
- **Revocation:** Settings off cancels active work and clears remembered grants in scope.
- **Security:** native start still requires trusted current workspace and a live matching review.
- **Accessibility:** switch and checkbox have resolved labels/descriptions, keyboard focus, and
  visible state; skipped dialogs do not steal focus.
- **Performance/memory:** bounded files and maps; one native read per preparation; no task catalog is
  copied into authorization storage.
- **Recovery:** old trust is readable, corrupt/newer stores fail closed, and prior app is retained.
