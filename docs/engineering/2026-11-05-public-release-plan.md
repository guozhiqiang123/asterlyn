# Public release: 2026-11-05

User authorization covers version upgrades, local commits, annotated tags, ordinary pushes and tracking GitHub Actions through completion. All three source repositories are clean before this release work.

| Order | Release | Gate |
| --- | --- | --- |
| 1 | Host 0.1.28 / SDK 1.14.0 | Synchronized application/core versions; full release quality checks; canonical bundled plugin bytes; reviewed atomic branch/tag Push; four-platform packaging and stable SDK Release |
| 2 | Android Gradle 0.6.8 | Host 0.1.27 minimum, tested against CI baseline 0.1.28; existing AGP compatibility regression; deterministic package, native inspection and isolated parity; stable Release |
| 3 | LSP 0.3.18 | Host 0.1.27 minimum, tested against 0.1.28; actual Gradle schema-1 minimum stays 0.6.3, integrated with bundled 0.6.8; unchanged published SDK bytes; canonical admission/activation and published provenance; stable Release |
| 4 | Independent audit | Remote branch/tag identities; completed Actions; full host asset/checksum set; downloaded plugin digests equal the host's bundled identities; record URLs and limits |

The accepted local plugin versions stay immutable. New metadata/compatibility baselines use new versions. The LSP's private resource-admission transport needs the updated host, so the previous 0.1.25 release baseline must not be advertised for this distribution. No SDK surface change is required; retain the exact published 1.14.0 artifact and digest.

Use CI's exact Node 24.19.0 packaging runtime to avoid known gzip differences from local Node 26. Verify the official Node archive checksum before use. Build each plugin deterministically, pin the resulting archives in the host, and preserve immutable package digests. Plugin CI must validate against the new host tag and LSP may publish only after the host and Gradle stable releases exist.

Publication uses `GitRepository::push_preview_with_tags` and `push_current_with_options` in ordinary/current-branch-tags mode. Before each write, bind clean source, exact HEAD, origin/main, outgoing range and exact tag objects. Independently compare existing remote tag objects so only the authorized new release tag changes remotely. Preserve failed tags and remote history; any failure requires fresh evidence before deciding the next action. No credentials or raw remote URLs enter release evidence.

Previous real-project/manual acceptance remains recorded in the owning repair plans. This release adds compatibility/version/delivery metadata, not a new language engine or permission. Native local packaging follows the canonical full-bundle signature and Contents-only installer flow. CI acceptance is not a claim of complete Android semantic parity across every platform.

## Results

### Rejected initial candidate

The first 0.1.26 / 0.6.7 / 0.3.17 candidate passed isolated checks but native upgrade probing on the user's non-Android workspace exposed an unnecessarily raised Gradle minimum. Its unmatched Gradle activation restored the previous known-good 0.6.6 selection; LSP's newly imposed 0.6.7 requirement then rejected startup. The model protocol remains schema 1 and does not require that new floor: retain the actual 0.6.3 contract rather than making every workspace await a producer update.

The ordinary atomic host Push completed while cancellation was being requested. Independent API verification confirmed source/tag `1aaf620c464f1866af24c02281a23683f0f033d0`; the v0.1.26 Release workflow (41995364636) and Package preview (41995366149) were cancelled before any Release publication. Preserve that remote tag/history. New targets are 0.1.27 / 0.6.8 / 0.3.18 so already admitted local candidate package bytes also remain immutable. Verify the upgrade with a real Android workspace, then restore the user's original host workspace before canonical installation.

The evidence below describes that initial candidate; final publication evidence follows after the corrected native probe.

The initial Core language contracts run also exposed a Windows-only failure in `rejects_uri_aliases_and_escape`: file-URL decoding removes Windows' verbatim prefix while filesystem canonicalization retains it, so comparing the two raw paths rejects a legitimate canonical URI. Compare the canonical path through the same file-URL round trip, retaining containment, regular-file and alias restrictions. Add encoded-space/fragment coverage and run main-branch cross-platform gates before creating the corrected release tag.

Preflight: the pinned Rust formatter and three equivalent let-chain lint corrections were required for the strict release gate. Full Rust workspace tests/strict Clippy, 1,465 script tests, definition/Find rendered checks, native watcher tests, plugin activation/admission and TS/Rust/Android descriptor acceptance pass. SDK bytes remain SHA-256 `3de0a44594d014298b4129c719b84a4544c834966e63c75a090db085fd43e761`.

Clean-checkout packaging identified CRLF/LF differences in two TypeScript notices. The LSP builder now normalizes only those notices and its release verification includes a complete-archive LF/CRLF regression. Canonical plugin digests are finalized after that check; no release tag was created before resolution.

Local gates passed with Rust 1.98.1 and Node 24.19.0: 594 workspace tests, strict all-target Clippy/rustfmt, 1,465 script tests, typecheck/build, definition/Find rendered checks, native watcher checks, generated-contract drift, exact plugin activation, package admission, TS/Rust/Android descriptor acceptance, template and canonical SDK verification.

