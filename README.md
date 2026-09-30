# Asterlyn

Asterlyn is a lightweight, cross-platform developer workspace built around a first-class Git experience. The initial milestone is **Git GUI First**; the product boundary is deliberately broader: editor, language intelligence, build/run/test/debug workflows, extensibility, remote development, and an ecosystem capable of becoming a daily-driver alternative to mature IDEs.

The implementation uses Rust for the native/application core, Tauri 2 for the desktop shell, and CodeMirror 6 for editing and diff surfaces. The web layer is intentionally framework-light so the product can measure and control its own baseline cost.

This is a new implementation. Rebased is used as a behavioral and interaction reference only; Asterlyn does not copy JetBrains source, icons, trademarks, or branded assets.

## Current milestone

M1 builds a usable Git workbench: open a local repository, inspect branch and working-tree state, view changes and history, stage/unstage paths, and create commits. See [`docs/milestones/m1-git-gui-first.md`](docs/milestones/m1-git-gui-first.md).

## Downloads

Installers for Windows x86_64, macOS Apple Silicon/Intel, and Linux x86_64 are published on the
[`Releases`](https://github.com/guozhiqiang123/asterlyn/releases/latest) page. Each Release includes
`SHA256SUMS` and CycloneDX dependency manifests.

The first public distribution intentionally uses no commercial platform certificate. Windows may
show an unknown-publisher warning. The macOS application is ad-hoc signed but not notarized, so its
first launch may require explicit approval in **System Settings → Privacy & Security**. These limits
are also stated on every Release; a `.sig` or checksum must not be mistaken for platform publisher
trust.

## Repository map

- `crates/asterlyn-git`: UI-independent Git adapter and parsers.
- `src-tauri`: thin desktop command adapter.
- `src`: TypeScript UI and CodeMirror surfaces.
- `docs`: product, architecture, design, engineering, and governance records.

Start with [`docs/README.md`](docs/README.md).

After building the desktop binary, a repository can be opened directly:

```bash
target/release/asterlyn /path/to/repository
```

On macOS, the production startup regression can be checked end to end with:

```bash
npm run test:native:rendered:build
```

Unlike the cross-platform liveness smoke, this check inspects the native window and fails when the
process stays alive but the application shell remains blank. macOS may request Accessibility access
for the terminal or automation host running the check.
