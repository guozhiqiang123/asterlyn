# Public plugin marketplace acceptance — 2026-10-19

## Scope

This record proves that Asterlyn's public plugin path is no longer limited to bundled fixtures or
local sibling repositories. Two independently versioned public repositories publish immutable
GitHub Release assets and are admitted through the host's production discovery and package
inspection code.

## Immutable Releases

| Plugin | Release | Asset | GitHub digest | Bytes |
| --- | --- | --- | --- | ---: |
| Hello | `v0.1.1` | `dev.asterlyn.hello-0.1.1.asterlyn-plugin.tgz` | `sha256:1fe3c0104950236cb4cf9b36f4b77a1d3a1fdb72cbd66c85079ff8f48505d74d` | 1,780 |
| Android | `v0.5.7` | `asterlyn-plugin-android-gradle-0.5.7.asterlyn-plugin.tgz` | `sha256:ce078cb09e7b282db6b4bb076bbd38a7fd08cbd58194bf2195b0802c422909c1` | 21,685 |

- Hello Release: <https://github.com/guozhiqiang123/asterlyn-plugin-hello/releases/tag/v0.1.1>
- Android Release: <https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/releases/tag/v0.5.7>
- Old failed Hello `v0.1.0` remains immutable evidence of the rejected pre-inspector host baseline;
  it was not retagged or overwritten.

