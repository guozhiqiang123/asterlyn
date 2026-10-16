# Task activation and Terminal routing acceptance

Date: 2026-10-15

Decision: [ADR-0026](../architecture/decisions/0026-task-activation-and-terminal-routing.md)

Plan: [Task activation and Terminal routing](../engineering/task-terminal-routing-plan.md)

## Accepted behavior

- A primary task-row click changes selection only. Double-click and `Enter` activate the selected
  runnable task exactly once; retry and reveal remain explicit single-click actions.
- User-activated plugin tasks keep native reviewed execution as the sole process authority and open
  a host-owned Terminal task session. The displayed command is inert and is never used to execute.
- Ordered stdout/stderr frames, truncation, running state, and cancellation are projected into the
  active Terminal session. Completion releases Terminal; later reveal uses the retained task result.
- Provider discovery and cache refresh keep their background presentation and cannot open or focus
  Terminal.
- Terminal input is disabled while a task transcript owns the surface. The active task can be
  cancelled through the existing native path; every terminal result retains the transcript and
  hands the same surface back to a supervised interactive shell in the workspace.
- Output arriving before lazy xterm mount is retained in a 512 KiB bounded buffer. Session identity
  rejects stale output after replacement or workspace change.

## Automated evidence

- `npm run test:scripts`: 1,147 passed, 0 failed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 96 passed, 0 failed, 2 operating-system watcher
  tests ignored by their declared native-only policy.
- `npm run build`: passed with the application startup chunk at 494,810 bytes, below the 500,000
  byte architecture limit. The task feature composition was moved into the existing feature chunk;
  the limit was not raised.
- Focused tests cover click/double-click intent, preserved selection and scroll, one Terminal begin,
  ordered output projection, result-dialog reveal, discovery isolation, active/idle header actions,
  control-character-safe display quoting, and bounded pre-mount buffering.

## FilesRecovery evidence

Workspace: `/Users/gzq/AndroidStudioProjects/FilesRecovery`

The real project wrapper completed:

```text
./gradlew help --console=plain --no-daemon --no-scan
Gradle 8.13
BUILD SUCCESSFUL in 8s
```

This validates the wrapper, project configuration, working directory, and argument shape used by
the Android/Gradle task plan. Final pointer interaction and visual Terminal behavior remain available
in the installed application for manual product acceptance.

## Packaging and recoverability

- Tauri Release application and DMG built successfully for version `0.1.8`.
- The first replacement attempt correctly rejected an incompletely sealed bundle and restored the
  prior installation. The Release app was then ad-hoc signed with sealed resources and passed
  `codesign --verify --deep --strict` before installation.
- Installed executable SHA-256:
  `63c41b57131e83a9d660f9dadd4331aa2817e089ed320d12aaf2c60047a0de5d`.
- Acceptance archive SHA-256:
  `52f29638f4978b95a2d62fb8f7312b20291bf7b0f6d07d0509c7b4fa308ab4bd`.
- Acceptance archive:
  `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.8-local-20261015-171839-task-terminal-routing.app.zip`.
- Previous installed application:
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261015-171839-task-terminal-routing/Asterlyn.app`.
- The installed application was started with FilesRecovery as its workspace; process ID at
  acceptance time was `77419`.

An additional failed-candidate bundle from the deliberately rejected first replacement is retained
under `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261015-171651-task-terminal-routing/Failed-Asterlyn.app`
for diagnosis and can be removed after manual acceptance.

## Runtime regression acceptance

The installed build was refreshed after manual testing exposed three runtime-only regressions:

- Task output from native pipes now converts bare line feeds to terminal CRLF as one continuous
  stream. A carriage return at the end of one frame is remembered so a following line feed is not
  doubled; progress-style carriage returns remain intact.
- The host owns the transient queued/running projection. The first output frame also promotes a
  queued native session to running, so a plugin task row cannot remain queued while output is
  already visible.
- Android/Gradle plugin `0.1.5` excludes default Gradle/Android generated directories (`build`,
  `.gradle`, and `out`) from configuration fingerprints. Running a build therefore cannot reactivate
  the plugin merely because a generated `AndroidManifest.xml` appeared. A genuinely stale cache
  retains the last successful task tree while execution stays disabled pending refresh.

Regression evidence:

- Host `npm run test:scripts`: 1,149 passed, 0 failed.
- Plugin `npm run verify`: 42 passed, 0 failed; type-check and package build passed.
- Host `npm run build`: passed; startup chunk 495,511 bytes, below the 500,000-byte limit.
- Tauri Release application and DMG rebuilt successfully; the installed app passed deep strict
  signature verification.
- Plugin `0.1.5` artifact: 26,550 bytes, SHA-256
  `ddb4bd247f2e72002703878895f114a2b38cb94909942a0e76db8a3d2e876e45`.
- Installed executable SHA-256:
  `391c436700545d4632f6d90abe963ab08cf37087aa2e346ce324bdbdc0320d47`.
- Acceptance archive SHA-256:
  `9437895b61f36c4dcd0d8ac3d8b9907e85b521379d1b65fa82b5bbcf09c5f5e2`.
- Acceptance archive:
  `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.8-local-20261015-174858-task-runtime-fixes.app.zip`.
- Previous installed application:
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261015-174858-task-runtime-fixes/Asterlyn.app`.
- The installed application was restarted with FilesRecovery; process ID at acceptance time was
  `85216`.

## Device authorization and completed-session follow-up

