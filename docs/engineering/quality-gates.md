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

