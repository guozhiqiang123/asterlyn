# Public release plan: 2026-10-30

User authorization covers commits, host version/tag/push, Actions monitoring, and creating the public LSP repository alongside the existing public repositories.

| Stage | Deliverable | Gate |
| --- | --- | --- |
| R0 | Record plan and commit accepted hover removal | Preserve existing acceptance; inspect remaining changes |
| R1 | Host 0.1.25 and SDK 1.14.0 | Version consistency, frontend/script/format checks, reviewed ordinary Push, successful matrix and SDK Release |
| R2 | Android Gradle 0.6.3 | Update CI validation host; canonical admission and isolated activation; publish the LSP dependency |
| R3 | LSP 0.3.11 first public release | Same-name GitHub repository; fixed published SDK/tool provenance; CI without sibling/local-path dependencies; canonical package admission and isolated activation |
| R4 | Delivery audit | Independently verify remote commit/tag, Actions and Release asset digests; record URLs and limits |

Publish the host through GitRepository preview/ordinary Push, without rewriting remote history. Publish LSP only after the compatible host SDK Release succeeds. Development SDK bytes are not evidence of a published artifact. Freeze existing Kotlin/JDT component archives by manifest digests; distribute only verified archives, retaining source/license records and reusable verification scripts.

## First CI result and follow-up

v0.1.23 passed functionality but failed strict Clippy (`items_after_test_module`) in the
analysis worker. Move its test module after production items, retaining identical behavior.
The failed tag remains historical; publish v0.1.24 after local strict Clippy and fresh CI.
SDK stays 1.14.0. Coordinate plugin policy/CI baselines to the successful v0.1.24 Release.

The v0.1.24 quality gate and macOS Apple Silicon package succeeded, but Windows found a test-only
ExitStatus display mismatch (the actual preserved code was correctly 23). Accept the exact native
Windows/Unix display in that test, keep all isolation assertions, and publish v0.1.25. Failed tags
remain historical; SDK stays byte-identical at 1.14.0.

## Completed publication and independent audit

| Repository | Stable Release | Successful Actions | Tagged source |
| --- | --- | --- | --- |
| Host | [v0.1.25](https://github.com/guozhiqiang123/asterlyn/releases/tag/v0.1.25) | [41060664024](https://github.com/guozhiqiang123/asterlyn/actions/runs/41060664024) | `b66d6e787a52` |
| Android Gradle | [v0.6.3](https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/releases/tag/v0.6.3) | [41064460564](https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/actions/runs/41064460564) | `004d873b6b9f` |
| LSP | [v0.3.11](https://github.com/guozhiqiang123/asterlyn-plugin-lsp/releases/tag/v0.3.11) | [41064897573](https://github.com/guozhiqiang123/asterlyn-plugin-lsp/actions/runs/41064897573) | `98be74bb199d` |

All three stable Releases and annotated tag/source identities were independently checked through GitHub APIs.
The host's Windows, Linux, macOS ARM and macOS Intel jobs passed. Its 28 payload/SBOM digests match
`SHA256SUMS` and GitHub asset digests; the remaining six assets are checksum files. Fresh SDK 1.14.0
bytes match the canonical vendored SHA-256:
`3de0a44594d014298b4129c719b84a4544c834966e63c75a090db085fd43e761`.

Fresh plugin downloads match GitHub asset digests and pass canonical native admission against host 0.1.25:

- Android Gradle: 4,790,541 bytes; SHA-256 `3cb6549c1ab9e741fc6cb9393f0056c0269e7786b7ee29a60ff778eeef08f2e7`.
- LSP: 4,662,489 bytes; SHA-256 `f35aa0ffd9b177985f78c94c35ff75819b612d6768b7dd9fe7734eb9bfccb916`.

LSP package size, summary and checksum entries agree. Its publish job additionally downloads the
uploaded draft assets before publishing. Optional Android tools are distributed separately in
[analysis-components-2026-10-30](https://github.com/guozhiqiang123/asterlyn-plugin-lsp/releases/tag/analysis-components-2026-10-30);
all five component Release digests match staged files. Installation is explicit; no automatic tool
fetching or bundled JDK was introduced.

Release CI pins Node 24.19.0 and Rust 1.98.1. Byte-for-byte gzip comparison requires a canonical
clean checkout and the same Node/zlib toolchain. Local Node 26 produced identical normalized tar
bytes but different compressed bytes; use the published checksum above as the delivery identity.

Local acceptance included 1,375 host script tests and 26 LSP unit tests. CI covers native admission
and isolated TS/Rust/Android descriptor activation. It does not establish full real-project Android
LSP behavior on every desktop platform; previously accepted macOS behavior is preserved.
