# Host presentation system acceptance

Date: 2026-10-15

Representative workspace: `/Users/gzq/AndroidStudioProjects/FilesRecovery`

Application version: `0.1.8`

## Accepted architecture

- `host.presentation` now has one business-neutral renderer for semantic actions, centered panel
  states, inline notices, dialog shells, and dialog action groups. Features provide plain escaped
  text, semantic action IDs, and intent; they do not recreate host class names or visual values.
- The Tasks feature uses a centered state only when it has no usable task content. Loading,
  empty, failed, and stale-cache states therefore remain understandable instead of leaving a blank
  panel. When retained tasks are usable, refresh and stale information stays inline and does not
  replace the tree.
- Task execution review uses the same host dialog and action grammar. Confirm/retry is the single
  recommended action, Cancel is neutral, and the persistent workspace-trust refusal is a separated
  destructive action. The host continues to own trust, review tokens, execution, focus, and Escape.
- Plugins still cannot supply DOM, CSS, component instances, callbacks, or custom security dialogs.
  The presentation layer remains an `experimental-host` contract until a bounded declarative
  plugin schema completes the admission process in the central contract registry.
- Localization, Settings, collections, tasks, caching, and presentation keep independent version
  axes. Future search and panel-opening capabilities must be registered separately rather than
  growing an untyped presentation contract.

The decision is recorded in
`docs/architecture/decisions/0024-host-presentation-contract-and-plugin-contract-governance.md`;
the registry is `docs/governance/plugin-contracts.md`; and the staged implementation is
`docs/engineering/host-presentation-system-plan.md`.

## Delivered commits

| Phase | Commit |
| --- | --- |
| HPS0 — contract governance and implementation plan | `ee6552c` (`docs: govern host presentation contracts`) |
| HPS1 — host presentation primitives | `0331144` (`feat: add host presentation primitives`) |
| HPS2 — Tasks state presentation | `4a5478e` (`feat: unify Tasks state presentation`) |
| HPS3 — task-execution dialog presentation | `ca89aea` (`feat: unify task execution dialog presentation`) |
| Build budget correction | `ac57a2f` (`build: preserve presentation startup budget`) |

## Behavior evidence

| Case | Accepted outcome |
| --- | --- |
| No tasks while discovering | Centered loading status with cancel as a neutral action |
| No tasks after discovery | Centered empty state with refresh as the blue recommended action |
| No tasks after failure | Centered alert with retry as the recommended action |
| Invalid/stale cache with no usable tasks | Centered stale explanation and Gradle refresh action |
| Retained tasks while validating or after refresh failure | Existing tree remains visible with an inline notice |
| Execution awaiting review | Host dialog with one recommended Confirm action and neutral Cancel |
| Untrusted workspace review | Trust remains host-owned; “Do not trust workspace” is separated from ordinary cancellation |

The installed application was launched against FilesRecovery. Visual inspection of the real macOS
WebView confirmed that the stale-cache state is centered in the Tasks body, explanation and action
are vertically arranged, and the refresh action uses the host blue primary-button treatment.
Automatic input injection is not permitted by the local macOS accessibility policy, so destructive
or executable dialog actions were not synthesized merely to obtain a screenshot.

## Automated validation

| Check | Result |
| --- | --- |
| Focused presentation, Tasks, execution, artifacts, localization, dialog, and SDK suites | passed |
| Full `npm run test:scripts` | passed; 1,131 tests, 0 failures |
| `npm run check` | passed |
| `npm run build` | passed; 650 modules |
| Production startup main chunk | 498.28 kB; remains below the 500 kB gate |
| Built application rendered smoke | passed within the 6-second gate |
| Installed application rendered smoke | passed within the 6-second gate |
| Built and installed strict code-sign verification | passed; ad-hoc signature with hardened runtime |

The focused presentation tests enforce escaped text, action-intent mapping, one recommended action,
status/alert semantics, title association, and optional details/actions. Existing dialog tests cover
focus trapping, default focus, Escape, and terminal-state action behavior. The new renderers are
synchronous string projections, add no listener registry, and do not duplicate the Tasks tree.

## Runtime and resource evidence

| Measurement | Result |
| --- | ---: |
| Installed app sample after 4 minutes 25 seconds | 34,000 KiB RSS |
| Sampled CPU at the same point | 1.3% |
| Built/installed executable size | 25,481,488 bytes |
| Built/installed executable SHA-256 | `045690db360380b598fbf1ad8a740c16c1728a4062b370cb3cd343950479c565` |

The process sample is an acceptance observation, not a long-duration leak proof. The architectural
memory bound is that presentation models are request-scoped strings/data and introduce neither a
second retained tree nor a long-lived callback/listener collection.

## Local package and recovery

| Item | Value |
| --- | --- |
| Archive | `target/release/bundle/macos/Asterlyn-0.1.8-local-20261015-host-presentation-system.app.zip` |
| Archive size | 9,833,481 bytes |
| Archive SHA-256 | `44dd2442a420c79d6a64a15cf99ecacf71f84e89dc6e0d9b426d8e6d3600ec5d` |
| Installation | `/Applications/Asterlyn.app` |
| Previous-app backup | `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261015-host-presentation-system/Asterlyn.app` |

The installed executable hash exactly matches the verified build. Both the replacement and retained
backup pass strict signature verification. The installed app remains open with FilesRecovery for
manual acceptance.

## Human acceptance and current limits

1. In Tasks, inspect the centered stale/empty/error/loading states and retained-tree inline notices.
2. Choose **Refresh Gradle tasks** and confirm the review dialog uses host spacing, typography, and
   button hierarchy; Cancel must dismiss it without execution.
3. For an untrusted test workspace, confirm the trust refusal reads as a trust decision rather than
   a second ambiguous Cancel action.
4. Execute and cancel only a known safe task, then verify output, artifacts, focus return, and
   terminal actions retain their prior behavior.

This slice does not expose arbitrary plugin UI or publish a new Plugin SDK presentation schema.
External plugin loading, generic plugin panels/dialogs, and search/panel invocation contracts remain
deferred to their own ADR, bounds, compatibility fixtures, and independent-plugin acceptance.
