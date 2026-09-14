# Action feedback and Update lifecycle evidence

Date: 2026-09-14

Status: locally validated; native real-remote outcomes remain part of manual package acceptance

## Reproduction and correction

The supplied native recording showed Update receiving pointer emphasis while the dialog, status,
and notification remained unchanged. The only visible message was `Fetch completed` from the
earlier foreground reconciliation, so it could not prove that the explicit Update activation ran.

Local browser reproduction isolated the lifecycle defect: Update initially produced a blocked-state
message, but after repository reconciliation replaced its toolbar node, the newly visible button no
longer owned the listener installed at shell startup. The repair delegates remote actions from the
stable shell root and resolves the current action node at event time. It therefore survives Fetch,
commit, refresh, localization, and other toolbar reconciliations. If the policy check and controller
race, a failed dialog-open attempt now reports the current blocker instead of returning silently.

An already-current Update now uses the requested informational treatment—blue information mark,
`All files are up to date` / `所有文件均为最新`, four-second visible notification, and the same
terminal status message. The new global feedback standard classifies immediate state changes,
asynchronous progress and terminal outcomes, unavailable actions, lifecycle ownership, and
accessibility requirements for all future commands.

## Validation

| Check | Absolute result | Conclusion |
| --- | ---: | --- |
| Focused feedback and lifecycle tests | 13 passed | improved |
| Complete script suite | 316 passed | no regression observed |
| `asterlyn-git` Rust suite | 69 passed | no regression observed |
| Frontend type check | passed | no regression observed |
| Production frontend build | passed | no regression observed |
| Browser lifecycle reproduction | silent before repair; blocker notification after node replacement following repair | improved |
| Native Linux smoke lifetime | 6,000 ms | no immediate startup regression observed |

The browser check deliberately committed the demo changes so repository reconciliation replaced the
remote toolbar controls. Activating the replacement Update control then produced its unavailable
reason, proving that feedback no longer depends on the lifetime of the original button node. The
focused tests independently replace an action button and verify that the same delegated binding
handles it while rejecting unknown and out-of-root controls.

## Performance and package comparison

The comparison uses the immediately preceding accepted foreground-Fetch build with the same
dependency installation and production build command.

| Output | Before | After | Normalized change | Conclusion |
| --- | ---: | ---: | ---: | --- |
| Main JavaScript | 475,048 B | 475,544 B | +0.10% | no material change |
| Main JavaScript, gzip | 108,998 B | 109,168 B | +0.16% | no material change |
| Main CSS | 118,940 B | 118,940 B | 0.00% | no material change |
| Main CSS, gzip | 25,665 B | 25,667 B | +0.01% | no material change |

The repair adds no dependency, timer, polling producer, or repository read. One stable shell listener
replaces listeners on short-lived toolbar nodes, so idle CPU and network behavior are unchanged by
construction. The main JavaScript bundle remains below the existing 500 KiB architecture gate.
Runtime responsiveness is **improved** for the repaired action path because replacement controls no
longer lose activation. Native memory remains **inconclusive** because no comparable heap sample was
collected.

The Linux Tauri wrapper produced `Asterlyn_0.1.0_amd64.deb` successfully.

- Debian size: 7,539,196 bytes
- SHA-256: `2f2c338e43cdc1d541d8205f47b0bdf61599845d8eb5c986092761a586f2c226`
- Release binary size: 21,756,000 bytes

## Accessibility and remaining acceptance

The informational completion is a polite status notification with a visible blue information mark;
it does not misuse success or error semantics. Unavailable replacement controls remain keyboard
operable and announce their exact blocker. The durable interaction standard also requires disabled
or rejected actions to expose a reason instead of disappearing into a silent return.

Manual acceptance should click Update after foreground Fetch has completed, confirm that its review
opens, execute against an already-current branch, and verify `All files are up to date` / `所有文件均为最新`.
A real behind/divergent remote and network failure remain useful checks of the existing strategy and
error paths; this correction does not change Git semantics.
