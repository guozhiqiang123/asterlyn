import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageRoot = path.join(repositoryRoot, "packages/plugin-sdk");

test("public Plugin SDK pack exposes only the reviewed types and metadata", async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const indexSource = await readFile(path.join(packageRoot, "index.ts"), "utf8");
  assert.equal(packageJson.name, "@asterlyn/plugin-sdk");
  assert.equal(packageJson.version, "1.12.0");
  assert.equal(packageJson.private, undefined);
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.sideEffects, false);
  assert.match(indexSource, /export const PLUGIN_SDK_VERSION = "1\.12\.0"/);
  assert.match(indexSource, /export interface SdkLanguageServiceContribution \{/);
  for (const field of ["kind", "id", "label", "serverId", "languageIds", "extensions", "rootMarkers"]) {
    assert.match(indexSource, new RegExp(`readonly ${field}:`), `language-service contract omits ${field}`);
  }

  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  const packed = spawnSync(executable, ["pack", packageRoot, "--dry-run", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const result = JSON.parse(packed.stdout);
  assert.equal(result.length, 1);
  assert.deepEqual(
    result[0].files.map((file) => file.path).sort(),
    ["LICENSE", "README.md", "index.ts", "package.json"],
  );
});

test("Plugin SDK packer emits the reviewed canonical artifact with a matching checksum", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "asterlyn-plugin-sdk-"));
  const packed = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "scripts/pack-plugin-sdk.mjs"), output],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const summary = JSON.parse(packed.stdout);
  assert.equal(summary.artifact, "asterlyn-plugin-sdk-1.12.0.tgz");
  const bytes = await readFile(path.join(output, summary.artifact));
  const canonical = await readFile(path.join(
    repositoryRoot,
    "templates/plugin-typescript/vendor",
    summary.artifact,
  ));
  assert.deepEqual(bytes, canonical);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), summary.sha256);
  assert.equal(
    await readFile(path.join(output, "plugin-sdk.sha256"), "utf8"),
    `${summary.sha256}  ${summary.artifact}\n`,
  );
});
