# Remote Push error diagnostics evidence — 2026-10-12

## Scope and result

Remote Push failures now preserve a bounded, structured description of rejected refs from
`git push --porcelain`. The native contract identifies branch, tag, or other refs and distinguishes
an existing tag, non-fast-forward branch, stale lease, permission or protected-ref rejection,
server hook rejection, generic rejection, and an atomic-push consequence.

The Push controller retains a structured presentation rather than collapsing every failure to one
string. The dialog now renders a specific localized title, the affected remote/ref, safe recovery
guidance, and—only for an existing tag—an explicit action to exclude tags and refresh the review.
The action never retries Push. Existing authentication and network recovery retain their previous
behavior, while unstructured or unknown failures continue through the generic fallback.

## Acceptance fixture

The native integration fixture reproduces the reported FilesRecovery topology: the branch update is
a fast-forward, while a selected local tag has the same name as a different remote tag. Git reports
the tag as `already exists` and the branch as `atomic push failed`. Asterlyn selects the tag
collision as the primary cause, reports the atomic consequence separately, and proves that neither
the remote branch nor tag changed.

The frontend regression proves that:

- the Chinese dialog names the exact remote and tag;
- the guidance explains that atomic Push left every selected ref unchanged;
- `Exclude tags and review again` changes the reviewed tag scope and reloads the preview;
- excluding tags does not invoke Push a second time; and
- ref-derived text is HTML-escaped while unrecognized raw protocol fields are ignored.

## Architecture and security

Porcelain parsing is owned by `remote_failure.rs`, Push preference persistence is owned by
`push-preferences.ts`, and the localization contract/copy is separated from the already reviewed
catalog files. The existing non-growing source ceilings remain unchanged and pass their architecture
tests.

Only classified enums, bounded ref names, the selected remote name, and root/consequence flags
cross the native/frontend boundary. Raw stdout, stderr, remote URLs, credentials, and unrestricted
server hook output are not serialized. Atomic Push, force-with-lease review, and the rule against
automatic retries remain unchanged.

## Validation

- `cargo fmt --all -- --check` passed.
- `cargo clippy --workspace --all-targets -- -D warnings` passed.
- The Rust workspace passed 276 tests with 2 operating-system watcher tests intentionally ignored.
  This includes the real bare-remote tag-collision integration test.
- All 948 frontend script tests passed, including architecture ownership, structured error mapping,
  localization parity, HTML escaping, recovery behavior, and protocol compatibility.
- TypeScript checking and the production Vite build passed. The main production chunk is
  439.26 kB raw and 97.10 kB gzip, below the 500 kB budget.

No remote write, release, tag, or package installation was performed. The FilesRecovery diagnosis
used a dry-run Push only; installed-app visual acceptance remains a separate manual step if desired.
