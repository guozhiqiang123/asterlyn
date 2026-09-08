# Multi-year lifecycle governance

## Why this exists

A 3–5 year product will outlive individual library versions and many early assumptions. Longevity comes from replaceable boundaries, evidence, and migration discipline—not from predicting the perfect stack in year one.

## Decision lifecycle

- Record choices that constrain multiple modules, persisted data, security boundaries, or public APIs as ADRs.
- Every ADR states revisit triggers. “Accepted” does not mean permanent.
- Review Tauri, CodeMirror, Git adapter strategy, language-service model, persistence, and extension model at least annually.
- Prototype a replacement behind the existing capability boundary before approving a platform rewrite.

## Dependency lifecycle

- Keep dependencies intentional and remove unused ones.
- Track runtime cost, maintenance health, licensing, platform support, and security—not version freshness alone.
- Do not let frontend framework conventions define domain boundaries.
- Pin release inputs, automate updates in reviewable batches, and maintain an emergency patch path.

## Data lifecycle

- Git repositories remain externally readable and authoritative.
- User settings, workspace state, caches, indexes, and credentials are separate classes with separate retention and recovery rules.
- Caches are disposable. User-authored settings are backed up before migration. Credentials belong in OS facilities.
- A migration is incomplete until downgrade/rollback behavior is documented and tested.

## Scope lifecycle

- Each stage has stop, continue, and revise decisions based on usage and cost.
- Capability breadth cannot outrun maintenance capacity.
- Reserve 20–30% of delivery capacity for defects, platform changes, performance, accessibility, and dependency upkeep after Stage 2.
- Remove experiments that fail their decision deadline; do not leave dormant frameworks in the baseline.

## Brand lifecycle

`Asterlyn` is the working formal brand selected after a preliminary collision search. It is not a legal trademark clearance. Product-visible naming is centralized so legal or market validation can change the brand without renaming domain protocols, repository schemas, or every internal symbol.

