# Bundled TypeScript/JavaScript language-service package

The development host bundles the sealed first-party `dev.asterlyn.lsp` package offline. It is
admitted through the same schema-3 inspection, extraction, content-digest and immutable-tree route
as the bundled Android plugin; it is not loaded from a workspace path or downloaded at startup.

| Field | Value |
| --- | --- |
| Package | `src-tauri/resources/plugins/asterlyn-plugin-lsp-0.1.0.asterlyn-plugin.tgz` |
| Size | 4,579,083 compressed bytes |
| SHA-256 | `2a3cec68eb06fd13ece09f3935e15fda30ef853ee4d240c4c3bf9d1e82cbe6d9` |
| Identity | `dev.asterlyn.lsp` / `0.1.0` |
| Repository binding | `guozhiqiang123/asterlyn-plugin-lsp` |
| SDK | Host-provided canonical SDK 1.11.0 artifact |
| Host development compatibility | 0.1.20; no published Release is implied |

The archive contains the authority-free runtime descriptor and integrity-covered TypeScript server
assets. `typescript-language-server` 6.0.2 is Apache-2.0; TypeScript 5.9.3 is Apache-2.0. Original
license and third-party notice files are retained in the archive. The selected TypeScript package
was used because TypeScript 7.0.2 does not contain the required `lib/tsserver.js` layout.

Installation admits and seals the package tree but does not start Node or any language server.
Language-service execution remains disabled until explicit host execution approval and native
session lifecycle checks. The contribution requests only `languageServices` and
`host.language-services.execute`; it has no workspace process, filesystem, network or arbitrary
command authority. Offline startup must remain usable if the package is malformed or unavailable.
