# Android workbench and device discovery acceptance

- **Date:** 2026-10-16
- **Host version:** 0.1.8
- **Host range:** `e4ba667` through `b02a6a9`
- **Android plugin version:** 0.2.0
- **Android plugin source:** `b0a2ec1`
- **Plugin SDK:** 1.4.0

## Accepted scope

This delivery completes AW1 through AW4 of the
[Android workbench plan](../engineering/android-workbench-and-device-discovery-plan.md):

- generic, bounded workspace-tool, execution-target, run-configuration, process-query, and
  workspace-state contracts;
- a native host process-query service that admits only the fixed first-party
  `adb devices -l` query, resolves ADB through bounded SDK/PATH candidates, captures bounded output,
  enforces a ten-second timeout, and cancels children on window/application lifecycle boundaries;
- plugin-owned ADB parsing, transient target snapshots, workspace-scoped explicit selection, and
  coalesced refresh;
- a host-rendered Android activity entry and Run/Tasks/Devices workbench with localized device
  states, host title-bar actions, keyboard tab navigation, common empty/loading/error rendering,
  and the existing Gradle task tree retained as the Tasks view.

The stable plugin ID remains `dev.asterlyn.android-gradle`; only its displayed product identity is
Android. The plugin still contributes no DOM, CSS, SVG, PTY, process handle, or arbitrary command.

## Honest Run boundary

The Run surface intentionally exposes an incomplete Android application configuration. The title-
bar Run action remains disabled until the plugin can authoritatively provide an application ID and
launcher activity. No Gradle-file regex, module guess, Flavor guess, device guess, or synthetic ADB
launch command is used. AW5 and AW6 remain future work.

## Validation

| Gate | Result |
| --- | --- |
| Android plugin verification | 53 tests passed; TypeScript check and package build passed |
| Host script suite | 1,188 tests passed |
| Rust workspace | 79 tests passed, including timeout and registry-release coverage |
| TypeScript | `npm run check` passed |
| Production frontend | passed; application chunk 495.41 kB, below the existing 500,000-byte limit |
| Native smoke | application shell rendered within the six-second bound |
| FilesRecovery ADB probe | one target reported in `device` state through the same fixed argument vector |

Test host runtime: Node 26.8.1, npm 11.19.0, and Rust 1.97.1 on macOS.

## Package and installation

The accepted macOS bundle was built with `tauri build --bundles app`, archived with resource forks,
and installed over `/Applications/Asterlyn.app` only after the native smoke passed.

- Archive: `target/release/bundle/macos/Asterlyn-0.1.8-b02a6a9-macos.zip`
- Archive size: 9,973,559 bytes
- Archive SHA-256: `c980c26544c37b0fcea6821a8e0c367cb43f5d043388e51a5ecdeaf2acb93902`
- Built/installed executable SHA-256: `a8de17ba1877b7308e7055043b362eecf76a0f0b4be2a2df24682238dc6eec72`
- Relaunch: successful

The bundled plugin artifact is pinned by source revision, byte length, SHA-256, and npm integrity in
`vendor/plugins/android-gradle-0.2.0.json`. Rolling back means repinning the retained 0.1.7 artifact;
workspace state is namespaced and the stable plugin ID prevents preference orphaning.

## Remaining acceptance

Manual light/dark, 200% zoom, multiple-device selection, offline/unauthorized hardware transitions,
and the eventual build/install/launch session require separate product acceptance. Parser and view
fixtures cover their bounded states, but this record does not claim physical scenarios that were not
observed on this machine.
