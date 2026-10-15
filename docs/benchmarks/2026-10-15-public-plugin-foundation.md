# Public plugin foundation acceptance

Date: 2026-10-15

Representative workspace: `/Users/gzq/AndroidStudioProjects/FilesRecovery`

Application version: `0.1.8`

## Delivered foundation

- ADR-0023 defines the public direction without pretending that arbitrary runtime installation is
  already safe. Plugins own static identity, plain-text localized copy, settings schemas, detection,
  and bounded contributions; the host owns admission, validation, management UI, persistence,
  capabilities, lifecycle, execution, diagnostics, update, and rollback.
- Plugin SDK `1.1.0` adds a declarative localization contract and shared resource ceilings while
  keeping SDK major 1 and retaining the no-DOM/no-Tauri/no-filesystem/no-process boundary.
- The host validates locale tags, default-catalog presence, scoped keys, values, referenced Settings
  messages, counts, lengths, and total characters before adapting a plugin. It clones and freezes
  accepted catalogs and isolates an invalid module from healthy modules during catalog adaptation.
- Settings resolves exact application locale, then plugin default locale, then the visible key. The
  host continues to render and escape every value; plugins cannot contribute markup or override
  generic host copy.
- Android/Gradle now owns its English and Simplified Chinese name, description, and task-presentation
  strings. No `plugins.androidGradle` localization key remains under host `src/`.
- Android/Gradle's static `manifest.json` is the executable module's identity source. Standalone
  tests require its ID/version, package-manager version, module identity, SDK dependency, settings
  message references, and locale catalogs to agree.
- Localization validation and the complete plugin implementation remain lazy production chunks.
  The existing 500,000-byte application startup-code policy passed without raising its limit.

## Resource contract

| Bound | Limit |
| --- | ---: |
| Locales per plugin | 16 |
| Locale tag | 35 characters |
| Messages per locale | 512 |
| Message key | 128 characters |
| Message value | 4,096 characters |
| Total locale text | 262,144 characters |

The Android/Gradle package uses 2 locales, 12 messages, and 594 counted locale/key/value characters.
Catalogs are copied and frozen once at the host adapter boundary, then carried by immutable
management snapshots; locale lookup is synchronous constant-time property access.

## Cross-repository identity

| Item | Identity |
| --- | --- |
| Host documentation decision | `19a6ee7` (`docs: define public plugin foundation`) |
| Host SDK contract | `6a03660` (`feat: define plugin localization contract`) |
| Plugin source | `5c96f46` (`feat: make plugin package self-contained`) |
| Plugin release record | `b6d3c19` (`build: record plugin 0.1.3 artifact`) |
| Host integration | `a8f55a9` (`feat: enforce plugin-owned localization`) |
| Plugin / SDK version | `0.1.3` / `1.1.0` |
| Plugin artifact size | 25,861 bytes |
| Plugin artifact SHA-256 | `f0455461267d3f74e7df67fc0a8ff1be220a615aa61b36844a937808957f1846` |
| npm integrity | `sha512-BkENTs6Xd59PCZ9UtQGQoxjdUjkuNKQUofPyQ/WabBhBp0H2FS9bOU4SmwwBSTkrxqSjK60yPHmQsndisVJ5FA==` |

The host retains the prior 0.1.0, 0.1.1, and 0.1.2 artifacts for dependency rollback and resolves
0.1.3 only through the checked-in package path and lockfile integrity.

## FilesRecovery evidence

The real workspace was queried with the plugin's exact discovery command:

```text
./gradlew tasks --all --console=plain --no-daemon --no-scan
```

| Measurement | Result |
| --- | ---: |
| Wall time | 12.93 seconds |
| Gradle output | 1,364,975 bytes / 16,032 split lines |
| Runnable tasks | 15,980 |
| Modules | 9 |
| Semantic collection nodes | 16,049 |
| Task leaves | 15,980 |
| Missing task references | 0 |
| Collection truncated | no |

