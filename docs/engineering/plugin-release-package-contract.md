# Plugin Release package contract

Runtime-installable plugins use package schema `2` and the filename suffix
`.asterlyn-plugin.tgz`. Schema `1` remains a build-time contract for plugins already pinned into a
host release; the marketplace must never treat it as installable.

## Archive layout

```text
manifest.json
LICENSE
runtime/plugin.js
```

Directories are optional archive entries. Every other entry must be a regular UTF-8 file with a
portable relative path. Absolute paths, `..`, `.`, backslashes, drive prefixes, links, devices,
duplicate paths, and case-fold collisions are rejected. The host applies the size and entry limits
from the marketplace plan before extraction.

`runtime/plugin.js` is an example name; `distribution.runtime.entry` is authoritative. It must be a
self-contained JavaScript bundle for plugin-host protocol `1`. It is never imported into the main
WebView.

## Manifest additions

Schema `2` retains the SDK plugin manifest fields and adds:

```json
{
  "schemaVersion": 2,
  "capabilities": ["tasks"],
  "permissions": ["host.tasks.execute"],
  "distribution": {
    "repository": "owner/repository",
    "runtime": {
      "protocol": 1,
      "entry": "runtime/plugin.js"
    },
    "hostCompatibility": {
      "minimum": "0.1.12",
      "maximumExclusive": "0.2.0"
    },
    "license": {
      "expression": "MIT",
      "file": "LICENSE"
    },
    "integrity": {
      "LICENSE": "sha256:<lowercase hex>",
      "runtime/plugin.js": "sha256:<lowercase hex>"
    }
  }
}
```

- `distribution.repository` is the normalized lowercase GitHub source identity and must equal the
  source used to discover the Release.
- `version` must equal the normalized stable Release tag selected by the host.
- `capabilities` and `permissions` are required authority declarations. Unknown required values are
  rejected; a package cannot introduce authority by naming it.
- `distribution.license.expression` must parse as SPDX and the retained license file must be covered
  by the integrity table.
- `distribution.integrity` covers every regular file except `manifest.json` and cannot reference a
  missing or surplus file. The manifest is instead bound by the downloaded Release asset SHA-256.

The native `asterlyn-plugin-package` library is the canonical offline admission implementation.
Repository publication tooling and host installation must use the same rules and fixtures rather
than maintaining a looser JavaScript validator.

Before attaching an asset to a Release, a repository can run the same validator used by the host:

```text
cargo run -p asterlyn-plugin-package --bin asterlyn-plugin-inspect -- \
  <package.tgz> <owner/repository> <release-version> <host-version>
```

Success prints the frozen identity, authority, file hashes, and expanded byte count as JSON;
rejection exits non-zero and prints one bounded reason.
