# Remote Push error diagnostics plan

Implementation completed on 2026-10-12. The accepted behavior and validation are recorded in
[`Remote Push error diagnostics evidence`](../benchmarks/2026-10-12-remote-push-error-diagnostics.md).

## Problem statement

Remote Push currently collapses Git failures into four broad categories: authentication, network,
rejected, and unknown. The native layer discards the ref-level `git push --porcelain` result after
classification, the feature controller converts the remaining error into one localized string, and
the Push dialog renders only a generic title plus that string. This loses the failed ref, the exact
reason, and the distinction between a root failure and an atomic-push consequence.

The FilesRecovery repository provides the acceptance fixture. Its current branch is a valid
fast-forward push, but the selected `All tags` scope includes local tag
`pr051826_v1.0.5_5`, whose name already exists on the remote at a different object. Git reports:

```text
!  HEAD:refs/heads/dev-v8-launcher-MinusOneScreen  [rejected] (atomic push failed)
!  refs/tags/pr051826_v1.0.5_5:refs/tags/pr051826_v1.0.5_5  [rejected] (already exists)
```

The tag collision is the root cause. The branch rejection is only the consequence of the existing
atomic safety policy. Telling the user to fetch and inspect the branch is therefore inaccurate.

## Product outcome

Push failures must identify the actionable cause without exposing raw child-process output. For the
fixture above, the dialog must explain that the remote already contains the named tag, that atomic
Push left both branch and tags unchanged, and that the user can exclude tags or create a new tag.
It must never automatically retry, overwrite a remote tag, force-push, or weaken atomic behavior.

## Invariants

1. Git remains the authority for the final Push result. Any future preflight is advisory and cannot
   replace server-side failure handling.
2. Atomic branch-and-tag Push remains intact; a failed tag must not partially update the branch.
3. Raw stdout, stderr, remote URLs, credentials, and unrestricted hook output do not cross the
   native/frontend boundary.
4. Ref names are bounded, transported as data, and HTML-escaped by the presentation layer.
5. Existing authentication and network recovery behavior remains compatible.
6. Unknown formats retain a safe generic fallback without inventing a recovery action.

## Delivery plan

### Phase 1 — structured native failure contract

- Extend the remote failure contract with an optional bounded list of ref failures.
- Preserve the existing broad `reason` field for compatibility.
- Represent the failed ref kind, safe short name, classified cause, and whether the item is a
  root cause or an atomic consequence.
- Parse the already-enabled `git push --porcelain` output before discarding the child output.
- Recognize at minimum: tag already exists, non-fast-forward/fetch-first, stale lease, protected or
  permission-rejected ref, hook rejection, atomic consequence, and unknown rejection.
- Prefer a concrete ref failure over `[rejected] (atomic push failed)` when selecting the primary
  cause.
- Bound the number and length of transported items and omit unsafe free-form server output.

### Phase 2 — actionable Push presentation

- Keep the structured error in `RemotePushController` instead of eagerly reducing it to a string.
- Introduce a presentation mapper that produces a localized title, explanation, guidance, and
  optional safe recovery action.
- Render the error as structured text in the Push dialog while preserving the existing generic
  renderer for unrelated errors.
- For a tag collision, offer an explicit `Exclude tags and review again` action. The action changes
  the reviewed tag scope and refreshes the preview; it does not retry Push automatically.
- Keep the global status/toast concise while the dialog contains the complete actionable detail.

### Phase 3 — localization and compatibility

- Add English and Simplified Chinese copy for each recognized cause.
- Remove the unconditional `Fetch and review the branch` advice from generic rejection copy.
- Keep authentication and network messages routed to their existing recovery flows.
- Accept older/unstructured error payloads and map them to the generic fallback.

### Phase 4 — regression proof

- Rust table tests for porcelain parsing, CRLF handling, ref-name bounding, atomic consequence
  ranking, and unknown formats.
- A native bare-remote integration test reproducing a fast-forward branch plus a same-name tag at a
  different object, asserting the tag root cause and that atomic Push leaves the branch unchanged.
- Protocol/serialization coverage for both structured and legacy-shaped failures.
- Controller tests proving that structured details survive request ownership and that excluding
  tags refreshes review without starting Push.
- View/localization tests for English, Chinese, HTML escaping, multiple failures, and generic
  fallback.
- Full frontend checks, production build, Rust workspace tests, and the repository's architecture
  and source-budget gates.

## Acceptance matrix

| Failure | Required explanation | Required guidance |
| --- | --- | --- |
| Remote tag already exists | Name the tag and remote; explain atomic rollback | Exclude tags or create a new tag |
| Branch is non-fast-forward | Name the branch; explain that the remote has unseen commits | Fetch, then merge or rebase |
| Protected/permission-rejected ref | Name the ref without exposing raw server output | Check permissions or branch policy |
| Remote hook rejection | Identify remote policy rejection | Review server policy; do not suggest force |
| Authentication | Preserve existing credential recovery | Recheck or configure credentials |
| Network | Preserve transport diagnosis | Check connectivity and retry explicitly |
| Unknown rejection | State that the remote rejected one or more refs | Inspect remote policy; no fabricated fix |

## Commit sequence

1. `feat(git): preserve structured push rejection details`
2. `feat(push): present actionable remote failure guidance`
3. `test(push): cover tag collisions and atomic rejection`
4. `docs(push): record structured error acceptance evidence`

Implementation may combine tests with their owning production slice, but each commit must remain
independently reviewable and must not include a release, tag, or remote push.
