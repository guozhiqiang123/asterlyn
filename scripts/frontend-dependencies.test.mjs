import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(repositoryRoot, "src");
const baseline = JSON.parse(
  await readFile(new URL("./frontend-architecture-baseline.json", import.meta.url), "utf8"),
);

test("frontend dependencies keep feature and layer direction explicit", async () => {
  const files = await typescriptFiles(sourceRoot);
  const violations = [];
  for (const file of files) {
    const from = relativeSource(file);
    const fromLayer = layer(from);
    const fromFeature = feature(from);
    for (const specifier of importSpecifiers(await readFile(file, "utf8"))) {
      const target = resolveSourceImport(file, specifier);
      if (!target) continue;
      const to = relativeSource(target);
      const toLayer = layer(to);
      const toFeature = feature(to);
      if (fromFeature && toFeature && fromFeature !== toFeature) {
        violations.push({ from, to, reason: "cross-feature import" });
      } else if (
        fromLayer === "application" &&
        ["features", "shell", "adapters", "workbench"].includes(toLayer)
      ) {
        violations.push({ from, to, reason: "application imports a concrete outer layer" });
      } else if (fromLayer === "protocol" && ["application", "features", "shell", "adapters", "shared", "workbench"].includes(toLayer)) {
        violations.push({ from, to, reason: "protocol imports a product or presentation layer" });
      } else if (fromLayer === "shared" && ["application", "features", "shell", "adapters"].includes(toLayer)) {
        violations.push({ from, to, reason: "shared presentation imports product behavior" });
      } else if (fromLayer === "adapters" && ["features", "shell"].includes(toLayer)) {
        violations.push({ from, to, reason: "adapter imports presentation behavior" });
      }
    }
  }

  const actualDebt = violations.map(({ from, to }) => ({ from, to }));
  const expectedDebt = baseline.dependencyDebt.map(({ from, to }) => ({ from, to }));
  assert.deepEqual(
    sortEdges(actualDebt),
    sortEdges(expectedDebt),
    `frontend dependency debt changed:\n${violations.map(formatViolation).join("\n")}`,
  );
  for (const edge of baseline.dependencyDebt) {
    assert.ok(edge.burnDownPhase?.trim(), `${edge.from} -> ${edge.to} has no burn-down phase`);
  }
});

test("application DOM runtime debt is explicit and cannot spread", async () => {
  const applicationRoot = path.join(sourceRoot, "application");
  const files = await typescriptFiles(applicationRoot);
  const actual = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\b(?:document|window)\s*(?:\.|\[)|\btypeof\s+(?:document|window)\b|\b(?:HTMLElement|ResizeObserver)\b/.test(source)) {
      actual.push(relativeSource(file));
    }
  }
  assert.deepEqual(actual.sort(), Object.keys(baseline.applicationDomDebt).sort());
  for (const [file, phase] of Object.entries(baseline.applicationDomDebt)) {
    assert.ok(phase.trim(), `${file} has no DOM debt burn-down phase`);
  }
});

test("every transitional workbench module has one owner and destination", async () => {
  const workbenchRoot = path.join(sourceRoot, "workbench");
  const files = (await typescriptFiles(workbenchRoot)).map(relativeSource).sort();
  const ownership = baseline.workbenchOwnership;
  assert.deepEqual(files, Object.keys(ownership).sort());
  const allowedOwners = new Set([
    "application",
    "changes-commit",
    "files-editor",
    "git-history",
    "product-contract",
    "remote-push",
    "settings",
    "shared-presentation",
    "shared-utility",
    "shell",
  ]);
  for (const [file, review] of Object.entries(ownership)) {
    assert.ok(allowedOwners.has(review.owner), `${file} has an unknown owner: ${review.owner}`);
    assert.match(review.target, /^src\/(?!workbench\/).+\.ts$/, `${file} has no target outside workbench`);
    assert.equal(review.migrationPhase, "FH4", `${file} has no scheduled migration phase`);
  }
});

async function typescriptFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await typescriptFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(target);
  }
  return files.sort();
}

function importSpecifiers(source) {
  const specifiers = [];
  const staticImport = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(staticImport)) specifiers.push(match[1]);
  for (const match of source.matchAll(dynamicImport)) specifiers.push(match[1]);
  return specifiers;
}

function resolveSourceImport(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const unresolved = path.resolve(path.dirname(from), specifier);
  const target = unresolved.endsWith(".ts") ? unresolved : `${unresolved}.ts`;
  return target.startsWith(`${sourceRoot}${path.sep}`) ? target : null;
}

function relativeSource(file) {
  return portablePath(path.relative(repositoryRoot, file));
}

function layer(file) {
  return file.split("/")[1] ?? "root";
}

function feature(file) {
  const segments = file.split("/");
  return segments[1] === "features" ? segments[2] : null;
}

function sortEdges(edges) {
  return [...edges].sort((left, right) =>
    `${left.from}\0${left.to}`.localeCompare(`${right.from}\0${right.to}`)
  );
}

function formatViolation(violation) {
  return `${violation.from} -> ${violation.to}: ${violation.reason}`;
}

function portablePath(value) {
  return value.split(path.sep).join("/");
}
