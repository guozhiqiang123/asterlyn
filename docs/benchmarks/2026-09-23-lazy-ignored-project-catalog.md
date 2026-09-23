# Lazy ignored project catalog evidence

- **Date:** 2026-09-23
- **Status:** locally accepted; installed cold-start interaction remains a manual platform check
- **Scope:** first Files projection, ignored directory expansion, exact ignored-file authorization

## Problem and accepted behavior

The Files catalog previously executed `git ls-files --others --ignored` during every initial load.
Generated Android build output made that command enumerate hundreds of thousands of descendants
before the frontend could render any project row. The Files loading notice therefore remained
visible until Git output, native objects, protocol serialization, and the complete tree projection
all finished.

The initial catalog now requests Git's collapsed ignored entries. Standalone ignored files remain
available immediately, while ignored directories appear as directory identities. Opening one of
those directories performs a bounded one-level native read. The command revalidates the active
workspace and current ignore policy, rejects symbolic-link traversal, assigns the exact nested
repository identity, and merges returned files into the window's authorization catalog before the
frontend presents them. Nested ignored directories use the same operation when expanded.

## FilesRecovery measurement

Measurements used `/Users/gzq/AndroidStudioProjects/FilesRecovery` on the same local checkout and
warm filesystem state. They exercise `GitRepository::project_files(100_000)` directly, so frontend
startup and process-launch time are excluded.

| Catalog implementation | Time | Files sent | Ignored entries sent | Truncated |
| --- | ---: | ---: | ---: | --- |
| Eager ignored descendants | 1,681 ms | 94,829 | 92,002 | yes |
| Collapsed initial ignored entries | 81 ms | 2,854 | 27 | no |

The initial native catalog is about 20 times faster in this sample and avoids roughly 184,000 file
and ignored-entry records. Expanding `app/build` through the new one-level path took 17 ms and
returned 12 entries, including two immediate regular files.

These are local point measurements rather than a statistically normalized series. The installed
application should still be checked with a cold filesystem cache and the same screen recording
workflow.

## Automated evidence

The focused frontend tests cover non-blocking initial projection, single-flight ignored directory
reads, exact ignored file identity, and the row-local loading indicator. Native Git coverage checks
that the initial catalog contains a collapsed ignored directory and that one-level expansion returns
an editable ignored file that still passes read and write reauthorization. The versioned desktop
protocol includes the new command and generated type map.

## Validation commands

- `npm run check`
- `npm run test:scripts`
- `npm run build`
- `cargo fmt --all -- --check`
- `cargo test -p asterlyn-git`
- `cargo test -p asterlyn`
- `cargo test -p asterlyn-desktop`
- `git diff --check`
