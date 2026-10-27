import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const hostVersion = JSON.parse(read("package.json")).version;
const packageSource = read("crates/asterlyn-plugin-package/src/lib.rs");
const capabilityGuide = read("docs/plugins/capabilities-and-permissions.md");
const developerGuide = read("docs/plugins/developer-guide.md");
const migrationGuide = read("docs/plugins/diagnostics-and-migration.md");
const documentationMap = read("docs/README.md");

test("public capability catalog contains every native admitted capability and permission", () => {
  const capabilities = rustStringArray("SUPPORTED_CAPABILITIES");
  const permissions = rustStringArray("SUPPORTED_PERMISSIONS");
  assert.deepEqual(capabilities, [
    "executionTargets", "notifications", "processQueries", "runConfigurations",
    "taskAuthorization", "taskCache", "tasks", "toolOperations", "workspaceCatalog",
    "workspaceState", "languageServices", "pluginDependencies", "workspaceModels", "packagedLanguageServices",
  ]);
  assert.deepEqual(permissions, [
    "host.execution-targets.read", "host.notifications.publish", "host.process.query",
    "host.tasks.cache", "host.tasks.discover", "host.tasks.execute", "host.tool.execute",
    "host.workspace.catalog.read", "host.workspace.state", "host.language-services.execute", "host.workspace-models.execute",
  ]);
  for (const id of [...capabilities, ...permissions]) {
    assert.equal(capabilityGuide.includes(`\`${id}\``), true, `missing documented ID: ${id}`);
  }
});

test("public guides pin independent version axes and immutable Release workflow", () => {
  for (const guide of [developerGuide, capabilityGuide, migrationGuide]) {
    assert.equal(
      guide.includes(`Asterlyn \`${hostVersion}\``),
      true,
      `public guide does not reference current host version ${hostVersion}`,
    );
  }
  assert.match(developerGuide, /Plugin SDK: `1\.14\.0`/);
  assert.match(developerGuide, /Package schema: `3`/);
  assert.match(developerGuide, /Plugin-host protocol: `1`/);
  assert.match(developerGuide, /never .*replace Release bytes/is);
  assert.match(migrationGuide, /SDK major/);
  assert.match(migrationGuide, /known-good/);
  for (const file of [
    "plugins/developer-guide.md",
    "plugins/capabilities-and-permissions.md",
    "plugins/diagnostics-and-migration.md",
  ]) {
    assert.equal(documentationMap.includes(file), true, `documentation map omits ${file}`);
  }
});

function rustStringArray(name) {
  const match = packageSource.match(new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`));
  assert.ok(match, `missing Rust string array ${name}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function read(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}
