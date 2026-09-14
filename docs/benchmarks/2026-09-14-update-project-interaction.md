# Update Project interaction evidence

Date: 2026-09-14

Status: locally accepted; native divergent-remote interaction remains part of manual package acceptance

## Scope and behavior

This correction closes the silent Update interaction reported for a branch whose local and upstream histories have diverged.

- Update and Push remain primary top-bar actions. Fetch is still directly available, but it moves to a labeled secondary item in the adjacent remote-actions menu.
- The last-fetched incoming count belongs to Update and the outgoing count belongs to Push.
- A clean branch with a supported upstream can activate Update even when its last-fetched incoming count is zero. That count describes cached remote-tracking refs and is not treated as proof of current server state.
- Known divergence opens the Update review with Merge selected, Rebase available, and Fast-forward unavailable.
- If an apparently current branch becomes known to be divergent during the Fast-forward fetch, the canonical refresh keeps the review open and changes the default to Merge. The failed Fast-forward explanation remains visible rather than disappearing behind an inert toolbar button.
- Repository, operation, worktree, upstream, and remote-policy blockers remain semantic unavailable states. Their buttons stay focusable and activatable solely to show the exact localized blocker; no blocked activation enters the Git boundary.
- The remote-actions menu reports expanded state, closes on Escape and outside activation, and is mutually exclusive with the project, editor-tab, and remote-selector menus.

Merge and Rebase still require the exact-object second confirmation after Fetch. No cached relationship, toolbar click, or earlier strategy choice authorizes mutation against a newly observed upstream object.

## Automated validation

| Check | Absolute result | Conclusion |
| --- | ---: | --- |
| Frontend static/type/style check | passed | improved |
| Focused remote policy, controller, shell, and view tests | 25 passed | improved |
| Complete script suite | 310 passed | no regression observed |
| `asterlyn-git` Rust suite | 69 passed | no regression observed |
| Production frontend build | passed | no regression observed |
| Native Linux smoke lifetime | 6,000 ms | no immediate startup regression observed |

The focused checks cover clean last-known-current eligibility, dirty-worktree blocking, ahead-only Fast-forward eligibility, menu mutual exclusion, accessible unavailable state, and the absence of native button disabling that previously swallowed blocked-action feedback.

## Build-size comparison

The comparison uses the pre-change `d0a7965` checkout with the same dependency installation and build command.

| Output | Before | After | Normalized change | Conclusion |
| --- | ---: | ---: | ---: | --- |
| Main JavaScript | 469,026 B | 472,882 B | +0.82% | regressed slightly |
| Main JavaScript, gzip | 107,844 B | 108,552 B | +0.66% | regressed slightly |
| Main CSS | 117,559 B | 118,719 B | +0.99% | regressed slightly |
| Main CSS, gzip | 25,454 B | 25,618 B | +0.64% | regressed slightly |

The increase is the localized menu, actionable-warning, and strategy-state interaction. No runtime dependency was added, and the main JavaScript output remains below the existing 500 KiB architecture gate. The result is accepted as a small size regression in exchange for a previously missing safety decision and observable failure path.

## Native package

The Linux Tauri environment wrapper produced `Asterlyn_0.1.0_amd64.deb` successfully.

- Debian size: 7,537,976 bytes
- SHA-256: `8b564f959da9074a77d8158b804c0a80bd2a08f88a1549312b0c321e50749c08`
- Release binary size: 21,753,648 bytes

The direct package command initially lacked the repository-documented WebKit `pkg-config` environment. Re-running through the documented wrapper succeeded; this was a host build-environment issue rather than a source or package failure.

## Interpretation and remaining acceptance

Functionality and accessibility are **improved**. Bundle size **regressed slightly** but remains within the existing gate. The correction adds no polling loop, background producer, remote request, or dependency, so idle work is unchanged by construction; memory remains **inconclusive** because no native heap comparison was collected.

Manual acceptance should exercise a real remote where the branch is current, behind, ahead, and divergent; verify Merge/Rebase selection after a server-side change; and verify the final conflict route in Changes. The badge remains explicitly last-fetched evidence, Fetch remains a manual secondary action, dirty-worktree Update remains blocked, and Asterlyn does not auto-stash, auto-retry, or choose a history-rewriting strategy without confirmation.
