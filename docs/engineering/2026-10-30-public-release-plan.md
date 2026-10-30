# Public release plan: 2026-10-30

User authorization covers commits, host version/tag/push, Actions monitoring, and creating the public LSP repository alongside the existing public repositories.

| Stage | Deliverable | Gate |
| --- | --- | --- |
| R0 | Record plan and commit accepted hover removal | Preserve existing acceptance; inspect remaining changes |
| R1 | Host 0.1.23 and SDK 1.14.0 | Version consistency, frontend/script/format checks, reviewed ordinary Push, successful matrix and SDK Release |
| R2 | Android Gradle 0.6.3 | Update CI validation host; canonical admission and isolated activation; publish the LSP dependency |
| R3 | LSP 0.3.11 first public release | Same-name GitHub repository; fixed published SDK/tool provenance; CI without sibling/local-path dependencies; canonical package admission and isolated activation |
| R4 | Delivery audit | Independently verify remote commit/tag, Actions and Release asset digests; record URLs and limits |

Publish the host through GitRepository preview/ordinary Push, without rewriting remote history. Publish LSP only after the compatible host SDK Release succeeds. Development SDK bytes are not evidence of a published artifact. Freeze existing Kotlin/JDT component archives by manifest digests; distribute only verified archives, retaining source/license records and reusable verification scripts.
