# `@asterlyn/plugin-sdk`

This package contains the public declarative types and constants used to author Asterlyn plugins.
It does not contain host implementation code and does not grant filesystem, process, network,
credential, WebView, or shell access.

The initial public baseline is SDK `1.8.0`, SDK major `1`. Runtime-installable packages additionally
use package schema `2` and plugin-host protocol `1`; those are independent compatibility axes.

## Use

Download `asterlyn-plugin-sdk-1.8.0.tgz` from an Asterlyn GitHub Release, retain its SHA-256, place it
under the plugin repository's `vendor/` directory, and pin it exactly:

```json
{
  "dependencies": {
    "@asterlyn/plugin-sdk": "file:vendor/asterlyn-plugin-sdk-1.8.0.tgz"
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