| Package | Bytes | Canonical SHA-256 |
| --- | --- | --- |
| Android Gradle 0.6.7 | 4,792,226 | `44e03b92ec8272ddd8c816b35d9d76c53aa24af4ac58a340a27e3687f14f13bb` |
| LSP 0.3.17 | 4,667,327 | `7d079a0b7f3575e0e013e490e6c90ab28a26189145c10361caa0941f2982c193` |

Both archives reproduce from clean paths; LSP also reproduces with LF and CRLF notice inputs. Host bundled archives match exactly. Detailed local receipts are in `.artifacts/public-release-20261105-hxl0mmii/`. Native 0.1.26 installation and remote delivery audit follow the frozen source below; remote publication results are pending.

### Corrected candidate local gates

Host 0.1.27 / Gradle 0.6.8 / LSP 0.3.18: all 1,465 script tests, typecheck/build, exact plugin activation and strict Clippy pass. The full portable core gate (core crates, real stdio lifecycle/actors, workspace symbols and native bindings) passes locally after the Windows URI correction. Both plugin verification pipelines pass, including 81 Gradle / 36 LSP tests, canonical admission and full archive LF/CRLF reproducibility. Main-branch Windows/Linux/macOS validation must finish before the new host tag is created.

Canonical archives: Gradle SHA-256 `83a3f6db3e8eb75a6d9576c82a136c4fbffd3b1b758781e0e92261b00ddd8b5c`; LSP SHA-256 `9c4afe0e36ef7402b3cfc7f9a198ee5022d50a580fc708d6e987162387fd4bb3`. SDK remains unchanged. Final local native upgrade and remote publication evidence will be appended here.

### Windows real-process launch correction

