# Architecture audit remediation evidence — 2026-09-29

## Scope and result

This checkpoint closes AR1–AR5 from the architecture audit remediation plan against baseline
`2b225f2`. The implementation is locally accepted: credential persistence, workspace mutation
recovery, terminal backpressure, canonical identity, global lifecycle disposal, and source ownership
now have executable boundaries and regression coverage.

The reporting host was macOS 15.6.1 (24G90), Apple Silicon, with Node.js 26.8.1, npm 11.19.0,
Rust 1.97.1, and Git 2.48.1.

## Safety and recovery evidence

- HTTPS credential commands reset the Git helper chain and install only a discovered supported
  platform helper. Repository-local plaintext configuration is ignored, secret-bearing buffers are
  cleared, and helper output is replaced by fixed failures. Credential policy is now a private
  388-line capability instead of mixed into `repository.rs`; that file fell from 10,599 to 10,316
  lines.
- Version-2 workspace mutation manifests retain complete reviewed inventories and limits. Copy and
  move expose only actions supported by observed current state; partial Trash is explicitly
  acknowledged. Rollback/finalize revalidate full relocated inventory, recovery identity, schema,
  source holds, and workspace root under the shared write registry.
- Thirteen mutation-execution tests cover unchanged and externally changed destinations, intact
  held-source rollback, move finalization, partial Trash, idempotency, symbolic-link refusal, and
  fail-closed unknown schemas. The held-source fault test found and fixed a location-property bug:
  moving reviewed data into the application's hidden hold directory no longer invalidates its
  content identity.
- Recovery is discovered again after restart in the Files feature. Dirty editor paths block
  destructive resolution, backend-supported actions are authoritative, and a successful action
  reconciles editor paths, the project catalog, and working-tree state before success is shown.

## Terminal and lifecycle evidence

- Each session owns a native output queue capped at 256 KiB and 16 frames; one delivery frame is at
  most 64 KiB. Pressure discards only a bounded prefix, reports the exact omitted-byte count once,
  and retains a bounded tail. Output and truncation share monotonic sequence numbers.
- Event delivery failure terminates the child process. Reader, output-pump, and process-monitor
  startup failures also kill the child rather than leaving a detached session. Deterministic queue
  pressure, startup pressure, explicit truncation, sequence gaps, close/restart, canonical
  `/var`/`/private/var`, and symbolic-link aliases are covered.
- Repeated application initialization disposes the prior runtime. `AsterlynApp`,
  `ThemedSelectHost`, pagehide ownership, six global select listeners, and its mutation observer all
  have idempotent disposal coverage.

## Validation

- `npm run test:scripts`: **702 passed, 0 failed**.
- `cargo test --workspace`: **251 passed, 0 failed, 2 ignored**. The ignored tests require a real
  operating-system watcher backend and remain native acceptance checks.
- `npm run check`: passed.
- `npm run build`: passed; the main application chunk is **368.99 kB raw / 80.30 kB gzip**, below
  the 500 kB raw gate. No same-host baseline rebuild was made, so this checkpoint records the
  absolute result and makes no bundle-movement claim.
- `cargo fmt --all -- --check`: passed.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed with Clippy 0.1.97.
- Frontend and Rust ownership/dependency gates: passed. `src/app.ts` remains at its non-growing
  8,781-line ceiling; every production Rust source above 1,500 lines is inventoried.
- `npm audit --omit=dev --audit-level=low`: **0 vulnerabilities**.
- `cargo audit`: **0 known vulnerabilities** across 479 locked dependencies. RustSec reported seven
  allowed warnings: six unmaintained `proc-macro-error`/`unic-*` crates and the
  `glib` 0.18.5 iterator-unsoundness advisory RUSTSEC-2024-0429.
- `git diff --check`: passed.

## Remaining release limits

- The seven RustSec warnings are dependency-maintenance follow-ups rather than reported
  vulnerabilities. In particular, the `glib` advisory remains relevant to Linux desktop dependency
  review even though this macOS validation did not execute that stack.
- Linux and Windows compilation/interaction, installed macOS terminal pressure, system Trash, and
  real credential-manager interaction remain CI or release-candidate gates. This local result does
  not replace those platform checks or the two ignored native watcher tests.

## Local macOS package and installation

- `npm run tauri -- build --bundles app` completed from the accepted working tree. The final local
  bundle was ad-hoc signed with hardened runtime and passed `codesign --verify --deep --strict`.
  It is an arm64 preview, not a Developer ID signed or notarized release.
- Acceptance archive:
  `target/release/bundle/macos/Asterlyn-0.1.0-arm64-20260929.zip`, 8,749,661 bytes, SHA-256
  `35c9d9c08a804570964fc0da2af7bafa3aa3e94bdcdbbbef9cb021da82b893d1`.
- The packaged executable SHA-256 is
  `1007c7b5de3f1bc3dba46a37e0f2d5cf223b2138e2fc6490d9b44f394fd26d02`.
- `/Applications/Asterlyn.app` was replaced only after a verified staging copy matched that hash.
  The previous installation is recoverable at
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20260929-110624/Asterlyn.app`.
- The installed bundle passed the same strict signature check, matched the packaged executable hash,
  launched successfully, and remained alive for the six-second local liveness observation. Visual
  and workflow behavior remain the user's interactive acceptance step.
