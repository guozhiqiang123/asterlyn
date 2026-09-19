import assert from "node:assert/strict";
import test from "node:test";

import { FilesEditorRuntime } from "../src/features/files-editor/files-editor-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("Files and Editor runtime owns both controller lifecycles", () => {
  const notifications = [];
  const runtime = new FilesEditorRuntime(
    { files: {}, editor: {} },
    EN_US.editor,
    {
      filesChanged: (change) => notifications.push(`files:${change.reason}`),
      editorChanged: (change) => notifications.push(`editor:${change.reason}`),
    },
  );

  runtime.files.installWorkspace("/repo");
  runtime.editor.installWorkspace("/repo");
  assert.deepEqual(notifications, ["files:workspace", "editor:workspace"]);
  runtime.dispose();
  runtime.dispose();
  runtime.files.installWorkspace(null);
  runtime.editor.installWorkspace(null);
  assert.deepEqual(notifications, ["files:workspace", "editor:workspace"]);
});
