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

test("concurrent refreshes for one workspace share one catalog read", async () => {
  const pending = deferred();
  let reads = 0;
  const controller = new ProjectFilesController({
    listProjectFiles() {
      reads += 1;
      return pending.promise;
    },
  });
  controller.installWorkspace("/repo");

  const first = controller.refresh();
  const second = controller.refresh();
  assert.equal(first, second);
  assert.equal(reads, 1);

  pending.resolve(catalog("/repo", ["src/main.ts"]));
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(controller.state.paths, ["src/main.ts"]);
});

test("A to B to A starts a new catalog read instead of reusing obsolete A work", async () => {
  const firstA = deferred();
  const b = deferred();
  const finalA = deferred();
  const responses = [firstA.promise, b.promise, finalA.promise];
  const roots = [];
  const controller = new ProjectFilesController({
    listProjectFiles(root) {
      roots.push(root);
      return responses.shift();
    },
  });

  controller.installWorkspace("/a");
  const obsoleteA = controller.refresh();
  controller.installWorkspace("/b");
  const obsoleteB = controller.refresh();
  controller.installWorkspace("/a");
  const currentA = controller.refresh();

  assert.deepEqual(roots, ["/a", "/b", "/a"]);
  firstA.resolve(catalog("/a", ["obsolete-a.txt"]));
  b.resolve(catalog("/b", ["obsolete-b.txt"]));
  finalA.resolve(catalog("/a", ["current-a.txt"]));
  assert.equal(await obsoleteA, false);
  assert.equal(await obsoleteB, false);
  assert.equal(await currentA, true);
  assert.deepEqual(controller.state.paths, ["current-a.txt"]);
});

