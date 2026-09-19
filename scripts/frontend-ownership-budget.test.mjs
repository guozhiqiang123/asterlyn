import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const architectureBaseline = JSON.parse(
  await readFile(new URL("./frontend-architecture-baseline.json", import.meta.url), "utf8"),
);

test("composition adapter delegates repository reconciliation ownership", async () => {
  const source = await readFile(path.join(repositoryRoot, "src/app.ts"), "utf8");
  assert.equal(
    source.match(/bridge\.openProject/g)?.length ?? 0,
    1,
    "project reads must enter through WindowSession after its gateway is composed",
  );
  assert.match(source, /new RepositoryIntegrationCoordinator\(/);
  assert.equal(
    source.match(/repositoryReconciliationPlan/g)?.length ?? 0,
    0,
    "slice fan-out belongs to RepositoryIntegrationCoordinator",
  );
  assert.equal(
    source.match(/windowSession\.(?:installRepository|installTracked|subscribe)\(/g)?.length ?? 0,
    0,
    "repository installation and session events belong to the integration boundary",
  );
});

test("every production TypeScript source above the review trigger has non-growing ownership", async () => {
  const files = await typescriptFiles([path.join(repositoryRoot, "src")]);
  const reviewed = architectureBaseline.sourceOwnership;
  const oversized = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = portablePath(path.relative(repositoryRoot, file));
    const lines = lineCount(source);
    if (lines <= architectureBaseline.sourceReviewThreshold) continue;
    oversized.set(relative, lines);
    const review = reviewed[relative];
    assert.ok(review, `${relative} reached ${lines} lines without a named ownership review`);
    assert.ok(review.owner?.trim(), `${relative} has no named owner`);
    assert.ok(review.burnDownPhase?.trim(), `${relative} has no review disposition`);
    assert.ok(
      lines <= review.maximumLines,
      `${relative} grew from its reviewed ${review.maximumLines}-line ceiling to ${lines} lines`,
    );
  }
  assert.deepEqual(
    [...Object.keys(reviewed)].sort(),
    [...oversized.keys()].sort(),
    "the source ownership baseline must exactly match current files above the review trigger",
  );
});

test("window-wide bindings have explicit listener and observer disposal", async () => {
  const shell = await readFile(
    path.join(repositoryRoot, "src/shell/shell-event-binding.ts"),
    "utf8",
  );
  const chrome = await readFile(
    path.join(repositoryRoot, "src/shell/window-chrome-binding.ts"),
    "utf8",
  );
  assert.match(shell, /AbortController/);
  assert.match(shell, /resizeObserver\?\.disconnect\(\)/);
  assert.match(chrome, /releaseResize\?\.\(\)/);
  assert.match(chrome, /releaseCloseRequest\?\.\(\)/);
});

test("workspace search state has one feature owner", async () => {
  const appState = await readFile(path.join(repositoryRoot, "src/app-state.ts"), "utf8");
  const controller = await readFile(
    path.join(repositoryRoot, "src/features/files-editor/workspace-search-controller.ts"),
    "utf8",
  );
  assert.doesNotMatch(appState, /workspaceSearch/);
  assert.match(controller, /class WorkspaceSearchController/);
  assert.match(controller, /private value: WorkspaceSearchControllerState/);
});

test("workspace replacement state has one feature owner", async () => {
  const appState = await readFile(path.join(repositoryRoot, "src/app-state.ts"), "utf8");
  const controller = await readFile(
    path.join(repositoryRoot, "src/features/files-editor/workspace-replacement-controller.ts"),
    "utf8",
  );
  assert.doesNotMatch(appState, /workspaceReplacement|replacementDialog|replacementRecoveryBusy/);
  assert.match(controller, /class WorkspaceReplacementController/);
  assert.match(controller, /private value: WorkspaceReplacementControllerState/);
});

test("history filter and dialog state has one feature owner", async () => {
  const appState = await readFile(path.join(repositoryRoot, "src/app-state.ts"), "utf8");
  const controller = await readFile(
    path.join(repositoryRoot, "src/features/git-history/history-filter-controller.ts"),
    "utf8",
  );
  assert.doesNotMatch(appState, /history(?:Query|Refs|Dialog|FilterMenu|PathDraft)/);
  assert.match(controller, /class HistoryFilterController/);
  assert.match(controller, /private readonly value = createHistoryFilterState\(\)/);
  assert.match(controller, /get state\(\): HistoryFilterViewState/);
});

test("history detail presentation state has one feature owner", async () => {
  const appState = await readFile(path.join(repositoryRoot, "src/app-state.ts"), "utf8");
  const controller = await readFile(
    path.join(
      repositoryRoot,
      "src/features/git-history/history-detail-presentation-controller.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    appState,
    /gitDetail|commitFileView|commitPatch|comparisonPatch|collapsedCommitFileDirectories/,
  );
  assert.match(controller, /class HistoryDetailPresentationController/);
  assert.match(controller, /private readonly value: MutableHistoryDetailPresentationState/);
  assert.match(controller, /commitPatchGeneration/);
  assert.match(controller, /comparisonPatchGeneration/);
});

async function typescriptFiles(roots) {
  const files = [];
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) files.push(...await typescriptFiles([target]));
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(target);
    }
  }
  return files;
}

function lineCount(source) {
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}

function portablePath(value) {
  return value.split(path.sep).join("/");
}
