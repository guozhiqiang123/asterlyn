import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDesktopResult } from "../src/protocol/validate-desktop-result.ts";
import { ExternalPluginRuntime } from "../src/composition/external-plugin-runtime.ts";
import { PluginContributionRegistry } from "../src/application/plugins/plugin-registry.ts";
import { createLanguageServicesRuntime } from "../src/composition/language-services-runtime.ts";

// This intentionally traverses the desktop validator used by the installed app, not just the
// helper's activationReady message or a direct import of the plugin descriptor.
const root = fileURLToPath(new URL("../", import.meta.url));
const archive = join(root, "src-tauri/resources/plugins/asterlyn-plugin-lsp-0.1.0.asterlyn-plugin.tgz");
const bytes = await readFile(archive), digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const helper = resolve(process.env.ASTERLYN_PLUGIN_HOST ?? join(root, `target/debug/asterlyn-plugin-host${process.platform === "win32" ? ".exe" : ""}`));
if (!process.env.ASTERLYN_PLUGIN_HOST) {
  const built = spawnSync("cargo", ["build", "--quiet", "--locked", "-p", "asterlyn-plugin-host", "--bin", "asterlyn-plugin-host"], { cwd: root, encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
}
const inspected = spawnSync("cargo", ["run", "--quiet", "--locked", "-p", "asterlyn-plugin-package", "--bin", "asterlyn-plugin-inspect", "--", archive, "guozhiqiang123/asterlyn-plugin-lsp", "0.1.0", "0.1.20"], { cwd: root, encoding: "utf8" });
assert.equal(inspected.status, 0, inspected.stderr);
const extracted = await mkdtemp(join(tmpdir(), "asterlyn-lsp-projected-"));
const unpacked = spawnSync("tar", ["-xzf", archive, "-C", extracted], { encoding: "utf8" });
assert.equal(unpacked.status, 0, unpacked.stderr);
const child = spawn(helper, ["--plugin-root", extracted, "--plugin-id", "dev.asterlyn.lsp", "--plugin-version", "0.1.0", "--package-digest", digest, "--runtime-entry", "runtime/plugin.js"], { stdio: ["pipe", "pipe", "pipe"] });
child.stdin.on("error", () => {});
let stderr = ""; child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-4096); });
const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
const iterator = child.stdout[Symbol.asyncIterator](); let pending = Buffer.alloc(0);
const deadline = setTimeout(() => { child.kill("SIGKILL"); }, 15000);
async function frame() {
  for (;;) {
    if (pending.length >= 4) {
      const length = pending.readUInt32BE(0); assert.ok(length <= 16 * 1024 * 1024);
      if (pending.length >= length + 4) { const value = JSON.parse(pending.subarray(4, length + 4)); pending = pending.subarray(length + 4); return value; }
    }
    const next = await iterator.next(); assert.equal(next.done, false, `helper ended: ${stderr}`); pending = Buffer.concat([pending, next.value]);
  }
}
function send(sequence, type, data) { const bytes = Buffer.from(JSON.stringify({ protocol: 1, sequence, message: { type, data } })); const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length); child.stdin.write(Buffer.concat([header, bytes])); }
let external, languages;
try {
  assert.equal((await frame()).message.type, "hello");
  send(1, "helloAck", { sessionId: "lsp-native-projection", capabilities: [], permissions: ["host.language-services.execute"] });
  send(2, "activate", { sessionId: "lsp-native-projection", workspaceId: "fixture", workspaceGeneration: 1, workspaceRoot: root.replace(/\/$/u, ""), evidence: {}, locale: "en-US", theme: "dark" });
  const ready = await frame(); assert.equal(ready.message.type, "activationReady", JSON.stringify(ready.message));
  const activation = { pluginId: "dev.asterlyn.lsp", pluginVersion: "0.1.0", packageDigest: digest, sessionId: "lsp-native-projection", contributions: ready.message.data.contributions };
  const registry = new PluginContributionRegistry();
  const installation = { schemaVersion: 2, generation: 1, recovered: false, plugins: [{ pluginId: activation.pluginId, repository: "guozhiqiang123/asterlyn-plugin-lsp", enabled: true, bundledFallback: true, activeVersion: null, knownGoodVersion: null, pendingVersion: "0.1.0", versions: [{ version: "0.1.0", packageDigest: digest, contentDigest: JSON.parse(inspected.stdout).contentDigest, admittedAtEpochMs: 1, runtimeStatus: "pendingRuntime" }] }] };
  external = new ExternalPluginRuntime({ registry, locale: () => "en-US", reportError: (error) => { throw error; }, marketplace: { listPluginInstallations: async () => installation }, healthCheckpointMs: 60000,
    bridge: { activate: async () => validateDesktopResult("activate_installed_plugin_runtime", activation), invoke: async () => { throw Error("metadata has no callback"); }, confirmHealthy: async () => installation, failActivation: async () => { throw Error("valid package must not be quarantined"); }, abandonActivation: async () => installation, deactivate: async () => {}, diagnostics: async () => ({ stderr: "", stderrTruncated: false, protocolDiagnostics: [] }), subscribe: async () => () => {}, subscribeNotifications: async () => () => {}, subscribeTerminations: async () => () => {} } });
  const workspace = { root: root.replace(/\/$/u, ""), generation: 1 };
  assert.deepEqual(await external.activate(workspace, {}, () => true), [activation.pluginId]);
  assert.equal(registry.list().filter((entry) => entry.kind === "language-service").length, 1);
  let binding, reviewed = 0;
  languages = createLanguageServicesRuntime({ registry, workspace: () => workspace, document: () => ({ workspacePath: "src/app.ts", loadEpoch: 1, readOnly: false }), bind: (factory) => { binding = factory; }, navigate: () => {}, reportError: (error) => { throw error; },
    native: { subscribe: () => () => {}, prepare: async () => { reviewed++; return { reviewId: "fixture", pluginId: activation.pluginId, serverId: "typescript", pluginVersion: "0.1.0", packageDigest: digest, resourceDigest: "fixture", executableIdentity: "fixture", expiresAt: Date.now() + 60000 }; }, confirm: async () => false } });
  languages.refresh(); const handle = { tabId: "app-source", path: "src/app.ts", loadEpoch: 1 }; const port = binding(handle); assert.ok(port);
  port.open(handle, { version: 1, text: "const unsaved = true;\n" }); await new Promise((resolve) => setTimeout(resolve, 50)); assert.equal(reviewed, 1, "the actual helper contribution must reach the language execution review");
  console.log("LSP package activation passed: native inspector → isolated helper → desktop validator → contribution registry → editable project buffer → execution review.");
} finally {
  languages?.dispose(); await external?.dispose();
  if (child.exitCode === null) send(3, "shutdown", { reason: "windowClosed" });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 2000);
  await exited; clearTimeout(timeout); clearTimeout(deadline); await rm(extracted, { recursive: true, force: true });
}