test("a newly imported workspace starts with every directory collapsed", async () => {
  const controller = new ProjectFilesController({
    async listProjectFiles() {
      return catalog("/repo", ["src/main/app.ts", "docs/guide.md"]);
    },
  });
  controller.installWorkspace("/repo");
  await controller.refresh();

  assert.deepEqual([...controller.state.expandedDirectories], []);
  assert.deepEqual(controller.tree().map((node) => node.path), ["docs", "src"]);
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

test("same-workspace refresh restores disclosure after a build directory disappears transiently", async () => {
  const catalogs = [
    catalog("/repo", ["dist/assets/first.js", "src/main.ts"]),
    catalog("/repo", ["src/main.ts"]),
    catalog("/repo", ["dist/assets/second.js", "src/main.ts"]),
  ];
  const controller = new ProjectFilesController({
    async listProjectFiles() { return catalogs.shift(); },
  });
  controller.installWorkspace("/repo");
  await controller.refresh();
  controller.setDirectoryExpanded("dist", true);
  controller.setDirectoryExpanded("dist/assets", true);

  await controller.refresh();
  assert.deepEqual([...controller.state.expandedDirectories], []);

  await controller.refresh();
  assert.equal(controller.state.expandedDirectories.has("dist"), true);
  assert.equal(controller.state.expandedDirectories.has("dist/assets"), true);
});

test("explicit removal prunes remembered disclosure before a directory is recreated", async () => {
  const catalogs = [
    catalog("/repo", ["dist/assets/first.js", "src/main.ts"]),
    catalog("/repo", ["dist/assets/recreated.js", "src/main.ts"]),
  ];
  const controller = new ProjectFilesController({
    async listProjectFiles() { return catalogs.shift(); },
  });
  controller.installWorkspace("/repo");
  await controller.refresh();
  controller.setDirectoryExpanded("dist", true);
  controller.setDirectoryExpanded("dist/assets", true);

  assert.equal(controller.removeAtOrBelow(["dist"]), true);
  await controller.refresh();

  assert.equal(controller.state.expandedDirectories.has("dist"), false);
  assert.equal(controller.state.expandedDirectories.has("dist/assets"), false);
});

test("workspace switches do not carry remembered disclosure into the next root", async () => {
  const controller = new ProjectFilesController({
    async listProjectFiles(root) { return catalog(root, ["src/main.ts"]); },
  });
  controller.installWorkspace("/one");
  await controller.refresh();
  controller.setDirectoryExpanded("src", true);

  controller.installWorkspace("/two");
  await controller.refresh();

  assert.equal(controller.state.expandedDirectories.has("src"), false);
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
  assert.equal(controller.revealDirectory("src/deep/a.ts"), false);
  assert.equal(controller.revealDirectory("src/deep"), true);
  assert.deepEqual(controller.state.selection, { path: "src/deep", kind: "directory" });
  assert.equal(controller.state.expandedDirectories.has("src"), true);
});

test("optimistic removal prunes exact descendants while preserving prefixed siblings", async () => {
  const changes = [
    change("src/change-only.ts"),
    change("src-old/change.ts"),
  ];
  const controller = new ProjectFilesController({
    async listProjectFiles() {
      return catalog(
        "/repo",
        ["src/a.ts", "src/deep/b.ts", "src-old/keep.ts", "keep.md"],
        [{ workspacePath: "src/ignored", kind: "directory" }],
      );
    },
  });
  controller.installWorkspace("/repo", changes);
  await controller.refresh();
  controller.setDirectoryExpanded("src", true);
  controller.setDirectoryExpanded("src/deep", true);
  controller.select("src/deep/b.ts", "file");
  const events = [];
  controller.subscribe((event) => events.push(event));

  assert.equal(controller.removeAtOrBelow(["src", "src/a.ts"]), true);

  assert.deepEqual(controller.state.paths, ["src-old/keep.ts", "keep.md"]);
  assert.deepEqual(controller.state.files.map((file) => file.workspacePath), ["src-old/keep.ts", "keep.md"]);
  assert.deepEqual(controller.state.ignoredEntries, []);
  assert.equal(controller.state.selection, null);
  assert.equal(controller.state.expandedDirectories.has("src"), false);
  assert.equal(controller.state.expandedDirectories.has("src/deep"), false);
  assert.deepEqual(treePaths(controller.tree()), [
    "src-old", "src-old/change.ts", "src-old/keep.ts", "keep.md",
  ]);
  assert.equal(events.at(-1).reason, "mutation");
});

test("optimistic removal rejects stale catalog completion and allows later convergence", async () => {
  const stale = deferred();
  const catalogs = [
    catalog("/repo", ["gone.txt", "keep.txt"]),
    stale.promise,
    catalog("/repo", ["gone.txt", "keep.txt", "recreated.txt"]),
  ];
  const controller = new ProjectFilesController({
    listProjectFiles() { return Promise.resolve(catalogs.shift()); },
  });
  controller.installWorkspace("/repo");
  await controller.refresh();

  const obsolete = controller.refresh();
  assert.equal(controller.removeAtOrBelow(["gone.txt"]), true);
  stale.resolve(catalog("/repo", ["gone.txt", "keep.txt", "stale.txt"]));

  assert.equal(await obsolete, false);
  assert.deepEqual(controller.state.paths, ["keep.txt"]);
  assert.equal(await controller.refresh(), true);
  assert.deepEqual(controller.state.paths, ["gone.txt", "keep.txt", "recreated.txt"]);
});

test("Trash removal selects the next retained visible row", async () => {
  const controller = new ProjectFilesController({
    async listProjectFiles() { return catalog("/repo", ["a.txt", "b.txt", "c.txt"]); },
  });
  controller.installWorkspace("/repo");
  await controller.refresh();
  controller.select("b.txt", "file");

  assert.equal(controller.removeTrashTargets(["b.txt"]), true);
  assert.deepEqual(controller.state.selection, { path: "c.txt", kind: "file" });
});

test("ignored directories load one level on demand without blocking the initial catalog", async () => {
  const directory = deferred();
  let directoryReads = 0;
  const controller = new ProjectFilesController({
    async listProjectFiles() {
      return catalog("/repo", ["src/main.ts"], [
        { workspacePath: "build", kind: "directory" },
      ]);
    },
    listIgnoredProjectDirectory(root, path) {
      directoryReads += 1;
      assert.equal(root, "/repo");
      assert.equal(path, "build");
      return directory.promise;
    },
  });
  controller.installWorkspace("/repo");

  assert.equal(await controller.refresh(), true);
  assert.deepEqual(treePaths(controller.tree()), ["build", "src", "src/main.ts"]);
  assert.equal(controller.setDirectoryExpanded("build", true), true);
  assert.equal(controller.state.loadingDirectories.has("build"), true);
  assert.equal(controller.setDirectoryExpanded("build", true), false);
  assert.equal(directoryReads, 1);
  assert.equal(await controller.refresh(), true);
  assert.equal(controller.state.loadingDirectories.has("build"), true);

  directory.resolve({
    root: "/repo",
    paths: [],
    files: [{
      repositoryId: ".", path: "build/output.txt", workspacePath: "build/output.txt",
      readOnly: false, ignored: true,
    }],
    ignoredEntries: [
      { workspacePath: "build/cache", kind: "directory" },
      { workspacePath: "build/output.txt", kind: "file" },
    ],
    repositoryRoots: [],
    truncated: false,
  });

  assert.equal(await controller.loadIgnoredDirectory("build"), true);
  assert.equal(controller.state.loadingDirectories.has("build"), false);
  assert.deepEqual(treePaths(controller.tree()), [
    "build", "build/cache", "build/output.txt", "src", "src/main.ts",
  ]);
  assert.equal(controller.fileForWorkspacePath("build/output.txt")?.ignored, true);
});

function catalog(root, paths, ignoredEntries = []) {
  return {
    root,
    paths,
    files: paths.map((path) => ({ repositoryId: ".", path, workspacePath: path })),
    ignoredEntries,
    repositoryRoots: [],
    truncated: false,
  };
}

function change(path) {
  return {
    path, originalPath: null, indexStatus: "unmodified", worktreeStatus: "modified",
    conflicted: false, submodule: false,
  };
}

function treePaths(nodes) {
  return nodes.flatMap((node) => [node.path, ...treePaths(node.children)]);
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
