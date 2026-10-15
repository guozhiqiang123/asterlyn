# Shared hierarchical collection and Android Tasks acceptance

Date: 2026-10-15

Representative workspace: `/Users/gzq/AndroidStudioProjects/FilesRecovery`

Application version: `0.1.8`

## Delivered architecture

- The host now owns an immutable, indexed `HierarchicalCollection` presentation model instead of
  letting each feature or plugin implement tree behavior independently. It validates parent/child
  structure and provides deterministic tree and flat projections, filtering, disclosure, bounded
  leaf windows, keyboard decisions, focus identity, and ARIA sibling metadata.
- Shared DOM-neutral view helpers and DOM renderers provide the common row/container behavior.
  Domain adapters remain responsible only for semantic node construction and domain-specific
  commands.
- The plugin SDK collection contract stays declarative: plugins contribute semantic nodes and exact
  task references, never host DOM, CSS, focus state, or event handlers.
- The contribution runtime validates and qualifies plugin collections, selects only the collection
  for the matching local provider, and isolates malformed or throwing contributions. Tasks continue
  through a deterministic host-derived fallback instead of leaving the panel blank.
- The Tasks controller joins collection leaves to normalized task snapshots by exact task ID. A
  missing or duplicate reference cannot acquire task execution authority.

The architecture decision is recorded in
`docs/architecture/decisions/0022-host-owned-hierarchical-collection-presentation.md`; the staged
rollout is recorded in `docs/engineering/hierarchical-collection-and-android-tasks-plan.md`.

## Android / Gradle presentation

- Android / Gradle `0.1.2` contributes stable root/module/`Tasks`/group/task semantics from its
  independent repository. Root-project tasks and nested modules retain exact Gradle task paths.
- Full Tasks and Quick Actions both use the host-owned collection engine. Full Tasks consume the
  plugin semantics; Quick Actions use a host-derived action-kind hierarchy through the same engine.
- The panel provides Tree/Flat, Expand all, and Collapse all controls. Search force-expands matching
  ancestors without overwriting the user's saved disclosure state.
- Generic keyboard navigation, focus restoration, shared rows, and tree accessibility metadata
  replace the Tasks-specific traversal and rendering path.
- The Tasks adapter projects through a transparent synthetic workspace root, so the implementation
  container does not occupy a visible folder row. The filter uses placeholder and accessible-name
  text without a duplicate visible heading.
- Gradle task leaves retain their complete exact identities, such as `:app:assembleDebug`, in both
  tree and flat modes. Grouping no longer shortens Quick Actions to a variant-only label.
- Existing loading, cancellation, error/retry, empty, stale-cache, running/output, Settings,
  Refresh, and Close behavior remains owned by the Tasks feature. An old or invalid plugin artifact
  still renders tasks through the tested fallback.

## Cross-repository artifact identity

| Item | Identity |
| --- | --- |
| Plugin repository | `/Users/gzq/PrivateProjects/asterlyn-plugin-android-gradle` |
| Plugin source commit | `41a1004` (`fix: preserve complete Gradle task labels`) |
| Plugin release-record commit | `f2cba12` (`build: record plugin 0.1.2 artifact`) |
| Plugin version / SDK | `0.1.2` / `1.0.0` |
| Artifact SHA-256 | `8792800ed7060b76f65bbf7cbf31de8ca5419b43ce21a14bd64e0f7dca24a65b` |
| Artifact integrity | `sha512-0DFtqXgbrjQ0dqiZL0aGdKrkSWsj716PhmhdDXhY1lG6wOuYl6/Q8htwiv718aoFPd7lOkZNH72y332mRgfoIg==` |
| Host model commit | `de775ee` (`feat: complete hierarchical collection model`) |
| Host runtime commit | `25265f4` (`feat: carry plugin collections into tasks`) |
| Host initial UI/artifact commit | `76ab1a3` (`feat: render Android tasks with shared collections`) |
| Host presentation follow-up | `4b0b6ad` (`fix: clarify Gradle task tree presentation`) |

The host vendors and pins the reviewed tarball and metadata. Production resolution does not depend
on an implicit sibling checkout.

## FilesRecovery evidence

The real workspace was queried using the plugin's exact discovery command:

```text
./gradlew tasks --all --console=plain --no-daemon --no-scan
```

The command produced 1,364,975 bytes across 16,031 lines. Android / Gradle `0.1.2` parsed it as:

| Measurement | Result |
| --- | ---: |
| Runnable task leaves | 15,980 |
| Semantic collection nodes | 16,049 |
| Collection truncated | no |
| Root entries | `Tasks`, `app`, `clean`, `files`, `files-private`, `launcher-demo`, `launcher-minus-one`, `video`, `viewbinding` |

Every collection leaf resolves to one of the 15,980 exact normalized task IDs. The collection
contains both root tasks and the multi-module hierarchy visible in FilesRecovery, and remains within
the existing discovery and presentation bounds.

## Automated validation

| Check | Result |
| --- | --- |
| Android / Gradle `npm run verify` | passed; 39 tests plus type check and build |
| Host focused model/runtime/view suites | passed |
| Host `npm run test:scripts` | passed; 1,120 tests |
| Host `npm run check` | passed |
| Host `npm run build` | passed; 646 modules |
| Host `cargo fmt --check` | passed |
| Host `cargo test -p asterlyn` | passed; 93 tests, with 2 OS-watcher probes ignored by design |
| Built application rendered smoke | passed within the 6-second gate |
| Installed application rendered smoke | passed within the 6-second gate |
| Built and installed strict code-sign verification | passed; ad-hoc signature with hardened runtime |

## Local package and installation

| Item | Value |
| --- | --- |
| Archive | `target/release/bundle/macos/Asterlyn-0.1.8-local-20261015-task-tree-clarity.app.zip` |
| Archive size | 9,823,465 bytes |
| Archive SHA-256 | `d9c2cd083a6dc5795062e95854316a7330c1e251e3ab6d97462062ea76e7f360` |
| Installed executable SHA-256 | `646cdea3f07810398193f4206c53ea0ec6fd53a0d0fec6c94d2df98dff93d34c` |
| Installation | `/Applications/Asterlyn.app` |
| Previous-app backup | `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261015-task-tree-clarity/Asterlyn.app` |

The installed executable hash exactly matches the verified build. The installed application was
launched with FilesRecovery as its workspace argument after replacement.

## Human acceptance boundary

The installation is ready for manual interaction acceptance. The remaining checks require human
inspection in the macOS WebView:

1. Switch between Tree and Flat for both plugin presentation modes.
2. Confirm no synthetic workspace-root row is visible, then expand and collapse module/group nodes.
3. Confirm the filter has no duplicate visible title; search and clear it, preserving disclosure.
4. Confirm task rows keep exact `:module:taskName` labels in both Tree and Flat modes.
5. Open plugin Settings from the panel, switch Full Tasks / Quick Actions, and return to Tasks.
6. Run and cancel a safe Gradle task, then inspect output and terminal status.

These actions are intentionally not claimed by the rendered-shell smoke. If rollback is needed, quit
Asterlyn, move the current `/Applications/Asterlyn.app` aside, and restore the retained backup above.