The current host baseline is the immutable
[`v0.1.13` Release](https://github.com/guozhiqiang123/asterlyn/releases/tag/v0.1.13),
published by run `39265351453`. Its quality, dependency-evidence, SDK, Linux, Windows, macOS Intel,
macOS Apple Silicon, and publication jobs all passed. The Release exposes checksum-covered canonical
inspectors for all four target triples and the deterministic SDK artifact:

| Host artifact | SHA-256 |
| --- | --- |
| `asterlyn-plugin-inspect-aarch64-apple-darwin` | `93f52aa537429383f23017d9c274f0ffdd90e3120fc8c6fac069754d054cce16` |
| `asterlyn-plugin-inspect-x86_64-apple-darwin` | `aa4a71c248c8240aed43859b6007ad70313b06a4c5b0fe4cb6fe3644ca492cd9` |
| `asterlyn-plugin-inspect-x86_64-pc-windows-msvc.exe` | `dc325af086a85f6573b2d2099c1c0d9ad4f0cae38b0d6fbd79ef713cbb971ae3` |
| `asterlyn-plugin-inspect-x86_64-unknown-linux-gnu` | `79d09d9203ee3bd991885b78f9adb0bd455d1d51ee436ca4d2d7b0be481e22ce` |
| `asterlyn-plugin-sdk-1.9.0.tgz` | `ec9320f7966e882c2f6079b08e20c8d42801a1cfc8adb0ba3c03df3b1459876e` |

The per-target checksum files, `plugin-sdk.sha256`, and aggregate `SHA256SUMS` agree with the GitHub
asset digests.

## Historical installed macOS baseline

The published arm64 DMG, not a local rebuild, was downloaded and verified at
`sha256:e96fdc00b251f7421676346dfbf61287bc804ce6256d929cc0995d1802fefe2e`. Its mounted application
passed strict deep signature verification, reported `dev.asterlyn.desktop`, an ad-hoc signature,
version `0.1.12`, and an arm64 executable. It then replaced `/Applications/Asterlyn.app` through the
documented recoverable flow.

- mounted and installed executable SHA-256:
  `d88c6807fac22c974e175300318d01eca6b8068103cd59bc11adc823881e028c`;
- installed version: `0.1.12`;
- prior installation backup:
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261019-201227-v0.1.12-marketplace/Asterlyn.app`;
- the installed executable rendered the native shell within the six-second smoke deadline and the
  normal installed process remained running afterward.

This closes artifact-to-installed-shell identity and liveness. It does not claim the remaining
human Marketplace interaction journey through add source, install review, restart, and visible
healthy promotion.

## Executed gates

The Hello Release workflow completed in run `39247280631`. It performed a locked install, static
package inspection against the pinned Asterlyn `v0.1.12` source, activation in the supervised
plugin-host process, command callback invocation, disposal, and Release publication.

The Android `v0.5.7` Release workflow completed in run `39269680042`. It ran all 62 plugin tests,
built the self-contained runtime, validated the exact package against Asterlyn `v0.1.13`, activated
task/device/run contributions in the supervised plugin-host process, disposed the runtime, ran the
SDK 1.9 canonical inspector, and published the Release asset. The earlier immutable `v0.5.6`
workflow used the old `v0.1.12` inspector, which could not prove package-owned tool authority; it is
retained as transitional evidence and was not retagged.

The host live acceptance test was executed with:

```text
cargo test --locked -p asterlyn public_fixture_releases_are_discoverable_downloadable_and_admitted -- --ignored --nocapture
```

It passed for both repositories using the same production functions that:

1. request GitHub's latest stable Release with bounded metadata and redirects;
2. require the configured repository, canonical Release URL, exactly one plugin asset, size, HTTPS
   download URL, and GitHub-provided SHA-256 digest;
3. download the exact asset under the product's size, timeout, redirect, and HTTPS restrictions;
4. compare downloaded size and digest to the discovered Release binding; and
5. run the schema, repository, version, host range, SDK, runtime protocol, integrity, capability,
   permission, path, expansion, and license admission checks over the downloaded bytes;
6. extract each admitted package into an immutable installation directory and persist the exact
   repository/version/digest identity; and
7. cross the restart gate, begin activation, promote the exact version to known-good, disable it,
   and atomically uninstall it from the lifecycle index.

The production discovery resolver was also exercised without network access. A transport failure
and a GitHub `403` with zero remaining requests preserve the previous complete Release binding as
explicitly stale metadata, retain the rate-limit reset time, and do not expose an install action.
The same failures without a previous complete binding retain no version, URL, digest, or other
installable metadata. This is covered by the native `discovery_` tests rather than by changing the
machine's real network state.

The package admission suite passed all nine hostile-input gates: malformed gzip, parent/Windows
paths, links, case-colliding paths, digest mismatch, unknown authority, missing license text,
post-admission file injection, and extracted-package tampering all fail before execution. The
marketplace lifecycle suite passed all fourteen unit/integration gates, including interrupted-start
recovery, failed-update quarantine, exact known-good rollback, atomic uninstall, corrupt-generation
recovery, and bounded retention. Renderer-side activation also proves that a contribution violating
the host contract is reported, marked failed through the runtime lifecycle bridge, removed from the
registry, and its isolated process is stopped.

## Installed manifest and preference acceptance

The installed catalog now reads a bounded management-manifest projection from each immutable
selected package. One invalid package produces one bounded entry diagnostic and cannot remove the
other installed plugins from Settings. The renderer merges these admitted entries with bundled
fallbacks by stable plugin ID, so independently installed plugins provide their own localized name,
description, settings schema, task-authorization copy, workspace-tool metadata, and notification
copy without requiring host source changes.

The exact Android `v0.5.7` and Hello `v0.1.1` Release archives above were downloaded again and
accepted by the updated inspector. Android projected both `en-US` and `zh-CN` localization plus its
declared setting; Hello projected both locales and no settings. Focused desktop tests also prove:

1. strict protocol validation of installed manifest identity and nested schema;
2. admitted external localization is used for plugin notifications;
3. an external manifest independently creates its Settings entry;
4. lifecycle enablement remains only on the installed-package card rather than appearing as a
   second conflicting preference switch; and
5. uninstall or temporary absence retains bounded raw preferences privately, while reinstall
   revalidates every value against the new manifest and restores only still-valid values.

The implementation passed 43 focused renderer/protocol tests, all 11 package-admission tests, the
locked native marketplace/runtime suites, native compilation, TypeScript checking, formatting,
and the real published-package inspection described above.

## Package-owned native tool authority

SDK 1.9 package admission now projects bounded process-query and typed tool-operation declarations
from the immutable package. Before activation, the host registers that authority under the exact
window owner, plugin ID, version, and package digest. Activation failure, disable, uninstall,
restart recovery, window disposal, and application shutdown revoke it. An admitted external
package wins completely over the bundled fallback, so it cannot inherit an executable, query, or
operation that its own manifest omitted.

Focused native tests execute one declared query and one typed operation for a fixture with no host
catalog entry, reject wrong owners and stale identities, prove revocation before process creation,
and prove that an active external Android package cannot fall back to undeclared bundled authority.
The Android `v0.5.7` package declares and passes this same SDK 1.9 path.

The first live acceptance attempt encountered a local LibreSSL handshake interruption while calling
`api.github.com`, before Release metadata was available. The immediate retry passed in 8.34 seconds
for both public repositories and completed discovery, digest-bound download, admission, extraction,
restart recovery, activation, healthy promotion, disable, and uninstall. The transport failure is
therefore recorded as network evidence rather than a package-admission failure.

## Result and remaining gates

The Release-to-admission, native installation-lifecycle, Release-to-runtime, stale-network fallback,
host-rendered installed-manifest management, bounded preference retention, package-owned native tool
authority, and hostile-package rejection paths are proven. Remaining MKT8D evidence is deliberately
separate: clean installed desktop UI through restart and healthy promotion, a deliberately failing
public update, reinstall retention across the complete product path, cross-platform installed
runtime cleanup, and measured keyboard/focus/ARIA plus resource behavior.
