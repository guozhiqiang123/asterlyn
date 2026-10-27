import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { smokeProcess } from "./smoke-native-app.mjs";

/** Registration precedes the health checkpoint. Never kill a newly upgraded package at registration. */
export function pluginStartupIsHealthy(events, installations, expected) {
  if (!Array.isArray(expected) || expected.length === 0 || expected.length > 16) return false;
  if (!events.some((event) => event.event === "application.frontend_ready")) return false;
  return expected.every(({id, version, digest}) => {
    const activated = events.some((event) => event.event === "activation.completed" && event.fields?.pluginId === id && event.fields?.pluginVersion === version);
    const plugin = installations.plugins.find((entry) => entry.pluginId === id);
    return activated && plugin?.enabled && plugin.activeVersion === version && plugin.knownGoodVersion === version &&
      plugin.versions.some((entry) => entry.version === version && entry.packageDigest === digest && entry.runtimeStatus === "knownGood");
  });
}

async function main() {
  if (process.platform !== "darwin") throw new Error("This log-based native probe currently supports macOS");
  const [executable, workspace, expectedFile, output] = process.argv.slice(2);
  if (!executable || !workspace || !expectedFile || !output) throw new Error("usage: verify-plugin-startup.mjs <executable> <workspace> <expected.json> <evidence.json>");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const config = JSON.parse(await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const logs = join(homedir(), "Library/Logs", config.identifier, "diagnostics");
  const index = join(homedir(), "Library/Application Support", config.identifier, "plugin-marketplace-v1/installation-state/installations.v1.json");
  const expected = JSON.parse(await readFile(expectedFile, "utf8"));
  if (!Array.isArray(expected) || !expected.length || expected.length > 16) throw new Error("Expected exact plugin identities are required");
  let evidence;
  await smokeProcess({command: resolve(executable), args: [resolve(workspace)], observationMs: 20000, readinessProbe: async (pid) => {
    const session = (await readdir(logs)).find((name) => name.includes(`-${pid}-`));
    if (!session) return {ready: false, detail: "waiting for startup logs"};
    const events = (await readFile(join(logs, session, "asterlyn.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const installations = JSON.parse(await readFile(index, "utf8"));
    if (!pluginStartupIsHealthy(events, installations, expected)) return {ready: false, detail: "waiting for exact package activation and native health checkpoint"};
    evidence = {pid, session, buildId: events[0]?.buildId, frontendReady: true, healthyPackages: expected,
      errors: events.filter((event) => event.level === "error").map((event) => ({event: event.event, command: event.fields?.command ?? null}))};
    await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
    return {ready: true, detail: "frontend, exact package activation and native health checkpoint verified"};
  }});
  console.log(JSON.stringify(evidence));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
