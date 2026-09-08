# Asterlyn

Asterlyn is a lightweight, cross-platform developer workspace built around a first-class Git experience. The initial milestone is **Git GUI First**; the product boundary is deliberately broader: editor, language intelligence, build/run/test/debug workflows, extensibility, remote development, and an ecosystem capable of becoming a daily-driver alternative to mature IDEs.

The implementation uses Rust for the native/application core, Tauri 2 for the desktop shell, and CodeMirror 6 for editing and diff surfaces. The web layer is intentionally framework-light so the product can measure and control its own baseline cost.

This is a new implementation. Rebased is used as a behavioral and interaction reference only; Asterlyn does not copy JetBrains source, icons, trademarks, or branded assets.

## Current milestone

M1 builds a usable Git workbench: open a local repository, inspect branch and working-tree state, view changes and history, stage/unstage paths, and create commits. See [`docs/milestones/m1-git-gui-first.md`](docs/milestones/m1-git-gui-first.md).

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
