# Workspace-matched plugin surfaces acceptance

Date: 2026-10-16

Representative workspace: `/Users/gzq/AndroidStudioProjects/FilesRecovery`

Application version: `0.1.8`

## Delivered architecture

- The host supplies every enabled plugin with the existing bounded workspace catalog. Plugins own
  domain matching and activation predicates; they do not inspect arbitrary host paths or control
  host chrome directly.
- Activity visibility is derived from committed contributions rather than plugin IDs. Tasks is
  visible only while at least one enabled, matching plugin has successfully committed a task
  provider.
- Disabling a matching plugin, replacing the workspace, or losing its provider removes Tasks from
  the activity rail. If Tasks is open when availability is revoked, the host closes that panel while
  retaining its persisted activity order.
- Core activities retain their previous available/disabled behavior. The optional Tasks activity
  uses the same host-owned three-state availability policy and remains reusable by future plugin
  surfaces.
- Android / Gradle owns its Gradle-specific rule: the catalog must be complete and untruncated, and
  the workspace root must contain the platform-matching wrapper (`gradlew` on POSIX or
  `gradlew.bat` on Windows). Android evidence enriches quick actions but is not required for a
  normal Gradle project to contribute Tasks.

The ownership decision is recorded in
`docs/architecture/decisions/0028-workspace-matched-plugin-surfaces.md`; the staged delivery is
recorded in `docs/engineering/workspace-matched-plugin-surfaces-plan.md`.

## Acceptance matrix evidence

| Scenario | Evidence/result |
| --- | --- |
| No workspace, plain folder, or build-file-only folder | Tasks hidden by host and plugin tests |
| Wrapper metadata or nested wrapper only | Plugin inactive |
| Complete POSIX catalog with root `gradlew` | Plugin active and provider committed |
| Complete Windows catalog with root `gradlew.bat` | Plugin predicate active in Windows test coverage |
| Wrong-platform wrapper only | Plugin inactive |
| Truncated or malformed catalog | Plugin fails closed |
| Enabled matching plugin contributes a provider | Provider projection changes from 0 to 1; Tasks becomes available |
| Disable and re-enable the matching plugin | Provider projection is verified as `1 -> 0 -> 1` |
| Availability revoked while Tasks is open | Pure layout policy closes Tasks and preserves activity ordering |

The real FilesRecovery root contains both `gradlew` and `gradlew.bat`; therefore the installed macOS
build satisfies the POSIX root-wrapper predicate. Exact rail visibility and pointer interaction are
left for manual WebView acceptance below.

## Cross-repository artifact identity

| Item | Identity |
| --- | --- |
| Plugin repository | `/Users/gzq/PrivateProjects/asterlyn-plugin-android-gradle` |
| Plugin source commit | `e5d9f82` (`feat: match root Gradle wrapper projects`) |
| Plugin release-record commit | `afd0504` (`build: record plugin 0.1.6 artifact`) |
| Plugin version / SDK | `0.1.6` / `1.0.0` |
| Plugin artifact | `asterlyn-plugin-android-gradle-0.1.6.tgz` |
| Artifact size | 26,919 bytes |
| Artifact SHA-256 | `c33033cbe229910db5332c2157aa7cafcdc9fd8910f018a22a46a2a78076da5f` |
| Artifact integrity | `sha512-DrlHj7IzbobVjFqcH2Vfq/nBRR1RbMIEonQjffvxW5xtNGZz5s8U5MeOBe7xep/OqSwFGknAb9YplEajvGyD9A==` |
| Host contract documentation | `722d979` (`docs: define workspace-matched plugin surfaces`) |
| Host activity/runtime implementation | `d7ed37b` (`feat: gate plugin task activity by contributions`) |
| Host plugin rollout | `3a3c55e` (`build: bundle Android Gradle plugin 0.1.6`) |

The host vendors and pins the reviewed tarball and its metadata. Production matching does not depend
on an implicit sibling checkout, and the host contains no Android / Gradle plugin-ID special case.

## Automated validation

| Check | Result |
| --- | --- |
| Android / Gradle `npm run verify` | passed; 45 tests plus type check and build |
| Host focused activity/plugin suites | passed; 47 tests |
| Host `npm run test:scripts` | passed; 1,168 tests |
| Host `npm run build` | passed without changing startup policy |
| Host `cargo test -p asterlyn-git` | passed; 149 tests across unit and integration suites |
| Built application rendered smoke | passed within the 6-second gate |
| Installed application rendered smoke | passed within the 6-second gate |
| Built and installed strict code-sign verification | passed; sealed ad-hoc signature with hardened runtime |

The first linker-only application candidate had no sealed resources and was rejected before
installation acceptance. The final application was deep-signed, strictly verified, installed, and
then smoke-tested. The rejected candidate remains recoverable and is not represented as accepted.

## Local package and installation

| Item | Value |
| --- | --- |
| Accepted archive | `target/release/bundle/macos/Asterlyn-0.1.8-local-2026-10-16-workspace-plugin-matching.app.zip` |
| Archive size | 9,867,937 bytes |
| Archive SHA-256 | `5fe3b7ae87ece652e4e115db7d0f8359884a79588005d4a461804440980493dd` |
| Built/installed executable SHA-256 | `44e690b78669af668c6b07f5bfcf696ad6e0332a4bccea1b4e751b017ee7e1ae` |
| Installation | `/Applications/Asterlyn.app` |
| Running installed process | PID `14940` at acceptance time |
| Previous-app archive | `target/release/bundle/macos/Asterlyn-installed-before-workspace-plugin-matching-2026-10-16.app.zip` |
| Previous-app archive SHA-256 | `b981af23177c1ed30257652cb9957617e00a63cbbc9ad932a4a8707cf2ed1627` |
| Previous-app recoverable copy | `/Users/gzq/.Trash/Asterlyn-before-workspace-plugin-matching-2026-10-16.app` |
| Rejected unsealed candidate | `/Users/gzq/.Trash/Asterlyn-unsealed-rejected-workspace-plugin-matching-2026-10-16.app` |

The installed executable exactly matches the verified accepted build. Windows packaging was not
performed on macOS; platform-specific wrapper selection is covered by the plugin's automated tests.

## Human acceptance boundary

The signed local installation is open and ready for manual interaction acceptance:

1. Open FilesRecovery and confirm Tasks appears in the left activity rail while Android / Gradle is
   enabled.
2. Disable Android / Gradle in Settings and confirm an open Tasks panel closes and its rail entry
   disappears; re-enable it and confirm the entry returns in its previous order.
3. Open a plain folder or a folder that has only Gradle build files and confirm Tasks does not appear.
4. Open an ordinary non-Android Gradle wrapper project and confirm Tasks appears.

These pointer and rendered-visibility checks are intentionally not claimed by shell smoke tests. If
rollback is needed, quit Asterlyn, move `/Applications/Asterlyn.app` aside, and restore the retained
previous-app archive or recoverable Trash copy above.
