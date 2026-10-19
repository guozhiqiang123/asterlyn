import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const templateRoot = path.join(repositoryRoot, "templates/plugin-typescript");

test("public TypeScript plugin template is version-locked and authority-free", () => {
  const manifest = json("manifest.json");
  const packageJson = json("package.json");
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.sdkMajor, 1);
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.distribution.runtime.protocol, 1);
  assert.equal(packageJson.dependencies["@asterlyn/plugin-sdk"], "file:vendor/asterlyn-plugin-sdk-1.9.0.tgz");
  assert.deepEqual(manifest.capabilities, []);
  assert.deepEqual(manifest.permissions, []);

  const source = read("src/plugin.ts");
  assert.doesNotMatch(source, /(?:node:|@tauri-apps|electron|child_process|\bfetch\s*\()/);
  assert.doesNotMatch(source, /(?:PrivateProjects|AndroidStudioProjects|\.\.\/\.\.\/packages)/);
});

test("template vendors the exact public SDK artifact and immutable dependency graph", () => {
  const artifact = "vendor/asterlyn-plugin-sdk-1.9.0.tgz";
  assert.equal(existsSync(path.join(templateRoot, artifact)), true);
  assert.equal(existsSync(path.join(templateRoot, "package-lock.json")), true);
  const expected = read("vendor/plugin-sdk.sha256").trim().split(/\s+/)[0];
  const bytes = readFileSync(path.join(templateRoot, artifact));
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actual, expected);
  const packageLock = json("package-lock.json");
  assert.equal(
    packageLock.packages["node_modules/@asterlyn/plugin-sdk"].integrity,
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  );
});

test("template release workflow pins the inspector baseline and publishing actions", () => {
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /git clone --depth 1 --branch v0\.1\.12/);
  assert.match(workflow, /softprops\/action-gh-release@a06a81a03ee405af7f2048a818ed3f03bbf83c7b/);
  assert.match(workflow, /files: release\/\*\.asterlyn-plugin\.tgz/);
  assert.doesNotMatch(workflow, /uses: [^\n]+@v\d/);
});

function read(relativePath) {
  return readFileSync(path.join(templateRoot, relativePath), "utf8");
}

function json(relativePath) {
  return JSON.parse(read(relativePath));
}
