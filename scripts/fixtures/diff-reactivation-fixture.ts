import "/src/styles.css";
import "/src/main.ts";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { AsterlynApp } from "/src/app.ts";
import { bridge } from "/src/bridge.ts";
import { ChangesCommitController } from "/src/features/changes-commit/changes-commit-controller.ts";
import { EditorSessionController } from "/src/features/files-editor/editor-session-controller.ts";
import { HistoryDetailPresentationController } from "/src/features/git-history/history-detail-presentation-controller.ts";
import { EditorSurface } from "/src/features/files-editor/editor-surface.ts";
import { DEFAULT_APP_PREFERENCES } from "/src/preferences.ts";
import { EN_US } from "/src/localization/en-US.ts";
import { editorDocumentContentKey } from "/src/editor-document.ts";
import { commitKey } from "/src/features/git-history/history-identity.ts";

const root = document.querySelector<HTMLElement>("#fixture")!;
const before = Array.from({length: 180}, (_, i) => `const value_${i} = ${i};`);
const oid = "a".repeat(40);
let revision = 1, kind = "working-editable", active: any = {kind: "welcome"};
let expanded = false, gate: Promise<void> | null = null, release: (() => void) | null = null;
let stats: any, remembered: Element[] = [], scrolls: number[] = [], selection: any;
const after = () => before.map((line, i) => i === 70 ? `const changed = ${revision};` : line).join("\n");
const patch = () => `diff --git a/feature.ts b/feature.ts\n--- a/feature.ts\n+++ b/feature.ts\n@@ -1,180 +1,180 @@\n${before.map((line, i) => i === 70 ? `-${line}\n+const changed = ${revision};` : ` ${line}`).join("\n")}\n`;
const change = {repositoryId: ".", path: "feature.ts", workspacePath: "feature.ts", originalPath: null, indexStatus: "unmodified", worktreeStatus: "modified", conflicted: false, submodule: false};
const snapshot: any = {root: "/repo", changes: [change], repositoryRoots: [{id: ".", relativePath: "."}], branch: {unborn: false}, untrackedState: "complete"};
const detail = new HistoryDetailPresentationController({getItem: () => null, setItem() {}});
const controller = new ChangesCommitController({
  async readLocalDiff() { stats.reads++; const value = {path: change.path, patch: patch(), headOid: oid, truncated: false, binary: false}; await gate; return value; },
  async readWorkingDiffBase() { stats.baseReads++; await gate; return {content: before.join("\n"), headOid: oid}; },
} as any);
const app: any = Object.create(AsterlynApp.prototype);
const editor = new EditorSessionController({} as any);
editor.ensureText = async () => {stats.backingReads++; return undefined as any;};
editor.subscribe((event) => {if (event.documentChanged) {active = editor.activeDocument(); if (stats) stats.activations++;}});
const noSource: any = {source: null, unavailableReason: "Fixture has no Blame source"};
const sources = {old: noSource, new: noSource, unifiedReason: "Fixture"};
const labels = {before: "Before", after: "After"};
const prefs = {...DEFAULT_APP_PREFERENCES, diffLayout: "split"};
let surface: EditorSurface;
let tab: any;
const appValues = {
  root, windowSession: {repository: {state: {snapshot}}}, changesState: controller.state,
  changesRuntime: {controller}, filesState: {files: []},
  filesEditorRuntime: {editor},
  historyState: {details: {repositoryId: ".", oid, files: [{path: "feature.ts", originalPath: null, status: "modified"}]}, selectedCommit: commitKey({repositoryId: ".", oid}), selectedFile: null},
  historyReadRuntime: {details: {selectFile(path: string) {app.historyState.selectedFile = path; return true;}}},
  gitHistoryPresentationRuntime: {detail, get detailState() {return detail.state;}},
  stashRuntime: {isDiff: () => false}, diffContextExpansion: {requestsExpandedPatch: () => expanded},
  localization: {catalog: EN_US}, activeDocument: () => active,
  captureMountedTextEditor() {}, markChangeSelection() {}, focusChangeRow() {}, focusCommitFile() {}, updateCommitFileSelection() {}, setStatus() {}, showError(error: any) {throw error;},
  renderEditor() {
    stats.renders++;
    const state = active.kind === "working-diff" ? controller.state : detail.state;
    const value = active.kind === "working-diff" ? state.workingPatch : state.commitPatch;
    const version = active.kind === "working-diff" ? state.workingPatchVersion : state.commitPatchVersion;
    if (!value) { stats.loading++; surface.showHtml("loading", '<span data-loading>Loading patch</span>', () => {}); return; }
    if (kind === "working-editable" && controller.state.workingDiffBase) {
      surface.mountEditableDiff(editorDocumentContentKey(active, `editable:${version}`), before.join("\n"), tab, prefs, {layout: "split", showWhitespace: false}, labels, sources, true, () => {}, (_id, content) => {tab.content = content;});
    } else surface.mountDiff(editorDocumentContentKey(active, `patch:${version}`), value.patch, "feature.ts", prefs, {layout: "split", showWhitespace: false}, labels, sources, () => {}, () => {});
  },
};
for (const [key, value] of Object.entries(appValues)) Object.defineProperty(app, key, {value, writable: true, configurable: true});
(bridge as any).readCommitDiff = async (_root: string, repositoryId: string, commitOid: string, path: string) => {
  stats.commitReads++;
  const value = {repositoryId, oid: commitOid, path, patch: patch(), truncated: false, binary: false};
  await gate; return value;
};
controller.subscribe((event) => {if (event.diffChanged && active.kind === "working-diff") app.renderEditor();});
document.querySelector("#file")!.addEventListener("click", () => {
  if (kind === "history") app.selectCommitFile("feature.ts", false);
  else app.selectChangeRow(document.querySelector("#file"), false);
});
const views = () => [...root.querySelectorAll<HTMLElement>(".cm-editor")].map((dom) => EditorView.findFromDOM(dom)!);
(window as any).reactivation = {
  reset(next: string, delayed = false) {
    release?.(); gate = null; release = null;
    surface?.destroy(); root.querySelector("#content-body")!.innerHTML = "";
    kind = next; revision = 1; active = {kind: "welcome"};
    editor.resetSession();
    stats = {reads: 0, baseReads: 0, backingReads: 0, commitReads: 0, renders: 0, loading: 0, activations: 0};
    controller.installSnapshot(null); controller.installSnapshot(snapshot); detail.resetWorkspace();
    app.historyState.selectedFile = null;
    tab = {id: "backing", status: "ready", loadEpoch: 1, document: {path: "feature.ts"}, content: after(), persistedContent: after()};
    surface = new EditorSurface(root, EN_US.editor, {load: async () => {throw new Error("Unexpected Blame request");}, status() {}, error(error) {throw error;}});
    if (delayed) gate = new Promise<void>((resolve) => {release = resolve;});
  },
  release() {release?.(); release = null; gate = null;},
  remember() {
    remembered = [...root.querySelectorAll(".cm-editor")];
    views().forEach((view) => {view.scrollDOM.scrollTop = 400; view.dispatch({selection: {anchor: 20}});});
    scrolls = views().map((view) => view.scrollDOM.scrollTop); selection = views().map((view) => view.state.selection.main.head);
    return {...stats};
  },
  snapshot() {return {...stats, sameNodes: remembered.every((node, i) => root.querySelectorAll(".cm-editor")[i] === node), scrolls: views().map((view) => view.scrollDOM.scrollTop), selection: views().map((view) => view.state.selection.main.head), expectedScrolls: scrolls, expectedSelection: selection, text: tab.content};},
  edit() {const view = views().at(-1)!; view.dispatch({changes: {from: 0, insert: "// unsaved\n"}});},
  undo() {undo(views().at(-1)!);},
  refresh() {revision++; tab.content = tab.persistedContent = after(); controller.installSnapshot({...snapshot}); app.loadSelectedDiff();},
  leave() {editor.activateWelcome(); surface.showHtml("welcome", "Other document", () => {});},
  fail() {detail.failCommitPatch(detail.beginCommitPatch(), "retry fixture");},
  commit() {app.historyState.details = {...app.historyState.details, oid: "b".repeat(40)}; app.historyState.selectedCommit = commitKey(app.historyState.details);},
  dispose() {release?.(); controller.dispose(); surface.destroy();},
};
