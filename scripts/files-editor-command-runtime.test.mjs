import test from "node:test";
import assert from "node:assert/strict";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import {
  DIFF_COMMANDS,
  EDITOR_COMMANDS,
  FILES_COMMANDS,
} from "../src/application/commands/files-editor-command-ids.ts";
import { registerFilesEditorCommands } from "../src/composition/files-editor-command-runtime.ts";

function button() {
  return {
    disabled: false,
    clicks: 0,
    click() { this.clicks += 1; },
    getAttribute: () => null,
  };
}

function catalog() {
  return {
    shell: { editor: "Editor", showOpenFiles: "Show open files" },
    projectFiles: {
      locateCurrentFile: "Locate current file",
      expandSelectedFolder: "Expand selected folder",
      collapseSelectedFolder: "Collapse selected folder",
      projectFiles: "Project files",
    },
    editor: {
      closeFile: (name) => `Close ${name}`,
      sourceTitle: "Edit Markdown source",
      splitTitle: "Edit source with live preview",
      previewTitle: "Rendered preview",
      previousChange: "Previous change",
      nextChange: "Next change",
      previousFile: "Previous file",
      nextFile: "Next file",
      openSource: "Open source",
      expandUnchanged: "Expand unchanged",
      unifiedTitle: "Unified Diff",
      sideBySideTitle: "Side-by-side Diff",
      whitespaceTitle: "Show whitespace",
      diffToolbar: "Diff navigation and presentation",
    },
    settings: { keybindings: {
      workspaceRequired: "Workspace required",
      editorRequired: "Editor required",
    } },
  };
}

test("Files, Editor, and Diff commands invoke the existing enabled button route", async () => {
  const locate = button();
  const close = button();
  const nextChange = button();
  const targets = new Map([
    ["#locate-project-file", locate],
    ['.editor-tab[aria-selected="true"] [data-close-editor-tab-index], .editor-tab[aria-selected="true"] [data-close-editor-pinned-preview-index], .editor-tab[aria-selected="true"] [data-close-editor-preview]', close],
    ['[data-diff-action="next-change"]', nextChange],
  ]);
  const registry = new CommandRegistry();
  const release = registerFilesEditorCommands(registry, {
    root: { querySelector: (selector) => targets.get(selector) ?? null },
    catalog,
  });

  assert.equal(registry.get(FILES_COMMANDS.locateActive).title(), "Locate current file");
  assert.equal(registry.get(EDITOR_COMMANDS.closeTab).title(), "Close Editor");
  assert.equal(registry.get(DIFF_COMMANDS.nextChange).title(), "Next change");
  assert.equal(registry.get(FILES_COMMANDS.locateActive).availability().enabled, true);
  await registry.get(FILES_COMMANDS.locateActive).execute("keyboard");
  await registry.get(EDITOR_COMMANDS.closeTab).execute("palette");
  await registry.get(DIFF_COMMANDS.nextChange).execute("keyboard");
  assert.equal(locate.clicks, 1);
  assert.equal(close.clicks, 1);
  assert.equal(nextChange.clicks, 1);

  nextChange.disabled = true;
  assert.deepEqual(registry.get(DIFF_COMMANDS.nextChange).availability(), {
    enabled: false,
    reason: "Editor required",
  });
  release();
  assert.deepEqual(registry.list(), []);
});
