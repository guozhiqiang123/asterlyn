import assert from "node:assert/strict";
import test from "node:test";
import {
  bindProjectTreeRowEvents,
  createProjectFilesSelectionState,
  getSelectionModifierMode,
  handleProjectNodeClick,
  isProjectTreeElementSelected,
  isProjectTreeRowSelected,
  projectTreeElementRepresentsPath,
  rangeSelection,
  reconcileSelections,
  selectSingle,
  syncProjectTreeSelectionUi,
  toggleSelection,
} from "../src/features/files-editor/project-files-selection.ts";

function row(path, kind, directoryPaths = []) {
  return {
    node: { path, kind, name: path.split("/").pop(), children: [], status: "unmodified" },
    depth: 0,
    positionInSet: 1,
    setSize: 1,
    label: path,
    directoryPaths,
    fileCount: 1,
  };
}

test("selectSingle initializes single selection and anchor", () => {
  const target = { path: "src/a.ts", kind: "file" };
  const state = selectSingle(target);
  assert.deepEqual(state.selection, target);
  assert.deepEqual(state.selections, [target]);
  assert.deepEqual(state.anchor, target);
});

test("toggleSelection adds and removes selection items", () => {
  const first = { path: "src/a.ts", kind: "file" };
  const second = { path: "src/b.ts", kind: "file" };
  let state = selectSingle(first);

  state = toggleSelection(state, second);
  assert.deepEqual(state.selections, [first, second]);
  assert.deepEqual(state.selection, second);
  assert.deepEqual(state.anchor, second);

  state = toggleSelection(state, first);
  assert.deepEqual(state.selections, [second]);
  assert.deepEqual(state.selection, second);

  state = toggleSelection(state, second);
  assert.deepEqual(state.selections, []);
  assert.equal(state.selection, null);
});

test("rangeSelection selects all visible rows between anchor and target", () => {
  const rows = [
    row("src/a.ts", "file"),
    row("src/b.ts", "file"),
    row("src/c.ts", "file"),
    row("src/d.ts", "file"),
  ];
  let state = selectSingle({ path: "src/a.ts", kind: "file" });
  state = rangeSelection(state, { path: "src/c.ts", kind: "file" }, rows);

  assert.deepEqual(state.selections, [
    { path: "src/a.ts", kind: "file" },
    { path: "src/b.ts", kind: "file" },
    { path: "src/c.ts", kind: "file" },
  ]);
  assert.deepEqual(state.selection, { path: "src/c.ts", kind: "file" });
  assert.deepEqual(state.anchor, { path: "src/a.ts", kind: "file" });

  // Reverse range selection
  state = rangeSelection(state, { path: "src/b.ts", kind: "file" }, rows);
  assert.deepEqual(state.selections, [
    { path: "src/a.ts", kind: "file" },
    { path: "src/b.ts", kind: "file" },
  ]);
});

test("isProjectTreeRowSelected matches exact and compacted directory paths", () => {
  const selections = [
    { path: "src/a.ts", kind: "file" },
    { path: "common/utils", kind: "directory" },
  ];
  const fileRow = row("src/a.ts", "file");
  const otherRow = row("src/other.ts", "file");
  const compactDirRow = row("common/utils/sub", "directory", ["common", "common/utils"]);

  assert.equal(isProjectTreeRowSelected(selections, null, fileRow), true);
  assert.equal(isProjectTreeRowSelected(selections, null, otherRow), false);
  assert.equal(isProjectTreeRowSelected(selections, null, compactDirRow), true);
});

test("reconcileSelections filters out deleted paths", () => {
  const selections = [
    { path: "src/a.ts", kind: "file" },
    { path: "src/deleted.ts", kind: "file" },
  ];
  const tree = [
    { path: "src/a.ts", kind: "file", name: "a.ts", status: "unmodified", children: [] },
  ];
  assert.deepEqual(reconcileSelections(selections, tree), [
    { path: "src/a.ts", kind: "file" },
  ]);
});

test("projectTreeElementRepresentsPath matches dataset node and serialized directory paths", () => {
  const fileEl = { dataset: { projectNode: "src/a.ts" } };
  assert.equal(projectTreeElementRepresentsPath(fileEl, "src/a.ts"), true);
  assert.equal(projectTreeElementRepresentsPath(fileEl, "src/b.ts"), false);

  const dirEl = {
    dataset: {
      projectNode: "common/utils/sub",
      projectDirectoryPaths: JSON.stringify(["common", "common/utils"]),
    },
  };
  assert.equal(projectTreeElementRepresentsPath(dirEl, "common/utils"), true);
  assert.equal(projectTreeElementRepresentsPath(dirEl, "common/other"), false);
});

test("getSelectionModifierMode resolves single, toggle, and range modes", () => {
  assert.equal(getSelectionModifierMode({ shiftKey: false, metaKey: false, ctrlKey: false }), "single");
  assert.equal(getSelectionModifierMode({ shiftKey: true, metaKey: false, ctrlKey: false }), "range");
  assert.equal(getSelectionModifierMode({ shiftKey: false, metaKey: true, ctrlKey: false }), "toggle");
  assert.equal(getSelectionModifierMode({ shiftKey: false, metaKey: false, ctrlKey: true }), "toggle");
});

test("handleProjectNodeClick dispatches single click vs multi-selection click", () => {
  const calls = [];
  const bridge = {
    onSelectSingle: (path, kind) => calls.push(["single", path, kind]),
    onSelectMulti: (path, kind, mode) => calls.push(["multi", path, kind, mode]),
    onActivateFile: (path) => calls.push(["activate", path]),
    onToggleDirectory: (path) => calls.push(["toggle", path]),
  };

  // Normal click on file
  handleProjectNodeClick({ shiftKey: false, metaKey: false, ctrlKey: false }, "src/a.ts", "file", bridge);
  assert.deepEqual(calls, [
    ["single", "src/a.ts", "file"],
    ["activate", "src/a.ts"],
  ]);
  calls.length = 0;

  // Normal click on directory
  handleProjectNodeClick({ shiftKey: false, metaKey: false, ctrlKey: false }, "src", "directory", bridge);
  assert.deepEqual(calls, [
    ["single", "src", "directory"],
    ["toggle", "src"],
  ]);
  calls.length = 0;

  // Cmd-click on file
  handleProjectNodeClick({ shiftKey: false, metaKey: true, ctrlKey: false }, "src/b.ts", "file", bridge);
  assert.deepEqual(calls, [
    ["multi", "src/b.ts", "file", "toggle"],
  ]);
  calls.length = 0;

  // Shift-click on directory
  handleProjectNodeClick({ shiftKey: true, metaKey: false, ctrlKey: false }, "src", "directory", bridge);
  assert.deepEqual(calls, [
    ["multi", "src", "directory", "range"],
  ]);
});

