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
  assert.match(html, /aria-selected="true"[^>]*data-find-result="1"/);
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
  const headerActions = renderFindHeaderActions(controller.state, EN_US, "src/alpha/app.ts");
  assert.match(headerActions, /role="toolbar"/);
  assert.match(headerActions, /data-collection-mode="tree"/);
  assert.match(headerActions, /data-collection-command="locate"/);

  const tree = renderFindResults(controller.state, EN_US);
  assert.match(tree, /find-file-list compact-file-tree tree/);
  assert.match(tree, /data-find-kind="directory"/);
  assert.match(tree, /find-tree-disclosure-spacer/);
  assert.ok(tree.indexOf("docs") < tree.indexOf("src"));

  assert.equal(controller.selectFile("src", "directory"), true);
  assert.equal(controller.setSelectedSubtreeExpanded(false), true);
  assert.equal(controller.state.expandedDirectories.has("src"), false);

  assert.equal(controller.toggleFileView(), true);
  const flat = renderFindResults(controller.state, EN_US);
  assert.match(flat, /find-file-list compact-file-tree flat/);
  assert.doesNotMatch(flat, /find-tree-disclosure-spacer/);
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

import {buildFindResultTree,findResultBranches,findResultRows} from "../src/features/files-editor/find-result-tree.ts";
import {locationPreview} from "../src/features/files-editor/find-results-view.ts";
test("text matches are grouped by directory/file, sorted by line, and folding hides only its own entries",()=>{
 const entries=[{index:0,fileKey:"a",path:"src/deep/pkg/shared.ts",line:9,column:2},{index:1,fileKey:"b",path:"tests/shared.ts",line:3,column:1},{index:2,fileKey:"a",path:"src/deep/pkg/shared.ts",line:2,column:2}];
 const tree=buildFindResultTree(entries),expanded=new Set(findResultBranches(tree).map(n=>n.id));let rows=findResultRows(tree,expanded);
 assert.equal(rows[0].label,"src/deep/pkg");assert.deepEqual(rows.filter(r=>r.entry).map(r=>r.entry.index),[2,0,1]);expanded.delete("file:a");rows=findResultRows(tree,expanded);assert.deepEqual(rows.filter(r=>r.entry).map(r=>r.entry.index),[1]);
 const collision=buildFindResultTree([{...entries[0],fileKey:"other",index:0},{...entries[0],fileKey:"original",index:1}]);assert.equal(findResultBranches(collision).filter(n=>n.kind==="file").length,2);
});
test("language result snapshot preserves scope, readonly source, truncation, Unicode paths and exact UTF16 positions",()=>{
 const c=new FindResultsController(),location={uri:"file:///repo/%E7%9B%AE%E5%BD%95/a.kt",range:{start:{line:2,character:7},end:{line:2,character:10}}};
 assert.equal(c.installLocations({workspaceRoot:"/repo",workspaceGeneration:4,kind:"references",query:"name",limited:true,locations:[location]}),true);
 assert.equal(c.state.snapshot.workspaceGeneration,4);assert.deepEqual(c.selectedLocation(),location);
 assert.match(renderFindResults(c.state),/目录/);assert.match(renderFindResults(c.state),/first 1 locations/);
 assert.equal(c.toggleResultNode("file:"+location.uri),true);assert.equal(c.resultRows().filter(r=>r.entry).length,0);assert.equal(c.setSelectedSubtreeExpanded(true),true);assert.equal(c.resultRows().filter(r=>r.entry).length,1);
 c.toggleFileView();assert.match(renderFindResults(c.state),/role="listbox"/);c.clear();assert.equal(c.selectedLocation(),null);
});
test("location preview escapes in the view and does not invent a source line",()=>{
 assert.equal(locationPreview("a",3,0,1),null);const c=new FindResultsController();c.installLocations({workspaceRoot:"/repo",workspaceGeneration:1,kind:"references",query:"<name>",limited:false,locations:[{uri:"file:///repo/a.kt",range:{start:{line:0,character:1},end:{line:0,character:3}}}]});
 const html=renderFindResults(c.state,EN_US,new Map([[0,locationPreview("a<script>z",0,1,3)]]));assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;name&gt;/);
});

import {createFindLanguageResultsPorts} from "../src/composition/language-definition-navigation.ts";
test("language preview reads only catalog files, prefers live buffers and discards reads after workspace activation changes",async()=>{
 let generation=1,readCount=0,release;const tabs=[{status:"ready",content:"unsaved",document:{repositoryRoot:"/repo",workspacePath:"src/a.ts"}}];
 const ports=createFindLanguageResultsPorts({workspace:()=>({root:"/repo",generation}),files:()=>[file("src/a.ts")],buffers:()=>tabs,capture(){},navigate:async()=>{},read:async()=>{readCount++;await new Promise(resolve=>release=resolve);return {content:"disk",byteLength:4};}});
 const location={uri:"file:///repo/src/a.ts",range:{start:{line:0,character:0},end:{line:0,character:1}}};
 assert.equal(await ports.readLocationSource("/repo",location),"unsaved");assert.equal(readCount,0);assert.equal(await ports.readLocationSource("/repo",{...location,uri:"file:///other/secret"}),null);tabs.length=0;
 const pending=ports.readLocationSource("/repo",location);generation++;release();assert.equal(await pending,null);assert.equal(readCount,1);
});

test("preview clipping bounds oversized language ranges without splitting UTF16 surrogate pairs",()=>{
 const text="😀".repeat(1000),preview=locationPreview(text,0,102,1999);assert.ok(preview);assert.ok(preview.before.length+preview.found.length+preview.after.length<=442);assert.equal(preview.before.isWellFormed(),true);assert.equal(preview.found.isWellFormed(),true);assert.equal(preview.after.isWellFormed(),true);assert.equal(locationPreview(text,0,3,5),null);
});
test("tree view reveals the selection when returning from a flat result list",()=>{
 const c=new FindResultsController();c.install("/repo","needle",searchReport());const entry=c.resultRows().find(r=>r.entry)?.entry;assert.ok(entry);c.toggleResultNode(`file:${entry.fileKey}`);c.toggleFileView();c.select(entry.index);c.toggleFileView();assert.ok(c.resultRows().some(row=>row.id===c.state.resultSelection));
});
test("readonly dependency results retain independent URI identity and selected location",()=>{
 const c=new FindResultsController(),range={start:{line:0,character:6},end:{line:0,character:9}},locations=["a","b"].map(hash=>({uri:`asterlyn-source://${hash.repeat(64)}/Api.java`,range,readonlySource:{path:"dependency/Api.java",text:"class Api {}",languageId:"java"}}));
 assert.equal(c.installLocations({workspaceRoot:"/repo",workspaceGeneration:1,kind:"definition",query:"Api",locations,selectedIndex:1,limited:false}),true);assert.equal(c.state.snapshot.kind,"locations");assert.deepEqual(c.selectedLocation(),locations[1]);assert.equal(c.resultRows().filter(row=>row.node?.kind==="file").length,2);
});

test("text result columns preserve the native one-based UTF16 column",()=>{
 const c=new FindResultsController(),report=searchReport();report.matches[0].columnUtf16=4;c.install("/repo","needle",report);assert.equal(c.resultRows().find(row=>row.entry?.index===0).entry.column,4);
});
