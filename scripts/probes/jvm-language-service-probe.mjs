// Explicit developer tool: may execute the configured server and project build configuration.
// Never imported by the application. See README.md before running on a real project.
import { readFile, writeFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { JvmLspProbeSession, ProbeFailure } from "./jvm-lsp-session.mjs";

const [configPath, output] = process.argv.slice(2);
if (!configPath || !output || process.argv.length !== 4) throw new Error("Usage: node scripts/probes/jvm-language-service-probe.mjs <config.json> <summary.json>");
if ((await stat(configPath)).size > 64 * 1024) throw new Error("Probe configuration exceeds 64 KiB");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!isAbsolute(config.executable) || !isAbsolute(config.workspace) || !Array.isArray(config.arguments) || config.arguments.length > 64 || !config.arguments.every((v) => typeof v === "string" && v.length <= 4096)) throw new Error("Invalid explicit probe command");
if (!Array.isArray(config.documents) || config.documents.length < 1 || config.documents.length > 16) throw new Error("One to sixteen semantic document probes are required");
const workspace = await realpath(config.workspace), rootUri = pathToFileURL(workspace).href;
const timeoutMs = config.timeoutMs ?? 180000;
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error("Probe deadline must be between one second and five minutes");
const environment = { ...config.environment };
for (const key of config.forwardEnvironment ?? []) {
  if (typeof key !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(key)) throw new Error("Invalid environment name");
  if (process.env[key] !== undefined) environment[key] = process.env[key];
}
const session = new JvmLspProbeSession(config.executable, config.arguments, { cwd: workspace, env: environment, configuration: config.configuration ?? {} });
const started = Date.now();
const summary = { schema: 1, profile: config.profile, workspaceHash: createHash("sha256").update(workspace).digest("hex").slice(0, 16), initializeMs: null, ready: false, documents: [], passed: false };
const timer = setTimeout(() => { summary.failure = "probe-deadline"; void session.stop(); }, timeoutMs);
const interrupt = () => { summary.failure = "interrupted"; void session.stop(); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
function requireResult(response) {
  if (response.error) throw new ProbeFailure(`rpc-error-${Number.isInteger(response.error.code) ? response.error.code : "invalid"}`);
  return response.result;
}
async function localDocument(path) {
  if (typeof path !== "string" || isAbsolute(path)) throw new ProbeFailure("document-path");
  const file = await realpath(join(workspace, path)), rel = relative(workspace, file);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ProbeFailure("document-outside-workspace");
  if ((await stat(file)).size > 2 * 1024 * 1024) throw new ProbeFailure("document-bound");
  return { uri: pathToFileURL(file).href, text: await readFile(file, "utf8") };
}
try {
  const result = requireResult(await session.request("initialize", {
    processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "JVM acceptance probe" }],
    capabilities: { general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true, workspaceFolders: true, applyEdit: false }, window: { workDoneProgress: true }, textDocument: { publishDiagnostics: { versionSupport: true }, definition: { linkSupport: false }, hover: { contentFormat: ["plaintext"] }, completion: { completionItem: { snippetSupport: false } } } },
    initializationOptions: config.initializationOptions ?? { settings: config.configuration ?? {} },
  }, Math.min(timeoutMs, 90000)));
  if (result?.capabilities?.positionEncoding && result.capabilities.positionEncoding !== "utf-16") throw new ProbeFailure("position-encoding");
  summary.initializeMs = Date.now() - started;
  summary.capabilities = Object.keys(result?.capabilities ?? {});
  session.notify("initialized", {});
  session.notify("workspace/didChangeConfiguration", { settings: config.configuration ?? {} });
  if (config.readyStatus) {
    while (!session.exited && Date.now() - started < timeoutMs) {
      if (session.events.some((event) => event.method === "language/status" && event.type === config.readyStatus)) { summary.ready = true; break; }
      await sleep(100);
    }
    if (!summary.ready) throw new ProbeFailure("project-not-ready");
  } else summary.ready = true;
  if (config.profile === "jdtls") {
    const projects = requireResult(await session.request("workspace/executeCommand", { command: "java.project.getAll", arguments: [] }));
    summary.projectCount = Array.isArray(projects) ? projects.length : 0;
  }
  for (const document of config.documents) {
    const { uri, text } = await localDocument(document.path);
    session.notify("textDocument/didOpen", { textDocument: { uri, languageId: document.languageId, version: 1, text } });
    const report = { path: document.path, definitions: [], passed: true };
    summary.documents.push(report);
    if (!Array.isArray(document.definitions) || document.definitions.length < 1 || document.definitions.length > 16) throw new ProbeFailure("definition-probes-required");
    for (const definition of document.definitions) {
      const offset = text.indexOf(definition.needle);
      if (!definition.needle || offset < 0) throw new ProbeFailure("symbol-not-present");
      const prefix = text.slice(0, offset + (definition.offset ?? 0)), position = { line: prefix.split("\n").length - 1, character: prefix.slice(prefix.lastIndexOf("\n") + 1).length };
      const before = Date.now();
      const result = requireResult(await session.request("textDocument/definition", { textDocument: { uri }, position }, Math.min(timeoutMs, 90000)));
      const locations = Array.isArray(result) ? result : result ? [result] : [];
      const targets = locations.map((location) => {
        const uri = location.uri ?? location.targetUri, url = new URL(uri);
        let local = null;
        if (url.protocol === "file:") {
          const rel = relative(workspace, fileURLToPath(url));
          if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) local = rel;
        }
        return { scheme: url.protocol, workspacePath: local, range: location.range ?? location.targetSelectionRange };
      });
      const matched = targets.some((target) => definition.expectedWorkspacePath ? target.workspacePath === definition.expectedWorkspacePath : definition.expectedScheme ? target.scheme === definition.expectedScheme : false);
      report.definitions.push({ elapsedMs: Date.now() - before, targetCount: targets.length, targets, matched });
      report.passed &&= matched;
    }
    if (document.unsavedSuffix) {
      session.diagnostics.delete(uri);
      const changedAt = Date.now();
      session.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: text + document.unsavedSuffix }] });
      const until = Math.min(started + timeoutMs, changedAt + 10000);
      while (!session.exited && Date.now() < until && !session.diagnostics.get(uri)?.count) await sleep(100);
      const diagnostics = session.diagnostics.get(uri);
      // Never infer a version for an unversioned push, or count an existing classpath warning as an unsaved error.
      const changedLine = text.split("\n").length - 1;
      report.diagnostics = diagnostics ?? null;
      report.unsavedDiagnosticVersionVerified = diagnostics?.version === 2 && diagnostics.ranges.some((range) => range?.start?.line >= changedLine);
      report.passed &&= report.unsavedDiagnosticVersionVerified;
    }
    session.notify("textDocument/didClose", { textDocument: { uri } });
  }
  summary.passed = summary.documents.every((document) => document.passed) && !session.protocolFailed && !summary.failure;
  if (!summary.passed) summary.failure ??= "semantic-acceptance-failed";
} catch (error) { summary.failure ??= error instanceof ProbeFailure ? error.code : "probe-error"; }
finally {
  await session.stop(); clearTimeout(timer);
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  Object.assign(summary, { elapsedMs: Date.now() - started, counts: session.counts, statuses: [...new Set(session.events.filter((event) => event.method === "language/status").map((event) => event.type))], protocolFailed: session.protocolFailed, stderrBytes: session.stderrBytes, exit: session.exited });
  if (summary.failure) summary.passed = false;
  await writeFile(output, JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ profile: summary.profile, passed: summary.passed, failure: summary.failure, elapsedMs: summary.elapsedMs, projectCount: summary.projectCount }));
  process.exitCode = summary.passed ? 0 : 1;
}
