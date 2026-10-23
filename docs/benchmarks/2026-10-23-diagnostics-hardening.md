# Diagnostics hardening acceptance — 2026-10-23

- Plan: [ordered D1–D5 implementation](../engineering/2026-10-23-diagnostics-hardening-plan.md).
- Baseline: `5b3e03f`; local modified source, no commit or remote publication.
- Platform: macOS arm64; package version `0.1.19`.
- Accepted build ID: `5b3e03fb91894977523baa00300e053410b6547d-dirty-1792736924593`.

## Checks

- Frontend type check, production build and all 1,281 script tests passed. The script suite includes four new diagnostics tests and unchanged architecture/protocol gates.
- Rust application library: 154 passed, 3 existing tests ignored (two OS watcher cases and one public GitHub fixture case). Git crate: 147 unit plus 9 integration tests passed; doc tests passed.
- Formatting and diff whitespace checks passed.
- Synthetic-secret tests cover case-insensitive Basic/Bearer/authorization/cookie forms, object credential keys, credential query values, URL user info and Unicode, including a long URL whose authority is truncated before `@`.
- Fault/concurrency tests cover inaccessible-directory recovery, failed rotation then recovery, independent writers, live-session retention, archive order, priority queue/drop counts, operation abandonment/terminal-event uniqueness, output ordering, trace restoration and bounded shutdown.
- A debug/test fault burst submitted 2,000 metadata events in 61.95 ms (about 31 microseconds/event including preparation/enqueue). The blocked sink retained 64 and counted 1,936 as dropped; removing the obstruction restored writes and preserved a new error sentinel. This deliberately exceeds the retry budget; it is not a production throughput/slow-disk benchmark.

## Artifact and installation

- Fresh Tauri application bundle: `target/release/bundle/macos/Asterlyn.app`.
- Complete bundle re-signed ad hoc after packaging; strict deep verification passed. Identity `dev.asterlyn.desktop`, `Signature=adhoc`, sealed resources version 2, expected version `0.1.19`.
- Native smoke ran the **signed bundle executable** and confirmed the rendered application shell within its 6,000 ms observation window, using accessibility inspection rather than screenshots.
- Archive: `target/release/bundle/macos/Asterlyn-0.1.19-diagnostics-hardening-macos.app.zip`.
- Archive SHA-256: `03f53266d90e848717673f46dcc86c2182d7a7761b8c4ae055391614492dc1b4`.
- Accepted and installed executable SHA-256: `367adfd23c61f4de4be5412c81f7620bcbc273dd9b0294df3cf930c10c5fafdb`.
- The previous installation was copied (not moved) to `/Users/gzq/Library/Application Support/Asterlyn/local-install-backups/diagnostics-20261023-143016.app` before replacement. Installed strict signature verification, version check and byte comparison passed.

## Installed-log acceptance

- Session `session-1792737016995-79660-0` / PID `79660` produced 10 valid JSON records with strictly ordered, unique output sequence numbers and the accepted build ID.
- Observed `application.starting`, `application.native_ready`, `application.frontend_ready`, `application.exiting`, `application.shutdown_dispatched`, and `health.snapshot` during startup and a graceful quit.
- Exit snapshot: dropped **0**, write failures **0**, retry buffered **0**, truncations **0**, persistence available **true**. Its queue count includes records ahead of the final drain and is not an after-exit queue measurement.
- Installed project-open session `session-1792737169524-79968-0` / PID `79968` opened the real Asterlyn checkout and confirmed frontend/native plugin activation trace correlation plus frontend readiness and ordered records. The app was left running from `/Applications/Asterlyn.app`.
- Main-process RSS samples for the initial installed session: 73,952–74,304 KiB; sampled CPU 0.0%. Three samples one second apart are liveness/idle evidence, not a memory regression benchmark or a complete process-tree measurement.

## Accessibility and limits

No new UI controls, dialogs or focus rules were added. Existing native rendered-shell/accessibility smoke passed. Logging itself is validated from files and structured test evidence.

The queue permits 256 ordinary events plus 64 error-reserved slots; retry storage permits 64 events. Metadata preparation bounds depth/nodes/strings, and JSON records have a 32 KiB final cap; heap object overhead is additional. Active instances each retain at most 30 MiB; inactive sessions share 30 MiB, and legacy shared files remain untouched.

Abrupt kill/power loss can lose queued records. Free-form text still requires review before sharing. Windows/Linux runtime behavior, true disk-full/slow-device tests, power-loss durability, and full Gradle refresh acceptance were not inferred from these macOS tests. Whole workflows still follow review/run IDs between command traces.

New handled-error reporting also exposed failures in background `existing_project_directories` validation and an attempted reopen of a previously saved project. Those business paths were not changed or repaired by this logging task. The accepted installed session explicitly opened the current checkout; diagnosing old recent-project entries is a separate follow-up.

## Requested local reinstallation — 2026-10-23 14:38

- Fresh type check, 1,281 script tests, frontend build and current-source native bundle passed.
- Complete ad-hoc bundle signing, strict verification and rendered native smoke passed.
- Archive: `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.19-20261023-143815-macos.app.zip`. SHA-256: `c58eab09086f589548cfe8fd23e018fe9bd43e961b9cafeabab2ffc53aacd184`.
- Installed executable SHA-256: `0b922b7db8712a063ca3fb6340b5e8d1a3fbfb6c43bf1d446566ed549fbb393d`; byte-identical to the accepted signed bundle.
- Previous installation copied to `/Users/gzq/Library/Application Support/Asterlyn/local-install-backups/reinstall-20261023-143815.app` before replacement. The old process was stopped gracefully, including its command-line project argument.
- Installed version `0.1.19`, PID `83649`, build `5b3e03fb91894977523baa00300e053410b6547d-dirty-1792737419458`.
- Session `session-1792737497567-83649-0` confirmed native/frontend readiness and ordered JSON events. The installed app remains running.
