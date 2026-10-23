# Asterlyn Repository Instructions

These instructions apply to the whole repository.

1. Start discovery at `docs/README.md` and update the owning document with architecture, behavior, milestone, or workflow changes.
2. Preserve the dependency direction documented in `docs/architecture/overview.md`: product/domain code must not depend on Tauri or a concrete UI framework.
3. Treat Git as the source of truth. Never invent a parallel repository state database.
4. Invoke Git without a shell, use stable machine-readable output where available, and keep mutating operations explicit and auditable.
5. Keep branding in the presentation/configuration boundary. Core crate, protocol, and persisted-data names must remain product-neutral where practical.
6. Do not extract or copy source code, icons, fonts, or branded assets from Rebased, Android Studio, or another installed product. A standalone open-source dependency may be adopted only from its published distribution after its license, attribution, version, integrity, and package impact are recorded.
7. Every milestone closes only with recorded acceptance evidence, including functionality, performance, memory, accessibility, and known limitations.
8. Prefer focused tests first. Run `npm run check`, `npm run build`, and `cargo test -p asterlyn-git` for changes that touch their respective areas.

## Local bug-fix delivery

After each bug fix in this repository passes its required checks, create a fresh native package and replace the existing local Asterlyn installation. Codex verifies the artifact and performs the installation. If the app is running, stop it before replacement and relaunch it afterward; the user has authorized this without a separate shutdown confirmation. Verify the installed bundle matches the accepted build, and never install an older bundle after a failed build.

On macOS, follow the ordered canonical flow in `docs/engineering/local-build.md`: ad-hoc sign the complete `.app` bundle after Tauri bundling, require strict bundle verification before archive or installation, retain a recoverable previous installation during replacement, and compare the installed executable with the accepted bundle. A linker-only Mach-O signature is never sufficient package evidence.

Use `node scripts/install-macos-app.mjs --source <accepted-signed.app> --evidence <json>` for local replacement. Backups must be verified ZIP archives; never retain unpacked `.app` or `.app.backup-*` backups. Never move, rename, delete/recreate, or replace the installed `.app` root: the installer atomically exchanges only `Contents` to preserve icon/bookmark identity. Acceptance must include quitting and reopening through the stored icon bookmark and checking frontend readiness from the installed log. Direct executable or explicit-path launch alone is insufficient. Do not reset the global LaunchServices database or Launchpad layout.
