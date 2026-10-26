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
