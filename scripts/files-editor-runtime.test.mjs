import assert from "node:assert/strict";
import test from "node:test";

import { FilesEditorRuntime } from "../src/features/files-editor/files-editor-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("Files and Editor runtime owns file, editor, search, replacement, and command state", () => {
  const notifications = [];
  let searchCancellations = 0;
  let replacementCancellations = 0;
  const runtime = new FilesEditorRuntime(
    {
      files: {},
      editor: {},
      workspace: {
        startReplacementPreview: () => ({
          operationId: "replacement-1",
          completion: new Promise(() => {}),
        }),
        cancelSearch: () => {
          searchCancellations += 1;
        },
        cancelReplacement: () => {
          replacementCancellations += 1;
        },
      },
    },
    EN_US.editor,
    {
      filesChanged: (change) => notifications.push(`files:${change.reason}`),
      editorChanged: (change) => notifications.push(`editor:${change.reason}`),
    },
  );

  runtime.files.installWorkspace("/repo");
  runtime.editor.installWorkspace("/repo");
  runtime.commands.open("workspace", "needle");
  assert.deepEqual(runtime.commands.state, {
    mode: "workspace",
    query: "needle",
    selectedIndex: 0,
  });
  void runtime.replacement.preview(
    { root: "/repo", generation: 1 },
    {
      generation: 1,
      repositoryGeneration: 1,
      repositoryRoot: "/repo",
      requestId: "search-1",
      query: "needle",
      options: { mode: "plain", includeGlobs: [], excludeGlobs: [], contextLines: 0 },
    },
    String,
  );
  assert.deepEqual(notifications, ["files:workspace", "editor:workspace"]);
  runtime.dispose();
  runtime.dispose();
  runtime.files.installWorkspace(null);
  runtime.editor.installWorkspace(null);
  assert.deepEqual(notifications, ["files:workspace", "editor:workspace"]);
  assert.equal(searchCancellations, 1);
  assert.equal(replacementCancellations, 1);
});
