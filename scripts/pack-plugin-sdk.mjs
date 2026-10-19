import { createHash } from "node:crypto";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(repositoryRoot, "packages/plugin-sdk");
const outputRoot = path.resolve(repositoryRoot, process.argv[2] ?? "release-sdk");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const expectedName = `asterlyn-plugin-sdk-${packageJson.version}.tgz`;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const executable = process.platform === "win32" ? "npm.cmd" : "npm";
const packed = spawnSync(
  executable,
  ["pack", packageRoot, "--pack-destination", outputRoot, "--json"],
  { cwd: repositoryRoot, encoding: "utf8" },
);
if (packed.status !== 0) {
  throw new Error(`Plugin SDK packaging failed: ${(packed.stderr || packed.stdout).trim()}`);
}
const result = JSON.parse(packed.stdout);
if (!Array.isArray(result) || result.length !== 1 || result[0].filename !== expectedName) {
  throw new Error(`Plugin SDK packaging returned an unexpected artifact: ${packed.stdout.trim()}`);
}
const artifact = path.join(outputRoot, expectedName);
const digest = createHash("sha256").update(await readFile(artifact)).digest("hex");
await writeFile(path.join(outputRoot, "plugin-sdk.sha256"), `${digest}  ${expectedName}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ artifact: expectedName, version: packageJson.version, sha256: digest })}\n`);
