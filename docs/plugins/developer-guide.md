# Asterlyn plugin developer guide

- Status: experimental public baseline
- Host baseline: Asterlyn `0.1.13`
- Plugin SDK: `1.9.0` (SDK major `1`)
- Package schema: `2`
- Plugin-host protocol: `1`

## What a plugin is

An installable Asterlyn plugin is one immutable GitHub Release asset ending in
`.asterlyn-plugin.tgz`. The host downloads and inspects that asset, records its exact SHA-256,
extracts it into application-owned storage, and runs its self-contained JavaScript entry in a
supervised plugin-host process after restart.

A plugin is not a WebView extension and does not receive Node, DOM, Tauri, filesystem, network,
credential, shell, process-handle, or host-layout authority. It contributes plain semantic data and
callbacks. Every host operation crosses a named capability and permission that the package declares
before its code can execute.

## Start from the template

Copy [`templates/plugin-typescript`](../../templates/plugin-typescript) into a new repository. The
copy is intentionally standalone: production dependencies resolve from the vendored Plugin SDK
tarball, never from a sibling Asterlyn checkout.

The vendored tarball is the exact checksum-covered SDK asset from the matching host Release, not a
locally repacked equivalent. Archive bytes can differ across npm versions even when their extracted
files are identical, so host publication verifies the committed canonical archive against the SDK
source and republishes those exact bytes. Plugin repositories must retain that archive and its
lockfile integrity unchanged.

Before the first Release:

1. Choose a permanent reverse-domain plugin ID. Changing it later creates a different installed
   plugin and a different persistence namespace.
2. Replace `example/asterlyn-plugin-hello` with the normalized lowercase GitHub
   `owner/repository`. This must match the repository added in Asterlyn Settings.
3. Keep the same semantic version in `package.json`, `manifest.json`, and the exported runtime
   module. The Release tag must be exactly `v<version>`.
4. Replace the localized name, description, settings, and contribution copy. Plugin text is plain
   text addressed by localization keys; it cannot contain markup or styling.
5. Declare only the capabilities and permissions actually used. See the
   [capability and permission catalog](capabilities-and-permissions.md).
6. Replace the example license owner and retain a license file covered by the package integrity
   table.

The immutable identity tuple is plugin ID, plugin version, repository, SDK major, package schema,
runtime protocol, and package digest. Asterlyn rejects disagreement before activation.

## Manifest ownership

`manifest.json` owns static identity, localization, settings, declarative process/tool definitions,
capabilities, permissions, host compatibility, license, runtime entry, and integrity. The package
script owns generated integrity hashes; do not hand-edit them into the source manifest.

The exported `SdkPluginModule` owns runtime matching, activation, contributions, callbacks, and
disposal. Activation is transactional: if validation or activation fails, none of that attempt's
contributions become visible. Dispose every registered contribution when the plugin is stopped.

Use type-only SDK imports in runtime source unless a bundled value is required. This keeps local
tests executable without asking Node to execute TypeScript from `node_modules`:

```ts
import type { SdkPluginActivationContext, SdkPluginModule } from "@asterlyn/plugin-sdk";

export const plugin: SdkPluginModule = {
  sdkMajor: 1,
  id: "dev.example.plugin",
  version: "1.0.0",
  manifest,
  matches: () => true,
  activate: ({ contribute }: SdkPluginActivationContext) => {
    const command = contribute({
      kind: "command",
      id: "example.hello",
      title: () => "Hello",
      detail: () => "Run the example command",
      execute: () => undefined,
    });
    return { dispose: () => command.dispose() };
  },
};
```

## Localize and configure

Every referenced localization key must exist in the default locale. The host resolves a requested
locale, falls back to the default locale, escapes the result, and owns typography, controls,
spacing, focus, accessibility, and theme. Plugins do not ship host CSS or HTML.

Settings are declarative `boolean` or `enum` values. The host renders and persists them under the
plugin ID. Workspace state is a separate bounded, non-secret, plugin-scoped capability; never use it
for credentials, package bytes, task transcripts, or repository content.

## Match a workspace and contribute features

`matches` receives bounded host evidence and must be deterministic and fail closed. It must not
start work. Use it only to decide whether the plugin applies to the current workspace. Activation
may contribute commands, task providers, workspace tools, execution-target providers, and run-
configuration providers supported by the pinned SDK.

Long-running work remains host-owned. A plugin returns a reviewed task or run plan; the host owns
trust, confirmation, terminal routing, cancellation, status, notifications, artifacts, workspace
generation checks, and cleanup when a workspace, window, or application closes.

## Build and verify

Run from the plugin repository:

```text
npm ci
npm audit --audit-level=high
npm run verify
```

`verify` type-checks, tests, builds a deterministic archive, generates every integrity entry, and
runs Asterlyn's canonical native inspector against the exact Release bytes. Set either:

- `ASTERLYN_PLUGIN_INSPECTOR` to an installed compatible inspector executable; or
- `ASTERLYN_HOST_CHECKOUT` to a compatible Asterlyn source checkout during development.

The provided Release workflow checks out the oldest compatible host tag only for its inspector. The
plugin runtime and dependencies still build from the isolated plugin repository.

Host Releases produced after this contract publish checksum-covered standalone inspector binaries
named `asterlyn-plugin-inspect-<target>` (plus `.exe` on Windows). Until the first such Release is
available, the template's pinned host-tag checkout is the reproducible fallback.

## Publish and add the source

Push exactly one stable tag `v<version>`. The template workflow publishes exactly one matching
`.asterlyn-plugin.tgz`; do not replace bytes on an existing Release. GitHub must report a
`sha256:` digest for the asset.

In Asterlyn, open Settings → Plugins → Marketplace, add the normalized `owner/repository`, refresh,
review the host-owned identity/compatibility/license/permission summary, then install. Activation
occurs after the required restart and healthy-start checkpoint. Installed Settings remains the
authority for enable, disable, update, rollback, diagnostics, and uninstall.

The source repository is public metadata, not a trust bypass. User-added and built-in repositories
use the same discovery, admission, isolation, permission, and lifecycle rules.

## Release and update discipline

- Never reuse a version or replace Release bytes.
- Keep the previous compatible Release available for rollback.
- Treat added authority as a reviewed permission expansion, even when source changes are small.
- Raise the host minimum only when the plugin actually relies on the newer contract.
- Test both the oldest supported host and the current host before tagging.
- Publish migration notes for settings or workspace-state schema changes.
- Keep the runtime bundle self-contained; archive files not declared by integrity are rejected.

See [diagnostics and migration](diagnostics-and-migration.md) for failure phases, compatibility
changes, persisted-data migration, rollback, and support evidence.

## Security and support boundary

Asterlyn may reject, quarantine, disable, or roll back a package without running it. A successful
inspector report proves static conformance, not publisher trust or product quality. Plugin authors
remain responsible for source review, Release immutability, dependency maintenance, user-facing
behavior, and accurately declaring every requested authority.

The authoritative static package rules are in the
[Release package contract](../engineering/plugin-release-package-contract.md). Contract lifecycle
and stability are tracked in the [plugin contract registry](../governance/plugin-contracts.md).
