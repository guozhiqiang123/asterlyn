import assert from "node:assert/strict";
import test from "node:test";

import { ProjectFilesController } from "../src/features/files-editor/project-files-controller.ts";

test("identical watch snapshots preserve tree identity and a collapsed folder", async () => {
  const controller = new ProjectFilesController({ async listProjectFiles() { return catalog("/repo", ["docs/one.md", "docs/two.md"]); } });
  const change = { path: "docs/one.md", originalPath: null, indexStatus: "unmodified", worktreeStatus: "modified", conflicted: false, submodule: false };
  controller.installWorkspace("/repo", [change]);
  await controller.refresh();
  controller.setDirectoryExpanded("docs", false);
  const tree = controller.tree();
  const events = [];
  controller.subscribe((event) => events.push(event));
  for (let index = 0; index < 3; index++) {
    controller.installWorkspace("/repo", [{ ...change }]);
    controller.updateChanges([{ ...change }]);
    await controller.refresh();
  }
  assert.equal(controller.tree(), tree);
  assert.equal(controller.state.expandedDirectories.has("docs"), false);
  assert.equal(events.some((event) => event.catalogChanged), false);
});

test("latest workspace owns project catalog completion", async () => {
  const first = deferred();
  const second = deferred();
  const responses = [first.promise, second.promise];
  const controller = new ProjectFilesController({
    listProjectFiles: () => responses.shift(),
  });
  controller.installWorkspace("/one");
  const old = controller.refresh();
  controller.installWorkspace("/two");
  const current = controller.refresh();
  first.resolve(catalog("/one", ["old.txt"]));
  second.resolve(catalog("/two", ["new.txt"]));

  assert.equal(await old, false);
  assert.equal(await current, true);
  assert.deepEqual(controller.state.paths, ["new.txt"]);
});

test("same-workspace refresh retains valid selection and disclosure", async () => {
  const catalogs = [
    catalog("/repo", ["src/a.ts", "src/b.ts"]),
    catalog("/repo", ["src/a.ts", "src/c.ts"]),
  ];
  const controller = new ProjectFilesController({
    async listProjectFiles() { return catalogs.shift(); },
  });
  controller.installWorkspace("/repo");
  await controller.refresh();
  controller.select("src", "directory");
  controller.setDirectoryExpanded("src", true);
  await controller.refresh();

  assert.deepEqual(controller.state.selection, { path: "src", kind: "directory" });
  assert.equal(controller.state.expandedDirectories.has("src"), true);
});

test("status updates rebuild tree without replacing catalog identity", async () => {
  const controller = new ProjectFilesController({
    async listProjectFiles() { return catalog("/repo", ["a.txt"]); },
  });
  controller.installWorkspace("/repo");
  await controller.refresh();
  const files = controller.state.files;
  controller.updateChanges([{ path: "a.txt", originalPath: null, indexStatus: "unmodified", worktreeStatus: "modified", conflicted: false, submodule: false }]);

  assert.equal(controller.state.files, files);
  assert.equal(controller.tree()[0].status, "modified");
});

test("reveal expands ancestors and rejects paths outside the catalog", async () => {
  const controller = new ProjectFilesController({
    async listProjectFiles() { return catalog("/repo", ["src/deep/a.ts"]); },
  });
  controller.installWorkspace("/repo");
  await controller.refresh();

  assert.equal(controller.revealFile("missing.ts"), false);
  assert.equal(controller.revealFile("src/deep/a.ts"), true);
  assert.deepEqual(controller.state.selection, { path: "src/deep/a.ts", kind: "file" });
  assert.equal(controller.state.expandedDirectories.has("src"), true);
  assert.equal(controller.state.expandedDirectories.has("src/deep"), true);
});

function catalog(root, paths) {
  return {
    root,
    paths,
    files: paths.map((path) => ({ repositoryId: ".", path, workspacePath: path })),
    ignoredEntries: [],
    repositoryRoots: [],
    truncated: false,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
