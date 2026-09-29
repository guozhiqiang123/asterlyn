import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FindResultsController } from "../src/features/files-editor/find-results-controller.ts";
import { renderFindHeaderActions, renderFindResults } from "../src/features/files-editor/find-results-view.ts";
import { EN_US } from "../src/localization/en-US.ts";

const [findRuntimeSource, appSource] = await Promise.all([
  readFile(new URL("../src/features/files-editor/find-results-runtime.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app.ts", import.meta.url), "utf8"),
]);

test("Find results retain an independent searchable report after the command surface closes", () => {
  const controller = new FindResultsController();
  const report = searchReport();

  assert.equal(controller.install("/repo", "needle", report), true);
  assert.equal(controller.state.snapshot?.report, report);
  assert.equal(controller.selectedMatch()?.workspacePath, "src/alpha.ts");
  assert.equal(controller.move(1), true);
  assert.equal(controller.selectedMatch()?.workspacePath, "src/zeta.ts");
  assert.equal(controller.select(9), false);

  const html = renderFindResults(controller.state, EN_US);
  assert.match(html, /needle/);
  assert.match(html, /2 matches/);
  assert.match(html, /data-find-result="0"/);
  assert.match(html, /aria-selected="true" data-find-result="1"/);
  assert.match(html, /alpha\.ts:4/);
  assert.match(html, /zeta\.ts:9/);

  controller.clear();
  assert.equal(controller.state.snapshot, null);
});

test("Find results reject empty reports that cannot open a source location", () => {
  const controller = new FindResultsController();
  const empty = { ...searchReport(), matches: [] };
  assert.equal(controller.install("/repo", "needle", empty), false);
  assert.match(renderFindResults(controller.state, EN_US), /No saved Find results/);
});

test("Files and Recent snapshots support tree, flat, external locate, and selected-folder disclosure", () => {
  const controller = new FindResultsController();
  const files = [
    file("src/zeta/index.ts"),
    file("docs/alpha.md"),
    file("src/alpha/app.ts"),
  ];

  assert.equal(controller.installFiles("files", "/repo", "a", files), true);
  assert.equal(controller.state.snapshot?.kind, "files");
  assert.equal(controller.state.fileView, "tree");
  assert.ok(controller.state.expandedDirectories.has("src"));
  assert.match(renderFindHeaderActions(controller.state, EN_US, "src/alpha/app.ts"), /data-find-action="locate"/);

  const tree = renderFindResults(controller.state, EN_US);
  assert.match(tree, /find-file-list tree/);
  assert.match(tree, /data-find-kind="directory"/);
  assert.ok(tree.indexOf("docs") < tree.indexOf("src"));

  assert.equal(controller.selectFile("src", "directory"), true);
  assert.equal(controller.setSelectedSubtreeExpanded(false), true);
  assert.equal(controller.state.expandedDirectories.has("src"), false);

  assert.equal(controller.toggleFileView(), true);
  const flat = renderFindResults(controller.state, EN_US);
  assert.match(flat, /find-file-list flat/);
  assert.ok(flat.indexOf("alpha.md") < flat.indexOf("app.ts"));
  assert.ok(flat.indexOf("app.ts") < flat.indexOf("index.ts"));
});

test("Find locate delegates to the Files tool without mutating its saved result tree", () => {
  const actionStart = findRuntimeSource.indexOf('if (action === "locate")');
  const actionEnd = findRuntimeSource.indexOf('if (action === "view"', actionStart);
  const action = findRuntimeSource.slice(actionStart, actionEnd);
  assert.match(action, /this\.options\.locateCurrentFile\(\)/u);
  assert.doesNotMatch(action, /controller\.(?:locateFile|selectFile)/u);

  const methodStart = appSource.indexOf("private locateCurrentProjectFile");
  const methodEnd = appSource.indexOf("private setSelectedProjectFolderExpanded", methodStart);
  const method = appSource.slice(methodStart, methodEnd);
  assert.ok(methodStart >= 0 && methodEnd > methodStart);
  assert.match(method, /revealFile\(activePath\)/u);
  assert.match(method, /leftTool: "files"/u);
});

function searchReport() {
  return {
    requestId: "request",
    matches: [
      match("src/alpha.ts", 4, "const needle = 1;"),
      match("src/zeta.ts", 9, "return needle;"),
    ],
    catalogCandidates: 2,
    eligibleCandidates: 2,
    filesSearched: 2,
    bytesRead: 64,
    skippedCount: 0,
    skippedFiles: [],
    coverageReasons: [],
  };
}

function match(workspacePath, line, preview) {
  const from = preview.indexOf("needle");
  return {
    repositoryId: ".",
    path: workspacePath,
    workspacePath,
    readOnly: false,
    ignored: false,
    revision: `revision-${workspacePath}`,
    fromUtf16: from,
    toUtf16: from + 6,
    line,
    columnUtf16: from,
    preview,
    previewFromUtf16: from,
    previewToUtf16: from + 6,
    leadingClipped: false,
    trailingClipped: false,
  };
}

function file(workspacePath) {
  return { repositoryId: ".", path: workspacePath, workspacePath };
}