A real `install*` failure initially reported the attached Samsung device as ADB `UNAUTHORIZED` and
therefore produced `No online devices found`. Physical USB presence alone is not an authorized ADB
transport, and a Gradle invocation that has already failed cannot resume after the authorization
prompt is accepted. After the same device reported the online `device` state, the exact task from
the failed Terminal transcript completed without changing its executable or arguments:

```text
./gradlew :app:installPr051826BillingremovedFsiremovedLauncherDebug --console=plain --no-daemon --no-scan
Installing APK 'app-pr051826-billingremoved-fsiremoved-launcher-debug.apk' on 'SM-G9730 - 10'
Installed on 1 device.
BUILD SUCCESSFUL in 26s
```

Together with the failed host transcript, this isolates the gap to device authorization: the host
run reached the exact Gradle task and ADB transport, while the same reviewed executable and arguments
succeeded after ADB reported the device online. It validates the environment and command shape; the
freshly installed application remains open on FilesRecovery for the final integrated UI retry. A
device that becomes authorized after an earlier failure still requires an explicit retry; the task
result and host failure notification remain the diagnostic output for that failed run.

The first two follow-ups interpreted “end the task session” too narrowly: one retained a read-only
completed transcript without a prompt, and the next cleared the transcript into a no-session state.
Manual acceptance established the intended standard-terminal behavior. Success, failure,
cancellation, and crash now retain the ordered task transcript in xterm scrollback, release task
ownership, and append a real supervised shell prompt in the same workspace. A delayed lazy mount
performs the same handoff after replaying its bounded buffered transcript. Completed output also
remains available through the Tasks result surface.

Follow-up verification:

- Terminal-focused tests: 38 passed, including completed-session input and cursor state.
- Frontend script suite: 1,161 passed, 0 failed.
- `npm run check` and `npm run build`: passed; startup chunk 499,890 bytes, below the 500,000-byte
  architecture limit.
- `asterlyn-git` Rust tests: 149 passed, 0 failed.
- Installed executable SHA-256:
  `ba178692987f8377302379cd1b64df1062defbc38ac1da1abea677d25e3c09ad`.
- Acceptance archive: `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.8-local-20261015-194723-task-session-end.app.zip`,
  9,864,634 bytes, SHA-256
  `32ada260a9761d27a63ce49a3e214c825617800ce4bc6bb8dd941ccd0f3ba1ff`.
- Previous installed application:
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261015-194723-task-session-end/Asterlyn.app`.
- The installed and backup bundles passed strict deep signature verification. The installed app was
  restarted with FilesRecovery as process `20336`.

### No-session correction acceptance — 2026-10-16

Manual testing of the preceding package confirmed that hiding the live cursor while retaining the
completed transcript was not the intended product state. The corrected package applies the ADR's
no-session semantics and adds two regression boundaries: terminal reset is ordered after already
queued xterm writes, and reset never re-arms the lazy view's automatic shell startup. This prevents
both late output from reappearing after clear and a resize from silently replacing the completed
task with an interactive shell.

- Terminal/task/style focused tests: 65 passed, 0 failed.
- Frontend script suite: 1,163 passed, 0 failed.
- `npm run check` and `npm run build`: passed; startup chunk 499,890 bytes, below the 500,000-byte
  architecture limit.
- Tauri Release application and DMG built successfully for version `0.1.8`; the accepted app was
  ad-hoc signed with hardened runtime and passed strict deep signature verification.
- Installed executable SHA-256:
  `3970a89716bb9fd27727ecda25d02aaa5d9f946f208f01834c6071ea7bd586ad`.
- Acceptance archive: `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.8-local-20261016-102002-terminal-idle.app.zip`,
  9,865,300 bytes, SHA-256
  `45a8d815d1ab30b6d7b6cc6ff32b4b8be4f06bfe3d9c25cd16a572482ced8b42`.
- Previous installed application:
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261016-102002-terminal-idle/Asterlyn.app`.
- The installed and backup bundles passed strict deep signature verification. The installed app was
  restarted with FilesRecovery as process `2991` for manual Gradle-task acceptance.

### Retained-transcript shell handoff correction — 2026-10-16

Manual testing rejected the preceding no-session behavior because it discarded the only visible
build history. The corrected lifecycle matches an ordinary terminal: the Gradle process result ends
task ownership but does not reset xterm; the host starts a real shell in the same workspace and its
prompt appears below the preserved success, failure, cancellation, or crash transcript. Beginning a
later task appends to the same scrollback instead of clearing earlier runs.

Focused and packaged acceptance evidence for this correction:

- Terminal-focused tests: 15 passed, including retained output, real-shell handoff, lazy handoff,
  and all four terminal task results.
- Frontend script suite: 1,164 passed, 0 failed.
- `npm run check` and `npm run build`: passed; startup chunk 499.89 kB, below the 500 kB
  architecture limit.
- Native tests: 96 passed, 0 failed, 2 declared operating-system watcher tests ignored.
- Tauri Release application built successfully for version `0.1.8`; the installed app is ad-hoc
  signed with hardened runtime and passed strict deep signature verification.
- Installed executable SHA-256:
  `0171777ac2093a1b0c7ab58c00071837c3b169d323ff001dd2be623f8f932d7e`.
- Acceptance archive: `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.8-local-20261016-104315-terminal-history-shell.app.zip`,
  9,865,204 bytes, SHA-256
  `b892274a2beaec4c69d4ad03d468570cfdffeb0198592642bdaa304e04bf158a`.
- Previous installed application:
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261016-104315-terminal-history-shell/Asterlyn.app`.
- The installed and backup bundles passed strict deep signature verification. The installed app was
  restarted with FilesRecovery as process `14940` for manual Gradle-task acceptance.
