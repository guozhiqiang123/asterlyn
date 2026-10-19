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
| Android | `v0.5.5` | `asterlyn-plugin-android-gradle-0.5.5.asterlyn-plugin.tgz` | `sha256:cc268ae877b666823c949638a57123f273baaee0667a74b39550b56d6e446522` | 21,643 |

- Hello Release: <https://github.com/guozhiqiang123/asterlyn-plugin-hello/releases/tag/v0.1.1>
- Android Release: <https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/releases/tag/v0.5.5>
- Old failed Hello `v0.1.0` remains immutable evidence of the rejected pre-inspector host baseline;
  it was not retagged or overwritten.

The host baseline is the immutable
[`v0.1.12` Release](https://github.com/guozhiqiang123/asterlyn/releases/tag/v0.1.12),
published by run `39247230836`. Its quality, dependency-evidence, SDK, Linux, Windows, macOS Intel,
macOS Apple Silicon, and publication jobs all passed. The Release exposes checksum-covered canonical
inspectors for all four target triples and the deterministic SDK artifact:

| Host artifact | SHA-256 |
| --- | --- |
| `asterlyn-plugin-inspect-aarch64-apple-darwin` | `69171677d79f5d61594f1ee70e7c0b7b94624fe38ef3f8bf2dce1b047485292d` |
| `asterlyn-plugin-inspect-x86_64-apple-darwin` | `01c8f9a8ccce2a566c435c0d9d145328e583fa95e42d39733fd06b464232a84f` |
| `asterlyn-plugin-inspect-x86_64-pc-windows-msvc.exe` | `58f8dff7edd9e10297d2728ab993ae1fc346c244133c35a7ab78bbf9843305b6` |
| `asterlyn-plugin-inspect-x86_64-unknown-linux-gnu` | `a28b307aaa6623c2f4d571aed567c350cec7b94e60d21b867ef241b7ebadc195` |
| `asterlyn-plugin-sdk-1.8.0.tgz` | `2e53f631f7e344ed8e4a8071ef3ce2ce6a417b5c26dc61933f4e08171e5dc83c` |

The per-target checksum files, `plugin-sdk.sha256`, and aggregate `SHA256SUMS` agree with the GitHub
asset digests.

## Installed macOS baseline

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

The Android Release workflow completed in run `39247280676`. It ran all 62 plugin tests, built the
self-contained runtime, inspected the exact package, activated task/device/run contributions in the
supervised plugin-host process, disposed the runtime, and published the Release asset.

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

## Result and remaining gates

The Release-to-admission, native installation-lifecycle, Release-to-runtime, stale-network fallback,
and hostile-package rejection paths are proven. Remaining MKT8D evidence is deliberately separate:
clean installed desktop UI through restart and healthy promotion, a deliberately failing public
update, reinstall retention across the complete product path, cross-platform installed runtime
cleanup, and measured keyboard/focus/ARIA plus resource behavior.
