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
   permission, path, expansion, and license admission checks over the downloaded bytes.

## Result and remaining gates

The Release-to-admission and Release-to-runtime paths are proven with real public bytes. Remaining
MKT8D evidence is deliberately separate: clean installed desktop UI through restart and healthy
promotion, stale/offline/rate-limit behavior, hostile package rejection, failed-update quarantine
and rollback, uninstall/reinstall retention, cross-platform installed runtime cleanup, and measured
keyboard/focus/ARIA plus resource behavior.
