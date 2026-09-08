# Product vision

## Mission

Asterlyn should make the common development loop—understand a repository, change code, review the change, run it, and share it—fast, calm, and trustworthy on Windows, macOS, and Linux.

The long-term target is not a miniature IDE with permanently missing pieces. It is a mature developer workspace whose default footprint remains understandable because capabilities are loaded around user intent instead of accumulated into the idle path.

## Primary users

1. Developers who want a polished Git client and project browser today.
2. Developers who want a fast editor with language-aware workflows without adopting a heavyweight IDE process model.
3. Teams that eventually need reproducible tooling, remote workspaces, review workflows, and controlled extensions.

## Product principles

- **Git is a workflow, not a panel.** Working tree, history, branches, review, and conflict resolution share one coherent model.
- **Useful before complete.** Every stage must produce a daily-usable product rather than infrastructure without user value.
- **Pay for capability when it is used.** Language servers, debuggers, indexers, AI, and remote agents are separate processes or lazily activated services.
- **Local-first and inspectable.** Local repositories work without an account or cloud service; consequential actions are visible and reversible where Git permits.
- **Cross-platform behavior, native integration.** Product semantics stay aligned across platforms while installation, keybindings, menus, filesystem behavior, and accessibility respect each OS.
- **Compatibility is a feature.** Workspace metadata and protocols are versioned and migratable. Git remains the repository source of truth.
- **Original product identity.** Rebased may inform interaction study, but Asterlyn owns its information architecture, assets, wording, and implementation.

## Non-goals for the first two years

- Reimplement every IntelliJ inspection, refactoring, debugger, database tool, and framework wizard.
- Publish a stable third-party plugin ABI before internal boundaries have survived real product evolution.
- Build a proprietary Git object database or replace system Git for ordinary repository operations.
- Require sign-in, telemetry, or AI to use local editing and Git workflows.

## Product success

Asterlyn becomes credible when a developer can use it for an entire workday on real projects, not when its feature list resembles another IDE. Retention, task completion, correctness, startup latency, idle footprint, interaction latency, crash-free sessions, and accessibility are all release criteria.