Main Core run 41997924370 passes all 56 core tests on Windows, then all three real stdio fixtures terminate during initialization. Their canonical package root uses Windows verbatim paths. The pinned Node 24.19.0 has the upstream namespaced entry-path defect ([nodejs/node#62446](https://github.com/nodejs/node/issues/62446), fixed upstream by [#65378](https://github.com/nodejs/node/pull/65378)). Launch the validated package-relative entry under its already bound package working directory, with Node's `--` separator; retain canonical admission and filesystem containment checks. Apply the same launch convention to the fixed TypeScript profile. Exercise a fixture entry containing a space and leading dash so process launch also proves argument boundaries. Do not weaken the lifecycle gates or change the pinned packaging runtime. Require Windows/Linux/macOS real-process gates on the corrected main before tagging.

The 6aa52604 native candidate passed full signing, actual superboost_pro and restored host-workspace plugin startup probes, Contents-only replacement, and two stored-icon reopen checks. Its installer receipt is `native-0.1.27/installed.json` in the release evidence directory. Rebuild and replace it from the final corrected release source after the Windows launch fix.

Run 41999597208 confirms the launch fix: Windows core (56), real stdio (3) and actor (41) tests pass. Its last failure is evidence counting: the symbols gate required five tests on every OS, although the Unix-only symlink fixture is not compiled on Windows. Bind all four portable fixture names explicitly, require the Unix symlink fixture on Unix, and derive the minimum count from that exact list. This strengthens fixture identity without dropping any platform-applicable test.

Run 42000146403 passes every Windows Rust/stdio/actor/symbol test. The final generated-contract byte check exposes CRLF checkout conversion of the two committed TypeScript outputs. Pin exactly those generated files to `text eol=lf` in `.gitattributes`; retain byte-exact drift comparison and generator output. This is checkout normalization, not a protocol change. Recheck the attributes and generated output locally and rerun all three CI platforms.

### Rosetta resource-accounting correction and final host 0.1.28

Package preview 42000654925 (Intel job 127159596107) catches a real undercount: the x86_64 executable runs under Rosetta on the ARM runner. POSIX observes about 99.75 ms process CPU while the Mach conversion reports 2.39 ms (41.67x lower). Rosetta presents a 1:1 application clock timebase; the kernel's `proc_pid_rusage` counters still use native hardware ticks. XNU exposes the native 64-bit clock frequency through `hw.tbfrequency` ([kernel implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_mib.c)); use that frequency for kernel CPU counters and retain overflow/error checks. The independent POSIX regression must pass for both native ARM and the actual x86_64 binary under Rosetta before another tag. Do not relax or remove the failing test.

Cancel the unpublished v0.1.27 Release run 42001039800 and superseded preview; retain its annotated tag. Final host target becomes **0.1.28**, tested plugin baselines follow that source. Plugin versions remain **0.6.8 / 0.3.18** and the true private-transport minimum stays 0.1.27: the CPU accounting repair changes neither plugin contract nor archive bytes. LSP's actual Gradle schema minimum remains 0.6.3. Revalidate both archive identities before publishing.

The kernel-frequency correction passes all eight plugin-runtime tests as native aarch64 and as the actual x86_64 binary under Rosetta on this development Mac. The previously failing independent POSIX comparison remains unchanged in strictness.

### Accepted final source and local delivery

Host 0.1.28 source `53be69e695ee1aff4804caed537ca62c58308ac1`; SDK stays 1.14.0. All 1,465 script checks, frontend check/build, strict Rust Clippy and formatting pass. The native/Rosetta resource tests pass, the Windows plugin-runtime target compiles, and [Core language contracts 42003537620](https://github.com/guozhiqiang123/asterlyn/actions/runs/42003537620) passes Linux/Windows/macOS. [Package preview 42003537662](https://github.com/guozhiqiang123/asterlyn/actions/runs/42003537662) passes all four distribution targets, including real helper lifecycle and native startup.

Final plugin sources: Gradle `dce93b1238e48d0db0407d8c26922d5c59c4940d`, LSP `a9fc54442c327eb6be7f9c4df2394881fa462fc5`. Final-host [Gradle rehearsal 42004497462](https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/actions/runs/42004497462) and [LSP main verification 42004480128](https://github.com/guozhiqiang123/asterlyn-plugin-lsp/actions/runs/42004480128) pass. Both plugin archives retain the canonical digests above; the host CI SDK archive also matches the exact existing published/vendor 1.14.0 bytes.

Native 0.1.28: complete ad-hoc bundle signature/strict verification; exact plugin health checkpoint; verified ZIP/CRC; canonical Contents-only installation with the original app root inode preserved; two stored-icon starts with frontend readiness. The user's current Gradle-plugin workspace was retained. Accepted/installed executable SHA-256 `85ee107dc16381993fc541c59fadf729cc944b635ce6ef1ade16aea981ade35f`; accepted ZIP SHA-256 `3c93adcdd1e4fcfdefa68965bf61c6c3e079daf8ebc7f7b8c9930f3e7ec3913e`. Evidence: `.artifacts/public-release-20261105-hxl0mmii/native-0.1.28/`.

These are platform delivery and deterministic protocol checks. The local Intel regression runs under Rosetta on ARM; formal Release CI also passes on its native `macos-15-intel` runner. This does not claim a new full Android semantic/manual acceptance on Intel or Windows hardware. Previously recorded real-project/manual acceptance still applies. Final stable Release asset/provenance audit follows below.

### Stable publication and independent audit

| Component | Stable Release | Successful tag workflow |
| --- | --- | --- |
| Host 0.1.28 / SDK 1.14.0 | [v0.1.28](https://github.com/guozhiqiang123/asterlyn/releases/tag/v0.1.28) | [42004232255](https://github.com/guozhiqiang123/asterlyn/actions/runs/42004232255) |
| Android Gradle 0.6.8 | [v0.6.8](https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/releases/tag/v0.6.8) | [42008397028](https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/actions/runs/42008397028) |
| LSP 0.3.18 | [v0.3.18](https://github.com/guozhiqiang123/asterlyn-plugin-lsp/releases/tag/v0.3.18) | [42008868586](https://github.com/guozhiqiang123/asterlyn-plugin-lsp/actions/runs/42008868586) |

All three are confirmed stable, non-draft latest Releases. The host publishes 34 assets: the complete four-platform installer/inspector set, SDK, five component checksum manifests, combined SHA256SUMS and 17 CycloneDX files. Coverage is complete for the 28 distributable/SBOM files; all manifest-listed digests agree with GitHub asset digests. The downloaded checksum files, SDK and published ARM macOS inspector also pass local byte checks. SDK 1.14.0 remains exactly `3de0a44594d014298b4129c719b84a4544c834966e63c75a090db085fd43e761`.

Both plugin Releases were downloaded separately, hashed, compared byte-for-byte with the host's bundled archives and admitted with the inspector downloaded from host v0.1.28. Gradle remains `83a3f6db3e8eb75a6d9576c82a136c4fbffd3b1b758781e0e92261b00ddd8b5c`; LSP remains `9c4afe0e36ef7402b3cfc7f9a198ee5022d50a580fc708d6e987162387fd4bb3`. LSP's published-SDK policy independently passes against the downloaded stable host SDK; its tag workflow also confirms the actual minimum producer Release v0.6.3.

Each source/tag push used the reviewed ordinary boundary, preserving all existing tag objects, followed by independent remote branch, annotated-tag, peeled-source and zero-ahead/zero-behind verification. Candidate tags v0.1.26 and v0.1.27 remain preserved; independent API reads confirm neither has a published Release. Their failures/cancellations are historical evidence, not successful delivery targets.

Detailed audit receipts: `.artifacts/public-release-20261105-hxl0mmii/host-published-audit.json`, the two `*-published-audit.json` plugin receipts, `latest-releases-verified.json`, source/tag request and verification receipts, final Actions snapshots, and native installation/archive evidence. The final closeout is documentation-only; no published source/tag or artifact is rewritten.
