# Asterlyn TypeScript plugin template

This repository template builds one isolated schema-3 Asterlyn plugin package. The example adds a
plain command contribution and requests no host permission.

Before the first Release:

1. replace `dev.example.hello`, `example/asterlyn-plugin-hello`, names, descriptions, and license
   ownership in `manifest.json`, `src/plugin.ts`, `package.json`, and `LICENSE`;
2. keep `manifest.json`, `package.json`, and the exported runtime identity on the same version;
3. download the exact `asterlyn-plugin-sdk-1.10.0.tgz` plus checksum from an Asterlyn Release into
   `vendor/`, then commit both the SDK artifact and `package-lock.json`;
4. declare only the capabilities and permissions the plugin actually uses;
5. run `npm ci && npm run verify`; and
6. push tag `v<version>` only after verification succeeds.

`npm run package:release` creates one deterministic `.asterlyn-plugin.tgz`. `npm run
package:inspect` invokes either `ASTERLYN_PLUGIN_INSPECTOR` or the canonical inspector in
`ASTERLYN_HOST_CHECKOUT`. The included Release workflow pins the oldest compatible host tag and
publishes exactly the inspected package.

Plugin code executes in Asterlyn's supervised plugin-host process. There is no DOM, Tauri, Node,
filesystem, process, network, credential, or shell authority. Host operations are available only
through manifest-admitted capabilities and permissions.

Before adding host authority, read the public [developer
guide](https://github.com/guozhiqiang123/asterlyn/blob/main/docs/plugins/developer-guide.md),
[capability catalog](https://github.com/guozhiqiang123/asterlyn/blob/main/docs/plugins/capabilities-and-permissions.md),
and [diagnostics and migration
guide](https://github.com/guozhiqiang123/asterlyn/blob/main/docs/plugins/diagnostics-and-migration.md).
