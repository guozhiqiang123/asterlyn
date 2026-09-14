# Commit-and-Push and staged-addition Revert evidence

Date: 2026-09-14

Status: locally validated; installed-package interaction remains for manual acceptance

## Scope and contracts

The Changes composer now presents Commit and `Commit and Push…` as peer actions. The composed action
first evaluates the current Push policy; a known blocker prevents the commit and is reported. A
successful commit still passes through the existing exact selected-file transaction. Only a
verified refreshed result continues to the existing Push review, where the user separately reviews
the remote, outgoing commits, changed files, optional tags, and ordinary or force-with-lease mode.
The composition never pushes automatically and does not weaken either transaction's authority.

Revert now accepts an index-added file as well as an ordinary tracked file. The fresh status and
`HEAD` identity are reviewed again at execution. Since the added path does not exist in `HEAD`, the
Git restore removes it from the index and worktree. The desktop transaction durably checkpoints
the exact bytes and index before that removal. A restart reconstruction test proves that Undo
restores both the CRLF file content and its staged index entry exactly. Untracked, copied,
conflicted, submodule, unborn, and dirty-editor cases remain blocked.

The misplaced recovery shortcut was removed from the Git tool heading, and Cherry-pick/Squash
shortcuts were removed from commit details; the reviewed Git-operation implementation remains
behind its consolidated entry. Search, command-list, and commit shortcut labels now derive from the
window chrome mode: macOS uses Command glyphs while Windows/Linux use Ctrl labels.

## Validation

| Check | Absolute result | Conclusion |
| --- | ---: | --- |
| Focused Changes, shell, localization, and shortcut tests | 18 passed | improved |
| Complete frontend script suite | 326 passed | no regression observed |
| Rust workspace | 132 passed, 2 native-watcher tests ignored by contract | no regression observed |
| Staged-addition Git-core test | 1 passed | improved |
| Restart recovery test | 1 passed | improved |
| TypeScript check | passed | no regression observed |
| Production frontend build | 316 modules transformed | no regression observed |
| Browser demo commit composition | commit created; outgoing count advanced from 2 to 3; Push review opened | improved |
| Browser action placement | 0 old recovery-heading buttons; 0 commit-detail Cherry-pick/Squash buttons | improved |

The browser run used the deterministic in-memory demo repository, so it validates interaction and
state sequencing rather than a real network Push. It filled the commit message, observed an enabled
`Commit and Push…`, activated it, observed the new commit at the history tip, and verified that the
full Push confirmation opened. It did not activate the final Push action.

## Package and size comparison

The comparison uses the immediately preceding complete change-block package, with the same local
dependencies, production command, release profile, and Debian bundler.

| Output | Before | After | Normalized change | Conclusion |
| --- | ---: | ---: | ---: | --- |
| Main JavaScript | 478,880 B | 479,852 B | +0.20% | no material change |
| Main JavaScript, gzip | 109,904 B | 110,382 B | +0.43% | no material change |
| Main CSS | 119,436 B | 119,444 B | +0.01% | no material change |
| Main CSS, gzip | 25,737 B | 25,931 B | +0.75% | no material change |
| Release executable | 21,760,408 B | 21,762,272 B | +0.01% | no material change |
| Debian package | 7,544,726 B | 7,547,306 B | +0.03% | no material change |

No dependency, watcher, polling producer, background worker, or new Git query was added. Runtime
responsiveness and memory are **inconclusive** because no matched process series was collected.
Interaction and destructive-action recovery are **improved**; artifact movement is **no material
change**.

The local Debian package completed successfully:

- Path: `target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`
- Size: 7,547,306 bytes
- SHA-256: `4ef91d3045024042f0cb08b874d8f72e3b559a6d3546440496ef022b1c6bf291`

Manual acceptance should verify the two composer buttons at native scale, open Push review through
`Commit and Push…` without executing the final network write, Revert one externally staged new file,
and inspect Command/Ctrl shortcut labels on macOS and Linux. Recovery browsing needs a newly chosen
permanent placement before its header shortcut returns; this change intentionally retains the lazy
recovery implementation without exposing it in the rejected Git-heading location.
