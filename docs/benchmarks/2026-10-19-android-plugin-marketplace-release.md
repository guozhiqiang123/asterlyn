# Android plugin marketplace Release evidence — 2026-10-19

## Scope

This checkpoint uses the independently maintained Android/Gradle plugin as the first real online
marketplace source. It verifies that the plugin repository publishes everything the host needs for
Release discovery, static review, safe download, and MKT4 admission. It does not claim that an
external plugin can already be activated: admitted packages remain `pendingRuntime` until MKT5–MKT7
provide the isolated runtime, restart promotion, and rollback lifecycle.

## Published artifact

- Repository: `guozhiqiang123/asterlyn-plugin-android-gradle`
- Plugin commit: `57000dc feat(release): publish marketplace plugin package`
- Release/tag: [`v0.5.4`](https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/releases/tag/v0.5.4)
- Workflow: [`39206762805`](https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/actions/runs/39206762805)
- Asset: `asterlyn-plugin-android-gradle-0.5.4.asterlyn-plugin.tgz`
- GitHub size: `21642` bytes
- GitHub SHA-256: `e8110f942f17288be754c1d6b2236657b5c1ab22e6478065a6834e2035a875b0`

The Release workflow checks the tag/package version identity, installs locked dependencies, runs
TypeScript and 62 plugin tests, builds a self-contained runtime, creates the archive, invokes the
host's canonical package inspector, uploads the exact inspected archive, and publishes one stable
Release asset. The dependency audit reported no high or critical vulnerability.

## Host-store acceptance

The host's immutable first-party source points at the repository above. A live latest-Release query
returned one stable, non-draft package asset. The downloaded bytes matched GitHub's SHA-256, and the
canonical host inspector accepted the online archive with:

- plugin identity/version: `dev.asterlyn.android-gradle` / `0.5.4`;
- source repository: `guozhiqiang123/asterlyn-plugin-android-gradle`;
- runtime entry: `runtime/plugin.js`;
- license: `MIT`, with matching packaged license text;
- host range: `>=0.1.11` and `<0.2.0`;
- declared capabilities: workspace catalog, tasks, task cache/authorization, process queries,
  tool operations, workspace state, execution targets, and run configurations;
- declared permissions: workspace catalog read, task discovery/execution/cache, process query,
  tool execution, workspace state, and execution-target read;
- expanded package size: `88673` bytes.

This supplies every field currently consumed by Marketplace discovery and the host-owned install
review. The source adapter tests cover repository normalization, spoofed URLs, ambiguous assets,
missing digests, draft/prerelease rejection, stale-cache behavior, and downgrade prevention. The
package tests cover unsafe archive entries, bounds, compatibility, integrity, immutable expansion,
and atomic installation-index recovery.

## Result and remaining gate

The first real GitHub source is complete through MKT4: it can be discovered, inspected, reviewed,
downloaded, admitted, and stored without executing plugin code. The store must continue to label it
`pendingRuntime`. A claim that the plugin is installed and runnable is blocked until MKT5–MKT7 add
the supervised external runtime, restart coordination, healthy-start promotion, rollback, disable,
and uninstall/fallback acceptance.