The root entries remain `Tasks`, `app`, `clean`, `files`, `files-private`, `launcher-demo`,
`launcher-minus-one`, `video`, and `viewbinding`. The 0.1.3 parser and collection builder therefore
preserve the same complete real-project behavior after moving metadata and copy into the package.

## Automated and packaged validation

| Check | Result |
| --- | --- |
| Android/Gradle `npm run verify` | passed; type check, 41 tests, ESM build |
| Host focused plugin/localization/artifact suites | passed; 57 checks in the complete focused run |
| Host `npm run test:scripts` | passed; 1,125 tests |
| Host `npm run check` | passed |
| Host `npm run build` | passed; 649 modules and startup-code hard gate |
| Native `cargo test -p asterlyn` | passed; 93 tests, 2 OS watcher probes ignored by design |
| Built app strict code-sign verification | passed; ad-hoc hardened-runtime bundle |
| Built executable rendered smoke | passed within 6-second gate |
| Built executable + FilesRecovery | rendered successfully |
| Installed app strict code-sign verification | passed |
| Installed app + FilesRecovery | rendered successfully |

The package validation covers exact/default/key fallback, catalog detachment and deep freezing,
canonical locale tags, invalid shapes/keys/control characters, missing referenced messages, every
resource ceiling, Chinese rendering, HTML escaping, package identity parity, artifact digest, and
invalid-module isolation.

## Performance, memory, and accessibility

- The installed root process sampled at 65,360 KiB RSS and 0.0% CPU after FilesRecovery reached its
  idle rendered state. This is a point sample, not a cross-platform process-tree benchmark.
- The localization payload is 594 counted characters and remains under the 262,144-character cap;
  no per-render clone or Gradle rediscovery was added.
- The plugin implementation and 2.31 KiB minified localization validator are lazy chunks. The host
  did not increase its startup-code limit to admit this feature.
- Plugin copy still occupies host-owned headings, descriptions, labels, select controls, ARIA
  labels, textual lifecycle states, and bounded diagnostic alerts. Chinese and injected-markup
  fixtures verify that resolved values retain the same semantic and escaping structure.
- Rendered smoke proves the built and installed WebView expose the application shell. Final visual
  language switching, focus placement, and screen-reader reading order remain human acceptance
  items rather than claims made by the smoke probe.

## Local package and rollback

| Item | Value |
| --- | --- |
| Archive | `target/release/bundle/macos/Asterlyn-0.1.8-local-20261015-public-plugin-foundation.app.zip` |
| Archive size | 9,827,266 bytes |
| Archive SHA-256 | `127d83eaa97fce275fc1860efa7b77359739adce1335fc76132b3b7e6ad18f5e` |
| Built/installed executable SHA-256 | `62c47fca6e866824045770c8a6ac16495704559694ed53ad9adfcef37af51998` |
| Installation | `/Applications/Asterlyn.app` |
| Previous-app backup | `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261015-public-plugin-foundation/Asterlyn.app` |

The installed executable exactly matches the accepted build. Asterlyn was reopened with
FilesRecovery after installation for manual acceptance.

## Human acceptance and known limits

1. In English and Simplified Chinese, open Settings → Plugins and confirm Android/Gradle name,
   description, setting label/description, and both presentation options are translated.
2. Use the Tasks header Settings action and confirm focus lands on Task presentation.
3. Switch Full Tasks / Quick Actions and Tree / Flat, then verify cached task data is reused and full
   `:module:taskName` identities remain visible.
4. Disable and re-enable Android/Gradle and verify only its contributions disappear and return.

External plugin installation is not yet exposed. PPF5–PPF8 still require a capability/permission
catalog, signed static package admission, safe extraction and immutable storage, code/process
isolation, atomic update/rollback, revocation, developer tooling, and ecosystem policy. A project
manifest cannot install or auto-enable code.
