# `@asterlyn/plugin-sdk`

This package contains the public declarative types and constants used to author Asterlyn plugins.
It does not contain host implementation code and does not grant filesystem, process, network,
credential, WebView, or shell access.

The initial public baseline was SDK `1.8.0`; the current additive contract is SDK `1.14.0`, SDK major `1`. Runtime-installable packages additionally
use package schema `3` and plugin-host protocol `1`; those are independent compatibility axes.

SDK `1.12.0` adds the host-owned `rust-analyzer` profile alongside the TypeScript contribution introduced in SDK `1.11.0`. Rust requires host 0.1.21 or later. This canonical SDK artifact is development-only until a compatible host Release publishes it. SDK `1.10.0` replaces runtime-installable package-authored executable/argument declarations with
semantic `hostOperations`. The host owns executable discovery, arguments, validation, timeouts, and
output limits. Legacy schema-2 declarations remain types only for bundled and migration code.

## Use

Download `asterlyn-plugin-sdk-1.14.0.tgz` from an Asterlyn GitHub Release, retain its SHA-256, place it
under the plugin repository's `vendor/` directory, and pin it exactly:

```json
{
  "dependencies": {
    "@asterlyn/plugin-sdk": "file:vendor/asterlyn-plugin-sdk-1.14.0.tgz"
  }
}
```

Import types and constants only from the package root:

```ts
import type {
  SdkPluginActivationContext,
  SdkPluginManifest,
  SdkPluginModule,
} from "@asterlyn/plugin-sdk";

const manifest: SdkPluginManifest = {
  sdkMajor: 1,
  id: "dev.example.plugin",
  version: "1.0.0",
  nameKey: "name",
  descriptionKey: "description",
  localization: {
    defaultLocale: "en-US",
    locales: {
      "en-US": { name: "Example", description: "Example plugin" },
    },
  },
  settings: [],
};

export const plugin: SdkPluginModule = {
  sdkMajor: 1,
  id: "dev.example.plugin",
  version: "1.0.0",
  manifest,
  matches: () => true,
  activate: ({ contribute }: SdkPluginActivationContext) => {
    const disposable = contribute({
      kind: "command",
      id: "hello",
      title: () => "Hello",
      detail: () => "Run the example command",
      execute: () => undefined,
    });
    return { dispose: () => disposable.dispose() };
  },
};
```

The package manifest is the static authority boundary. A runtime can only use capabilities and
permissions that the manifest declares and the host admits. Unknown or incompatible declarations
are rejected before plugin code executes.

See the host repository's [Plugin Release package
contract](https://github.com/guozhiqiang123/asterlyn/blob/main/docs/engineering/plugin-release-package-contract.md)
and public [developer
guide](https://github.com/guozhiqiang123/asterlyn/blob/main/docs/plugins/developer-guide.md),
[capability catalog](https://github.com/guozhiqiang123/asterlyn/blob/main/docs/plugins/capabilities-and-permissions.md),
and [diagnostics and migration
guide](https://github.com/guozhiqiang123/asterlyn/blob/main/docs/plugins/diagnostics-and-migration.md)
for packaging, Release, authority, compatibility, diagnostics, and lifecycle rules.

SDK `1.14.0` adds optional static `dependencies` (`id`, stable numeric `minimum`, optional `maximumExclusive`) with at most 16 required plugins. A runtime package declaring dependencies also requires `pluginDependencies`; this carries lifecycle constraints, not process authority. Enablement atomically enables compatible installed dependencies, without downloading packages or granting execution permission. Enabled consumers lock dependency disable/removal/incompatible selection. Host-bundled dependency requirements also protect legacy rollback selections. This remains an unpublished development artifact.

SDK `1.14.0` adds `modelProviders` (`workspaceModels`, `host.workspace-models.execute`) and `languageServers` (`packagedLanguageServices`, `languageServices`, `host.language-services.execute`). Entries are fixed integrity-covered Node modules; Java version ranges and separately installed components are static declarations. No runtime executable/argv authority is added. `stateBindings` resolve a producer's current window contribution snapshot before native model work. Model payloads stay in sealed native files, outside descriptor callbacks. Server IDs are bounded metadata; the native host admits only a server and selectors declared in that exact verified package. This canonical artifact remains development-only until a compatible host release publishes it.
