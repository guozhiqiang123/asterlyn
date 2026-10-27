# ADR-0036: Packaged analysis programs and model handoff

Status: accepted for implementation, 2026-10-27. Continues ADR-0035; the user requested continued
implementation until Android language services are usable, rather than another foundation-only delivery.

The host will admit generic, fixed-entry Node analysis programs from verified plugin resources.
There are two static declarations: a model-producing auxiliary service and a packaged stdio language
server. The host owns Node/tool/component identities, consent, process supervision, bounded I/O,
model leases/artifacts and workspace/document access. Gradle/AGP, Eclipse project import, Kotlin and
Groovy adaptation remain in the respective plugin programs. The isolated plugin descriptor gains
no ambient filesystem/process authority.

## Contract

- Add `workspaceModels` / `host.workspace-models.execute` and `packagedLanguageServices` (existing
  language execution permission). Unknown capabilities fail admission in older hosts.
- A model provider declares service ID/schema, a relative integrity-covered Node entry, bounded
  input globs and workspace-state keys, and explicit tool/component requirements. A consumer binds
  an exact producer/service/schema through its declared required-plugin relationship.
- A packaged language server declares an integrity-covered Node entry and language IDs, optionally
  consuming one model service. It does not supply an arbitrary executable, shell or runtime argv.
- Tool requirements are host-validated Java major ranges. Gradle JVM and server JVM are separate;
  the project wrapper/AGP/Kotlin versions are preserved. Server distributions are optional, pinned,
  independently installed components with complete content receipts; they are not added to host startup.
  Activation never silently downloads components or project dependencies.
- A single project-session execution review covers the exact consumer, producer, Node, JVMs and
  components, plus Gradle configuration execution. Input/variant changes invalidate models but do
  not expand that consent. Package/tool/component identity changes require a new review.

## Model work and artifacts

The model program receives one bounded JSON request on stdin. It emits only its JSON artifact on
stdout; progress is fixed structured metadata on stderr. The host streams stdout to a private,
bounded staging file, hashes/seals it, and publishes only an exact reference after rechecking the
authority and input identity. No long JVM/Gradle work holds the JS callback lock.

Use the existing C2a broker for deduplication, leases, stale-generation rejection and cancellation.
The last lease, disabled/replaced producer/consumer, workspace replacement, timeout or shutdown
cancels owned work. Retained artifacts are bounded and are never writable through a model reference.
The language server gets a verified read-only artifact handoff, not a plugin's private cache path.
Paths inside the model do not grant general editor file access.

Backend adapters build their own import representation in private cache directories; they never
write `.project`, `.classpath`, compiler stubs or unsaved overlays to the user's project. Real
semantic definitions, references, hover/completion and current-version diagnostics must be proven
before registering a profile. Kotlin/Java dirty interoperability and script categories are tested
separately; no text-search fallback or extension-only enablement is acceptable.

Progress and failures use the structured diagnostics timeline with package/workspace/input hashes,
stages, counts and elapsed time. No source, full classpath/model, credential or environment dump
is logged. Startup registration is still distinct from native health acceptance.

The model handoff is an asynchronous server-to-host JSON-RPC request, `asterlyn/workspaceModel`, available only to a packaged language server with a statically admitted consumer declaration. It has no caller-supplied producer, executable, arguments or path. The actor keeps handling documents, cancellation and indexing status while native work runs; it replies with a verified artifact reference and retains its lease for the server session. This avoids blocking either the isolated descriptor callback or language-service startup on Gradle. Repeated requests recompute current input/selection identity; backend adapters keep overlays in memory while replacing their private import view.

## Read-only dependency sources

A definition/reference response may carry a bounded `readonlySource` (`text`, relative display `path`,
`languageId`) under a content-addressed `asterlyn-source://<sha256>/<name>` URI. Native code verifies
that the digest matches the text, validates UTF-16 target ranges, and enforces per-source/aggregate
limits before returning it. The editor renders this as a dedicated read-only preview with no disk
save, workspace-file identity, Git actions or execution authority. There is no arbitrary URI-to-file
read endpoint. A plugin adapter can obtain this content only through its reviewed backend; the
response is untrusted text, never HTML. Session/workspace/version checks still apply to navigation.
