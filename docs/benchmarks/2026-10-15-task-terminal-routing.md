# Task activation and Terminal routing acceptance

Date: 2026-10-15

Decision: [ADR-0026](../architecture/decisions/0026-task-activation-and-terminal-routing.md)

Plan: [Task activation and Terminal routing](../engineering/task-terminal-routing-plan.md)

## Accepted behavior

- A primary task-row click changes selection only. Double-click and `Enter` activate the selected
  runnable task exactly once; retry and reveal remain explicit single-click actions.
- User-activated plugin tasks keep native reviewed execution as the sole process authority and open
  a host-owned Terminal task session. The displayed command is inert and is never used to execute.
- Ordered stdout/stderr frames, truncation, running state, cancellation, terminal result, and later
  reveal are projected into the retained Terminal session.
- Provider discovery and cache refresh keep their background presentation and cannot open or focus
  Terminal.
- Terminal input is disabled while a task transcript owns the surface. The active task can be
  cancelled through the existing native path; a completed transcript can be cleared or replaced by
  one new supervised interactive shell.
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
  ordered output projection, retained reveal, discovery isolation, active/completed header actions,
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
