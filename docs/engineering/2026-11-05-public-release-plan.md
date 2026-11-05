# Public release: 2026-11-05

User authorization covers version upgrades, local commits, annotated tags, ordinary pushes and tracking GitHub Actions through completion. All three source repositories are clean before this release work.

| Order | Release | Gate |
| --- | --- | --- |
| 1 | Host 0.1.26 / SDK 1.14.0 | Synchronized application/core versions; full release quality checks; canonical bundled plugin bytes; reviewed atomic branch/tag Push; four-platform packaging and stable SDK Release |
| 2 | Android Gradle 0.6.7 | Host 0.1.26 minimum and CI baseline; existing AGP compatibility regression; deterministic package, native inspection and isolated parity; stable Release |
| 3 | LSP 0.3.17 | Host 0.1.26 minimum and Gradle 0.6.7 dependency; unchanged published SDK bytes; canonical admission/activation and published provenance; stable Release |
| 4 | Independent audit | Remote branch/tag identities; completed Actions; full host asset/checksum set; downloaded plugin digests equal the host's bundled identities; record URLs and limits |

The accepted local plugin versions stay immutable. New metadata/compatibility baselines use new versions. The LSP's private resource-admission transport needs the updated host, so the previous 0.1.25 release baseline must not be advertised for this distribution. No SDK surface change is required; retain the exact published 1.14.0 artifact and digest.

Use CI's exact Node 24.19.0 packaging runtime to avoid known gzip differences from local Node 26. Verify the official Node archive checksum before use. Build each plugin deterministically, pin the resulting archives in the host, and preserve immutable package digests. Plugin CI must validate against the new host tag and LSP may publish only after the host and Gradle stable releases exist.

Publication uses `GitRepository::push_preview_with_tags` and `push_current_with_options` in ordinary/current-branch-tags mode. Before each write, bind clean source, exact HEAD, origin/main, outgoing range and exact tag objects. Independently compare existing remote tag objects so only the authorized new release tag changes remotely. Preserve failed tags and remote history; any failure requires fresh evidence before deciding the next action. No credentials or raw remote URLs enter release evidence.

Previous real-project/manual acceptance remains recorded in the owning repair plans. This release adds compatibility/version/delivery metadata, not a new language engine or permission. Native local packaging follows the canonical full-bundle signature and Contents-only installer flow. CI acceptance is not a claim of complete Android semantic parity across every platform.

## Results

Pending.
