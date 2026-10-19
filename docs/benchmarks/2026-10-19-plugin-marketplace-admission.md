# Plugin marketplace admission evidence — 2026-10-19

## Scope

This checkpoint covers MKT4 package download, admission review, safe expansion, immutable storage,
and installation-index recovery. It does not claim external plugin activation; admitted schema-2
packages remain `pendingRuntime` until the supervised runtime and restart recovery gates land.

## Implemented evidence

- The discovered Release snapshot binds repository, source generation, semantic version, exact
  asset name, exact GitHub download URL, byte count, and GitHub SHA-256.
- Native download permits HTTPS only, applies redirect/time/size bounds, then independently checks
  byte count and SHA-256 before archive inspection.
- The schema-2 validator checks archive paths/types/counts/sizes, source and version identity,
  SDK/runtime/host compatibility, SPDX license text, capabilities, permissions, and the per-file
  integrity table without executing plugin code.
- Settings presents host-rendered license, capability, and permission data and requires a separate
  admission confirmation.
- Confirmed files are revalidated, expanded only through `create_new`, and renamed into a
  content-addressed application-data directory. The atomic versioned index records
  `pendingRuntime`; it does not mark the package active.
- A source generation or Release binding change invalidates the review instead of installing stale
  bytes. Cancellation and rejected downloads discard staged archives.

## Verification

- `cargo test -p asterlyn-plugin-marketplace -p asterlyn-plugin-package`
- `cargo check -p asterlyn`
- `npm run check`
- `node --test scripts/plugin-management-view.test.mjs scripts/desktop-protocol.test.mjs`

The native suites include malicious archive fixtures, safe-extraction refusal when the destination
already exists, atomic index reopen, and a proof that admitted versions are not selected active.
