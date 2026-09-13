# Ignored preview and select-control validation — 2026-09-13

## Scope

This slice makes the full folder row toggle disclosure, expands Git-ignored directories into their
catalogued descendants, opens ignored text and supported images through a read-only capability, and
replaces every application select's platform chrome with one theme-aware visual wrapper. The native
select remains the focusable control and retains keyboard and operating-system picker behavior.

Ignored files remain outside workspace search, replacement, commit, and save authorization. Their
catalog does not add native watch roots. A selected ignored identity must still be present in the
active window catalog and must still be ignored when Git reauthorizes a read.

## Automated validation

- The frontend suite passed 306 tests, including ignored descendant projection, read-only editor
  state, localization coverage, select ownership, forced-colors behavior, and style ownership.
- TypeScript checking and the production Vite build passed.
- The Rust workspace passed 130 tests. Two real operating-system watcher tests retained their
  existing ignored status and remain native acceptance checks.
- The package was built with Rust 1.88.0 for arm64 macOS. The ad-hoc signed application and a fresh
  archive extraction both passed deep strict signature verification; the executable is arm64 and
  the application reports version 0.1.0.

## macOS package

The acceptance archive is
`target/release/bundle/macos/Asterlyn-0.1.0-arm64-20260913-2118.zip`, 7,570,165 bytes, SHA-256
`b42d821f00dd09cf43f0cb9502836eaec03116687abf3ea4b1fa79e130f165ab`.

The archive is a local ad-hoc preview and is not notarized for distribution. Pointer interaction,
the native select popup, and final dark/light visual review remain manual checks in the user's macOS
desktop session.
