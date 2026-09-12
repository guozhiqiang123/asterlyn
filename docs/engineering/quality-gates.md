# Engineering quality gates

## Definition of done

A feature is complete only when behavior, error states, tests, documentation, keyboard access, and relevant performance evidence land together. A screenshot or successful happy path is not sufficient.

## Validation layers

1. Pure parser and domain unit tests.
2. Temporary-repository integration tests for Git mutations and unusual states.
3. Frontend type checking and deterministic production build.
4. Contract tests between serialized Rust models and TypeScript models.
5. Native smoke tests on Windows, macOS, and Linux.
6. Workflow-level tests for critical user journeys.
7. Periodic accessibility, memory, latency, crash-recovery, and upgrade tests.

## Performance evidence

Every accepted benchmark records:

- machine, OS, build profile, commit, and repository fixture;
- exact operation and warm-up method;
- absolute result and variance, not only percentages;
- process-tree metric definition (prefer PSS on Linux; report RSS too);
- interpretation: improved, regressed, mixed, no material change, or inconclusive;
- limitations and next action.

Performance budgets are guardrails. They may change only through a documented decision with measured tradeoffs.

## Architecture and rendering gates

- A feature owns its serializable state, actions, asynchronous-result identity, stable DOM host,
  listeners, and disposal. The application shell may compose features but cannot become their
  alternate state owner.
- Selection, progress, and detail-result changes must update only affected feature regions.
  Replacing a list scroll container is reserved for a changed query, repository, ordering, or page
  projection and must preserve valid focus and selection identities.
- High-cardinality lists use event delegation and gain viewport virtualization before their
  session ceiling creates more than 300 simultaneously mounted rows in a supported workflow.
- Opening or saving one authorized file must not require a new full-workspace traversal after the
  active workspace session has established its catalog. Final path and revision revalidation still
  fail closed.
- A status-only Git mutation cannot require a complete history, branch, and remote snapshot. Each
  mutation declares the read-model slices it invalidates, and the frontend reconciles only those
  slices from canonical Git data.
- Production source size is an architecture-review signal, not a correctness target. Files above
  800 lines require an explicit responsibility review; files above 1,500 lines require a documented
  ownership map and tests that prevent domain truth, lifecycle, or feature state from leaking into
  the file. A large composition root may remain large when its work is genuinely cohesive and its
  dependencies are explicit. It blocks new capability work only when the review finds mixed or
  duplicated ownership. Mechanical splitting, forwarding-only wrappers, and moving lines merely to
  satisfy a threshold do not improve the architecture and do not satisfy this gate.
- The main production frontend chunk should remain below 500 kB uncompressed. A temporary breach
  is accepted during the migration only when the build records the warning and the next extraction
  keeps optional feature code behind a lazy boundary.

## Compatibility

- Support the Git versions named in the release policy and test the oldest supported version.
- Persisted formats contain a schema version and migrate atomically.
- Public protocols use additive evolution where possible and explicit negotiation where not.
- Platform-specific behavior is documented and covered by a target-platform test.

## Security

- Never invoke repository-derived text through a shell.
- Redact credentials and secrets from diagnostics.
- Treat repository tasks and configuration as untrusted until workspace trust is granted.
- Keep updater, extension, remote-agent, and AI capabilities out of M1; each requires a threat model before implementation.
- Generate dependency/SBOM evidence for release artifacts and verify update signatures before automatic installation.

## Release channels

Use development builds first, then preview, then stable only after migration/rollback and crash-rate evidence. Preview data must remain forward-migratable; stable users are never used as schema testers.
