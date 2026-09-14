# Push authentication preflight evidence — 2026-09-13

## Scope and behavior

Push now checks the selected remote before starting a remote process. HTTPS remotes ask Git for an
existing non-interactive credential. When none is available, Asterlyn opens a localized dialog for
the account name and a personal access token, with an SSH alternative. Account passwords are not
accepted because GitHub and many other Git hosts no longer support them for Git operations.

The backend retains the full remote URL. The frontend receives only the remote name, transport,
sanitized host, credential/helper availability, and an optional generated SSH Push URL. A submitted
token is written to `git credential approve` through stdin, its temporary input buffer is cleared,
and no token is added to application state, preferences, repository files, logs, or command-line
arguments. An explicit Save action may configure an installed platform-secure Git credential helper
for that repository. SSH setup changes only the remote's Push URL and preserves its Fetch URL.

The authentication controller owns request identity, modal state, save/configure progress, and stale
completion rejection. Recheck keeps the existing modal mounted while the credential lookup is in
flight, preventing a close/reopen flash. Saving a credential resumes the already reviewed Push
without repeating the same preflight. A later Push failure classified as authentication returns to
the same recovery dialog; network and remote-rejection failures retain separate messages.

## Validation

The reporting host was macOS 14.1.2 (23B92), Apple Silicon, with Node.js 24.19.0, pnpm 11.19.0,
Rust 1.88.0, and system Git. The workspace minimum Rust version was corrected from 1.85 to 1.88
because the existing edition-2024 workspace already uses stable syntax unavailable to 1.85.

- All 302 frontend script tests passed, including protocol shape, localization coverage, modal
  presentation, token non-retention, SSH recovery, helper recovery, recheck stability, and stale
  result rejection.
- TypeScript checking and the production Vite build passed. The main JavaScript output is 468.43 kB
  raw and 108.26 kB gzip; the main stylesheet is 116.05 kB raw and 25.47 kB gzip.
- The Rust workspace passed 130 tests with two operating-system watcher tests intentionally ignored.
  The Git core contributed 69 passing tests, including missing/stored HTTPS credentials, an exact
  SSH-only Push URL mutation, and secret-free URL parsing.
- The current repository's configured helper returned both username and credential without exposing
  either value, and `git push --dry-run origin main` completed successfully. No remote write was
  performed.

## macOS package

The release build produced an arm64 `Asterlyn.app` with a 17,487,104-byte native executable. The
local preview bundle was ad-hoc signed, then verified again after archive extraction with
`codesign --verify --deep --strict`. The extracted executable is arm64 and reports application
version 0.1.0.

The acceptance archive is
`target/release/bundle/macos/Asterlyn-0.1.0-arm64-20260913.zip`, 7,570,416 bytes, SHA-256
`92def56fcc131ddf3c32437451f0908f9378baec07057f93f191297c885f5a34`.

The Codex command environment could compile, sign, archive, and verify the application but could not
perform an interactive macOS launch: its LaunchServices connection returned
`kLSServerCommunicationErr`, and direct AppKit registration aborted for the same unavailable GUI
session. This is recorded as an environment-blocked automated liveness check rather than a passed
window test. Manual launch and Push review in the user's desktop session remain required. The local
archive is an unsigned/ad-hoc preview and is not notarized for distribution.
