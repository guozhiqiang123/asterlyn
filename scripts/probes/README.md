# JVM language-service developer probes

These tools are **not application runtime code** and do not add a plugin permission.
They execute the explicitly configured executable. A language server may evaluate the
project's Gradle scripts, resolve dependencies, start daemons, or write metadata even
when `offline` or `autobuild=false` is configured. Use an owned, disposable worktree;
record the original commit/status first. Do not run an unreviewed server on the user's
active checkout. Do not stop shared Gradle daemons.

1. Download an exact standalone distribution from its publisher, verify its archive
   digest and license, and record the version, runtime JDK and build JDK separately.
   The probe does not download or install tools or obtain consent on the user's behalf.
2. Prepare a private, untracked configuration file (maximum 64 KiB). Configure scoped
   server/config/cache/Gradle directories. Supply credentials through explicitly named
   environment variables when necessary; never commit them in configuration or evidence.
   No environment variables are inherited unless listed in `forwardEnvironment`.
3. Run `node scripts/probes/jvm-language-service-probe.mjs /absolute/probe.json /absolute/summary.json`.
   This may take up to five minutes; requests and shutdown are bounded. SIGINT/SIGTERM
   stop the probe's owned process group. A daemon that detaches needs separate ownership
   verification and cleanup; a process group is not a security boundary.
4. Retain the metadata-only summary and compare the original checkout's status. The
   summary contains configured relative source paths, ranges, URI schemes, hashes,
   counts, timing and exit codes. Server stdout is parsed as LSP; raw stderr is counted
   and discarded. Source text, diagnostics/log messages and environment values are not
   persisted. Upstream logs remain a separate sensitive artifact and need explicit review.

Minimal configuration (replace all paths and use independently verified components):

```json
{
  "profile": "jdtls",
  "executable": "/verified/lsp-jdk/bin/java",
  "arguments": ["-jar", "/verified/server/launcher.jar", "-configuration", "/owned/cache/config", "-data", "/owned/cache/data"],
  "workspace": "/owned/android-worktree",
  "environment": {"JAVA_HOME": "/verified/lsp-jdk", "PATH": "/verified/lsp-jdk/bin:/usr/bin:/bin"},
  "forwardEnvironment": [],
  "configuration": {},
  "readyStatus": "ServiceReady",
  "timeoutMs": 180000,
  "documents": [{
    "path": "common/src/main/java/example/Use.java",
    "languageId": "java",
    "definitions": [{"needle": "Target", "offset": 1, "expectedWorkspacePath": "common/src/main/java/example/Target.java"}],
    "unsavedSuffix": "\nclass InvalidProbeSyntax { int x = ; }\n"
  }]
}
```

For JDT LS, supply the publisher's required fixed launch flags and **actual supported
settings**; this minimal example is not a working Android import profile. Optional
`initializationOptions` override the default `{settings: configuration}`. An expected
external definition uses `expectedScheme` (for example `jdt:`) instead of
`expectedWorkspacePath`; this proves a server location only, not host source-read access.

Initialization or project-node counts never constitute success. Every document must
have a matching real definition target. When `unsavedSuffix` is present, a version-2
push diagnostic on the appended lines is required. An unversioned push deliberately
fails this diagnostic gate: a production adapter needs a separately proven consistency
strategy. SDK/dependency navigation, hover/completion, references, bidirectional dirty
Kotlin/Java overlays, resource costs and editor/native acceptance remain additional gates.

Run the probe regression checks with:
`node --test scripts/jvm-language-service-probe.test.mjs`.


## P0 language baseline (2026-11-03)

`node scripts/probes/measure-language-baseline.mjs /private/config.json /private/evidence.json`
measures explicit TS/JS, Rust or packaged Android stdio profiles. It is never loaded by the
application. Configuration names an absolute executable, argument array, workspace, one relative
source path, language ID and declaration needle, plus profile-specific initialization options.
Android additionally requires a captured, matching `modelFile` and verified `analysis` tool/component
locations. This path consumes the captured model; it does not invoke Gradle or silently refresh that
model. Record its age/fingerprint and source/variant identity separately; a stale capture is not a live
model acceptance result. Server assets and tool identities must be independently verified first.

Defaults are three cold/warm pairs and 30 repeated definition→reference samples after a separately
reported first query. Android allocates a new private analysis-cache namespace per pair. TS/JS/Rust
use fresh processes; their labels do not claim persistent semantic cache support. Project sources
remain unchanged, captured-model inputs are read only, and user caches are never deleted. Rust
must disable build scripts, procedural macros, checks and network dependency recovery; supply the
pinned sysroot and toolchain explicitly. The probe environment forwards only HOME, TMPDIR, PATH,
LANG and USER, with fixed Rust overrides. A real-project run must be authorized explicitly.

Evidence stores timings, machine/tool/source/model hashes, exact result-set digests, coverage state,
stages, stderr byte counts and process cleanup; raw source, reference URIs, RPC bodies and stderr
are not retained. Each run verifies exact query-set stability and final source digest. Descendant
RSS sampling excludes the desktop host and its WebKit services; it is not whole-app physical memory.
Use native lifecycle and platform memory acceptance separately. Initialization/ready notifications
alone are not semantic acceptance. Run the framing/model/status privacy tests with the JVM probe tests.


## Private Android process-failure acceptance

`node scripts/probes/verify-android-recovery.mjs /private/baseline-config.json /private/evidence.json`
uses the same explicit Android model/tool inputs and starts its own detached adapter. It checks exact
references, a no-op model polling interval, then kills only matching direct JVM children in that
adapter's private process group. It tests JDT replacement, current unsaved-overlay retention, three
Kotlin restarts, fourth-exit exhaustion, continued Java availability, model reacquisition, unchanged
source and final process cleanup. It never kills a user Gradle daemon or another application's JVM.
The current representative Java probe is boostCleaner's HttpClient; use that authorized project for
this acceptance entry. Optional `cacheSeed` copies verified derived artifacts into its private cache;
it never deletes the seed or user caches. The adapter validates cache entries normally.

SIGINT/SIGTERM stop the owned group, evidence checkpoints retain only counts/hashes/stages and fixed
failure codes, and failure attempts must be preserved separately from the final package receipt.
This is a developer fault tool, never an application entry or plugin permission. A direct backend
pass does not replace native authority/lifecycle fixtures, package admission, desktop health and icon
restart acceptance.
