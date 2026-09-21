import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_TREE_MOUNT_LIMIT,
  PROJECT_TREE_ROW_HEIGHT,
  projectTreeRenderWindow,
  projectTreeRowRepresentsPath,
  projectTreeRows,
  renderProjectNavigation,
} from "../src/features/files-editor/project-files-view.ts";
import { renderWorkspaceTrashDialog } from "../src/features/workspace-trash/workspace-trash-dialog-view.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { buildProjectTree } from "../src/presentation/project-tree.ts";

test("expanded project trees are flattened in visible hierarchy order", () => {
  const tree = buildProjectTree(["src/a.ts", "src/deep/b.ts", "README.md"]);
  const rows = projectTreeRows(tree, new Set(["src", "src/deep"]));
  assert.deepEqual(rows.map(({ node, depth }) => [node.path, depth]), [
    ["src", 0], ["src/deep", 1], ["src/deep/b.ts", 2], ["src/a.ts", 1], ["README.md", 0],
  ]);
});

test("project files compact unary folders into one counted row", () => {
  const tree = buildProjectTree([
    "docs/refactor/rebuild/README.md",
    "docs/refactor/rebuild/notes.md",
  ]);
  const expandedDirectories = new Set(["docs/refactor/rebuild"]);
  const rows = projectTreeRows(tree, expandedDirectories);
  assert.equal(rows[0].label, "docs/refactor/rebuild");
  assert.equal(rows[0].node.path, "docs/refactor/rebuild");
  assert.equal(rows[0].fileCount, 2);
  assert.equal(projectTreeRowRepresentsPath(rows[0], "docs/refactor"), true);

  const html = renderProjectNavigation({
    ...state(), expandedDirectories,
  }, tree, 0, 500);
  assert.match(html, /data-project-node="docs\/refactor\/rebuild"/u);
  assert.match(html, />docs\/refactor\/rebuild<\/span><small[^>]*>2 files<\/small>/u);
});

test("large project trees mount no more than the shared architecture budget", () => {
  const paths = Array.from({ length: 1_000 }, (_, index) => `file-${String(index).padStart(4, "0")}.ts`);
  const tree = buildProjectTree(paths);
  const window = projectTreeRenderWindow(paths.length, PROJECT_TREE_ROW_HEIGHT * 700, 700);
  const html = renderProjectNavigation(state(), tree, PROJECT_TREE_ROW_HEIGHT * 700, 700);
  const mounted = html.match(/data-project-node=/g)?.length ?? 0;

  assert.ok(window.start > 0);
  assert.ok(window.end < paths.length);
  assert.ok(mounted <= PROJECT_TREE_MOUNT_LIMIT);
  assert.match(html, /project-virtual-spacer/);
});

test("project tree renders inline rename/create states and cut descendants", () => {
  const state = {
    root: "/workspace", paths: ["src/app.ts"],
    files: [{ repositoryId: ".", path: "src/app.ts", workspacePath: "src/app.ts" }],
    ignoredEntries: [], loading: false, error: null, truncated: false,
    selection: { path: "src/app.ts", kind: "file" }, expandedDirectories: new Set(["src"]),
  };
  const tree = buildProjectTree(["src/app.ts"]);
  const rename = {
    inlineEdit: {
      kind: "rename", anchorPath: "src/app.ts", anchorKind: "file", parentPath: "src",
      sourcePath: "src/app.ts", sourceKind: "file", value: "app.ts", error: null, busy: false,
    },
    dialog: null, busyPath: null,
  };
  const renameMarkup = renderProjectNavigation(state, tree, 0, 500, EN_US.projectFiles, rename, null);
  assert.match(renameMarkup, /data-project-entry-edit="rename"/u);
  assert.doesNotMatch(renameMarkup, /data-project-file="src\/app\.ts"/u);

  const create = {
    inlineEdit: {
      kind: "create", anchorPath: "src", anchorKind: "directory", parentPath: "src",
      sourcePath: null, sourceKind: null, value: "", error: null, busy: false,
    },
    dialog: null, busyPath: null,
  };
  const createMarkup = renderProjectNavigation(state, tree, 0, 500, EN_US.projectFiles, create, "src");
  assert.match(createMarkup, /data-project-entry-edit="create"/u);
  assert.match(createMarkup, /project-node-cut/u);
});

test("trash dialog reports bounded recursive and hidden-entry counts", () => {
  const target = {
    workspaceRoot: "/workspace", workspaceGeneration: 1, workspacePath: "src", kind: "directory",
    file: null, status: "unmodified", readOnly: false,
  };
  const markup = renderWorkspaceTrashDialog({
    planningTarget: null,
    dialog: {
      target, planId: "plan", busy: false,
      preview: {
        planId: "plan", operation: { kind: "trash", source: "src" }, collisionPolicy: "cancel",
        source: null, entryCount: 4, totalBytes: 12, hiddenEntryCount: 1,
        fingerprint: "fingerprint", blockers: [],
      },
    },
  }, {
    title: EN_US.projectFiles.contextMenu.confirmTrashTitle,
    cancel: EN_US.projectFiles.contextMenu.cancel,
    confirm: EN_US.projectFiles.contextMenu.confirmTrash,
    working: EN_US.projectFiles.contextMenu.working,
    fileDetail: EN_US.projectFiles.contextMenu.trashFileDetail,
    folderDetail: EN_US.projectFiles.contextMenu.trashFolderDetail,
  });
  assert.match(markup, /role="alertdialog"/u);
  assert.match(markup, /4 entries \(12 bytes\)/u);
  assert.match(markup, /1 hidden entries/u);
});

function state() {
  return {
    root: "/repo",
    paths: [],
    files: [],
    ignoredEntries: [],
    loading: false,
    error: null,
    truncated: false,
    selection: null,
    expandedDirectories: new Set(),
  };
}
