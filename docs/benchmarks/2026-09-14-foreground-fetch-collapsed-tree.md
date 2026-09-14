# Foreground Fetch and collapsed-tree evidence

Date: 2026-09-14

Status: locally accepted; real-remote foreground behavior remains part of manual package acceptance

## Scope and behavior

This correction makes network freshness observable without turning window activation into an
implicit Update operation.

- Update uses a downward-arrow icon and retains its complete accessible action description.
- An interactive Update whose post-Fetch branch object is unchanged reports a localized prominent
  informational message and shared status instead of appearing inert.
- Each native blur-to-focus transition performs at most one Fetch for the selected remote. Its
  canonical result updates the incoming count on Update; it never merges, rebases, fast-forwards,
  checks out, modifies the worktree, or starts an unrelated untracked-file scan.
- Absences shorter than five seconds skip the broad local recovery. Longer absences reconcile local
  workspace/Git slices first, then Fetch. A focus event without a preceding blur does not duplicate
  work.
- Automatic Fetch is suppressed during a Remote/Push review, reviewed Git operation, active remote
  operation, or global workbench task, and for demo, ordinary-folder, or unsupported-remote states.
- A newly activated root starts with every directory collapsed. Same-root catalog reconciliation
  continues to preserve surviving disclosure, selection, and scroll identities.

## Automated validation

| Check | Absolute result | Conclusion |
| --- | ---: | --- |
| Frontend static/type/style check | passed | no regression observed |
| Focused coordinator, project-tree, remote-feedback, and shell/view tests | 27 passed | improved |
| Complete script suite | 314 passed | no regression observed |
| `asterlyn-git` Rust suite | 69 passed | no regression observed |
| Production frontend build | passed | no regression observed |
| Native Linux smoke lifetime | 6,000 ms | no immediate startup regression observed |

The focused tests verify local-before-remote ordering after a long absence, Fetch-only behavior after
a short absence, no duplicate request from an unmatched focus event, all-collapsed first-open state,
the Update icon/count projection, and the distinct prominent no-op Update completion.

## Performance and package comparison

The comparison uses the immediately preceding accepted Update interaction build with the same
dependency installation and production build command.

| Output | Before | After | Normalized change | Conclusion |
| --- | ---: | ---: | ---: | --- |
| Main JavaScript | 472,882 B | 475,048 B | +0.46% | regressed slightly |
| Main JavaScript, gzip | 108,552 B | 108,998 B | +0.41% | regressed slightly |
| Main CSS | 118,719 B | 118,940 B | +0.19% | regressed slightly |
| Main CSS, gzip | 25,618 B | 25,665 B | +0.18% | regressed slightly |

No dependency, polling timer, second repository model, or startup remote request was added. The
main JavaScript bundle remains below the existing 500 KiB architecture gate. Foreground activation
now intentionally adds one network Fetch per completed blur-to-focus pair; heavy local recovery is
still limited to absences of at least five seconds. Network/CPU work on foreground transition is
therefore **regressed intentionally and bounded**, while first-open tree mounting and visible state
freshness are **improved**. Native memory remains **inconclusive** because no comparable heap sample
was collected.

The Linux Tauri wrapper produced `Asterlyn_0.1.0_amd64.deb` successfully.

- Debian size: 7,539,056 bytes
- SHA-256: `3d28400d3db40ddbb64e4da1510bc45f723ec196d05cc297825e2fe2441ccf21`
- Release binary size: 21,755,296 bytes

## Accessibility and remaining acceptance

The icon remains supplemental to the Update button's named route/strategy description. The incoming
badge is hidden from visual duplication but represented in the complete action label. The current-
state confirmation uses the existing polite informational toast and dismisses after four seconds,
while the same text remains in the status bar. These changes are **improved** for understandable
action feedback; no new keyboard-only control was introduced.

Manual acceptance should return a native window from the background with a reachable selected
remote and verify that the Update count changes after a server-side commit, that an already-current
Update produces visible success feedback, and that a newly imported large project starts collapsed.
Offline foreground Fetch reports a non-blocking status failure. It does not retry until another
blur-to-focus pair or an explicit Fetch, and it never chooses or executes an integration strategy.
