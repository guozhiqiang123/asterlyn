import assert from "node:assert/strict";
import test from "node:test";

import {
  RECENT_FILE_LIMIT,
  closeCommandSurface,
  createCommandSurfaceState,
  loadRecentFiles,
  moveCommandSurfaceSelection,
  openCommandSurface,
  projectFileKey,
  rankCommands,
  rankProjectFiles,
  touchRecentFile,
  updateCommandSurfaceQuery,
} from "../src/workbench/navigation.ts";

function file(path, repositoryId = ".") {
  return { repositoryId, path, workspacePath: path };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("quick open favors basename matches and supports ordered subsequences", () => {
  const files = [
    file("src/workbench/project-tree.ts"),
    file("src/app.ts"),
    file("scripts/app.test.mjs"),
    file("docs/application.md"),
  ];
  assert.deepEqual(
    rankProjectFiles(files, "app").map((item) => item.workspacePath),
    ["src/app.ts", "scripts/app.test.mjs", "docs/application.md"],
  );
  assert.equal(rankProjectFiles(files, "prtree")[0]?.workspacePath, "src/workbench/project-tree.ts");
});

test("empty quick open puts repository-scoped recent files first", () => {
  const files = [file("b.ts"), file("a.ts"), file("submodule/a.ts", "submodule")];
  const ranked = rankProjectFiles(files, "", [files[2], files[0]]);
  assert.deepEqual(ranked.map(projectFileKey), ["submodule\0submodule/a.ts", ".\0b.ts", ".\0a.ts"]);
});

test("recent files are validated, deduplicated, bounded, and isolated by repository", () => {
  const storage = memoryStorage();
  const available = Array.from({ length: RECENT_FILE_LIMIT + 2 }, (_, index) =>
    file(`${index}.ts`),
  );
  for (const item of available) touchRecentFile(storage, "recent", "/one", item);
  touchRecentFile(storage, "recent", "/one", available.at(-1));
  touchRecentFile(storage, "recent", "/two", file("other.ts"));

  const loaded = loadRecentFiles(storage, "recent", "/one", available);
  assert.equal(loaded.length, RECENT_FILE_LIMIT);
  assert.equal(loaded[0]?.workspacePath, `${RECENT_FILE_LIMIT + 1}.ts`);
  assert.equal(new Set(loaded.map(projectFileKey)).size, loaded.length);
  assert.deepEqual(loadRecentFiles(storage, "recent", "/two", available), []);
});

test("malformed recent preferences fail closed", () => {
  const storage = memoryStorage({ recent: "not json" });
  assert.deepEqual(loadRecentFiles(storage, "recent", "/repo", [file("a.ts")]), []);
});

test("command ranking keeps enabled matches ahead of disabled matches", () => {
  const commands = [
    { id: "save", label: "Save File", detail: "Save active editor", enabled: false },
    { id: "find-files", label: "Find in Files", detail: "Search workspace", enabled: true },
    { id: "files", label: "Go to File", detail: "Open project file", enabled: true },
  ];
  const ranked = rankCommands(commands, "file");
  assert.deepEqual(ranked.map((command) => command.id), ["files", "find-files", "save"]);
});

test("command surface resets query selection and wraps keyboard movement", () => {
  let state = openCommandSurface(createCommandSurfaceState(), "files");
  state = moveCommandSurfaceSelection(state, -1, 3);
  assert.equal(state.selectedIndex, 2);
  state = updateCommandSurfaceQuery(state, "app");
  assert.equal(state.selectedIndex, 0);
  assert.equal(state.query, "app");
  state = closeCommandSurface(state);
  assert.equal(state.mode, null);
  assert.equal(state.query, "");
});
