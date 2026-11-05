# Public release: 2026-11-05

User authorization covers version upgrades, local commits, annotated tags, ordinary pushes and tracking GitHub Actions through completion. All three source repositories are clean before this release work.

| Order | Release | Gate |
| --- | --- | --- |
| 1 | Host 0.1.27 / SDK 1.14.0 | Synchronized application/core versions; full release quality checks; canonical bundled plugin bytes; reviewed atomic branch/tag Push; four-platform packaging and stable SDK Release |
| 2 | Android Gradle 0.6.8 | Host 0.1.27 minimum and CI baseline; existing AGP compatibility regression; deterministic package, native inspection and isolated parity; stable Release |
| 3 | LSP 0.3.18 | Host 0.1.27 minimum; actual Gradle schema-1 minimum stays 0.6.3, integrated with bundled 0.6.8; unchanged published SDK bytes; canonical admission/activation and published provenance; stable Release |
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

Preflight: the pinned Rust formatter and three equivalent let-chain lint corrections were required for the strict release gate. Full Rust workspace tests/strict Clippy, 1,465 script tests, definition/Find rendered checks, native watcher tests, plugin activation/admission and TS/Rust/Android descriptor acceptance pass. SDK bytes remain SHA-256 `3de0a44594d014298b4129c719b84a4544c834966e63c75a090db085fd43e761`.

Clean-checkout packaging identified CRLF/LF differences in two TypeScript notices. The LSP builder now normalizes only those notices and its release verification includes a complete-archive LF/CRLF regression. Canonical plugin digests are finalized after that check; no release tag was created before resolution.

Local gates passed with Rust 1.98.1 and Node 24.19.0: 594 workspace tests, strict all-target Clippy/rustfmt, 1,465 script tests, typecheck/build, definition/Find rendered checks, native watcher checks, generated-contract drift, exact plugin activation, package admission, TS/Rust/Android descriptor acceptance, template and canonical SDK verification.

| Package | Bytes | Canonical SHA-256 |
| --- | --- | --- |
| Android Gradle 0.6.7 | 4,792,226 | `44e03b92ec8272ddd8c816b35d9d76c53aa24af4ac58a340a27e3687f14f13bb` |
| LSP 0.3.17 | 4,667,327 | `7d079a0b7f3575e0e013e490e6c90ab28a26189145c10361caa0941f2982c193` |

Both archives reproduce from clean paths; LSP also reproduces with LF and CRLF notice inputs. Host bundled archives match exactly. Detailed local receipts are in `.artifacts/public-release-20261105-hxl0mmii/`. Native 0.1.26 installation and remote delivery audit follow the frozen source below; remote publication results are pending.
