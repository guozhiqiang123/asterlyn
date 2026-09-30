# Keyboard shortcut management evidence — 2026-09-29

## Scope and result

The unified shortcut system is implemented across command discovery/execution, window dispatch,
custom override persistence, conflict repair, Settings, CodeMirror ownership, xterm arbitration,
localization, and dynamic command-palette/command-center presentation.

The reporting host is macOS on Apple Silicon. Cross-platform normalization is covered by executable
tests; installed Windows and Linux interaction remains a release-platform gate.

## Performance

`node scripts/benchmark-keybindings.mjs` exercises production registry, controller, resolver, and
profile parser code with 5,000 commands, 2,000 effective bindings, and a 255,945-byte profile:

| Measurement | p95 | Budget |
| --- | ---: | ---: |
| Scope-indexed dispatch | 0.001 ms | < 1 ms |
| Settings search/projection | 18.087 ms | < 50 ms |
| Profile parsing | 1.110 ms | < 10 ms |

The fixture contained 1,949 serialized overrides at the near-limit profile size. The benchmark is a
local synthetic regression probe, not a cross-machine product latency claim.

## Safety and lifecycle evidence

- Persisted profiles are versioned, UTF-8 byte-bounded, entry-count-bounded, structurally validated,
  and limited to registered command IDs plus normalized key sequences.
- Invalid or oversized storage falls back to defaults without overwriting the bad input; Settings
  retains an enabled reset path to repair it.
- Exact and prefix conflicts are indexed per overlapping scope and require explicit replacement.
- The window listener captures only matched application commands. Settings/dialog scopes and
  unmatched editor/input events retain their component behavior.
- xterm ignores `keyup` and `keypress` for application dispatch, preventing duplicate invocation;
  non-intercepted input continues to the PTY.
- Store subscriptions, cross-window listeners/channels, window listeners, and chord timers are
  released idempotently.

## Validation

- `npm run check`: passed.
- `npm run test:scripts`: **748 passed, 0 failed**.
- `npm run build`: passed; the main application chunk is **379.44 kB raw / 82.65 kB gzip**,
  below the 500 kB raw gate.
- `cargo test --workspace`: **255 passed, 0 failed, 2 ignored**. The ignored tests require a real
  operating-system watcher backend.
- `cargo fmt --all -- --check`: passed.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed with Clippy 0.1.97.
- `npm audit --omit=dev --audit-level=low`: **0 vulnerabilities**.
- `cargo audit`: **0 known vulnerabilities** and seven existing allowed warnings (six unmaintained
  `proc-macro-error`/`unic-*` dependencies plus RUSTSEC-2024-0429 for `glib` 0.18.5).
- `git diff --check`, frontend dependency/ownership gates, stylesheet gates, and source-size gates:
  passed. `src/app.ts` remains at its reviewed 8,781-line ceiling.

The host used Node.js 26.8.1, npm 11.19.0, Rust/Clippy 1.97.1, and Git 2.48.1 on macOS 15.6.1
(24G90), Apple Silicon.

## Local package and installation

- `npm run tauri -- build --bundles app` produced an arm64 macOS application. The bundle was
  ad-hoc signed with hardened runtime and passed `codesign --verify --deep --strict`; it is not a
  Developer ID signed or notarized release.
- Acceptance archive:
  `target/release/bundle/macos/Asterlyn-0.1.0-arm64-20260929-shortcuts.zip`, **8,859,849 bytes**,
  SHA-256 `2b853014b5d9246a50062b85ab63fd35db4ebcb747ae80b94e3628459befbf08`.
- Packaged and installed executable SHA-256:
  `4936dadca84a244dcf19689a2fd8337cf304088374f4d0900f6967ab0e7db9cd`.
- `/Applications/Asterlyn.app` was replaced through a verified staging copy. The previous
  installation is recoverable at
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20260929-shortcuts-preinstall/Asterlyn.app`.
- The installed application passed strict signature verification, exact executable-hash comparison,
  launch, six-second liveness verification, and the isolated native smoke test. Shortcut workflow
  behavior remains the user's interactive acceptance step.
