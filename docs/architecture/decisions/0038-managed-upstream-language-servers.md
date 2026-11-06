# ADR-0038: LSP management plugin and managed upstream language servers

- Date: 2026-11-06.
- Status: **Direction accepted by the user; planned, not implemented.** Exact SDK/native contracts and upstream versions remain pending.
- Execution owner: [LSP management and upstream server plan](../../engineering/2026-11-06-lsp-management-and-upstream-servers-plan.md).

## Context

`dev.asterlyn.lsp` packages TS/JS, Rust and Android Java/Kotlin profiles together, depends globally on the Android Gradle plugin, and carries Android-specific adapters and component requirements. The user wants a lightweight workspace that consumes maintained upstream LSP implementations without maintaining a replacement Java/Kotlin engine. They explicitly chose one management plugin rather than separate language plugins.

## Decision

Retain the plugin identity and repository. The enabled plugin supplies a bounded catalog, recommendations, configuration and installation/uninstallation intents. The native host owns actual network/storage operations, integrity checks, transactional installation, executable provenance, execution approval, documents, processes, resource limits and UI. No plugin gains ambient network, filesystem, shell or process authority.

Opening an eligible editable source may display an installation recommendation in the bottom status bar. A missing-server recommendation performs no download, installation or semantic startup. An already installed eligible server may start on demand under a still-valid exact project approval. Installation and project execution remain separate decisions. Disabling the plugin removes recommendations and automatic activation while preserving ordinary editing and Git.

Upstream servers are tools managed independently of the Asterlyn plugin package, with separate versions, runtimes, install records, use leases and rollback selections. They do not each require an Asterlyn plugin or release repository. Existing plugin-marketplace admission/restart rules continue to govern the manager itself.

Prefer the language's official LSP. If none is usable, research GitHub implementations with Rust implementations first and present evidence for the user's choice. Do not silently choose substitutes or treat a compiler's non-LSP API as an official LSP. Adopt published distributions with provenance, licenses, integrity, platform and resource evidence; never extract assets from installed IDEs.

Build catalog/recommendation and installation foundations first, then migrate Rust, TS/JS and Java/Kotlin in bounded stages. Actual Android variants, modules, unsaved interoperability and resources must pass before retiring accepted behavior. Keep necessary adapters; do not expand custom compiler forks or semantic engines. No new language breadth, workspace-edit authority, remote LSP or multi-server arbitration is implied.

The target removes the manager's global Gradle dependency. Configurations actually consuming its model retain a narrow versioned requirement. ADR-0035 enforcement remains authoritative for legacy packages until a compatible migration replaces it; upstream-owned Gradle/configuration execution is still reviewed even without the existing model provider.

## Compatibility and delivery

This decision amends the future direction of ADR-0034/0035/0036, not shipped wire formats or historical acceptance. F0 defines management authority, runtime profiles, bounds, install state, migration, old-host rejection and conformance. Old execution grants do not authorize a new engine.

Keep one owner for each installation/session fact and reuse existing verified facilities. Core services remain UI/Tauri independent. Distinguish installation from semantic readiness, protect active/rollback resources, and preserve editor buffers when stopping a server.

This documentation change implements no capability, changes no dependency/version, installs no tool and authorizes no publication. Runtime changes follow the corresponding plan stage and acceptance.

## Revisit triggers

Revisit when official servers cannot meet the accepted scope, distribution terms block installation, overlapping providers require feature routing, another transport is needed, or measured costs require a different lifecycle. Record user selection and measured tradeoffs before changing defaults or accepted scope.
