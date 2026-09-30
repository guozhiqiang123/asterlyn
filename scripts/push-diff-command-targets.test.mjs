import assert from "node:assert/strict";
import test from "node:test";

import { DIFF_COMMANDS } from "../src/application/commands/files-editor-command-ids.ts";
import { FILES_EDITOR_DOM_COMMANDS } from "../src/presentation/files-editor-command-targets.ts";

test("shared Diff commands prefer Push Diff controls and support dialog scope", () => {
  const definitions = new Map(FILES_EDITOR_DOM_COMMANDS.map((definition) => [definition.id, definition]));
  const selectors = new Map([
    [DIFF_COMMANDS.previousChange, '#push-diff-backdrop [data-push-diff-action="previous-change"]'],
    [DIFF_COMMANDS.nextChange, '#push-diff-backdrop [data-push-diff-action="next-change"]'],
    [DIFF_COMMANDS.previousFile, '#push-diff-backdrop [data-push-diff-action="previous-file"]'],
    [DIFF_COMMANDS.nextFile, '#push-diff-backdrop [data-push-diff-action="next-file"]'],
    [DIFF_COMMANDS.openSource, '#push-diff-backdrop [data-push-diff-action="open-source"]'],
    [DIFF_COMMANDS.toggleUnchanged, '#push-diff-backdrop [data-push-diff-action="toggle-unchanged"]'],
    [DIFF_COMMANDS.unified, '#push-diff-backdrop [data-push-diff-layout="unified"]'],
    [DIFF_COMMANDS.split, '#push-diff-backdrop [data-push-diff-layout="split"]'],
    [DIFF_COMMANDS.toggleWhitespace, "#push-diff-backdrop [data-push-diff-whitespace]"],
  ]);

  for (const [id, pushSelector] of selectors) {
    const definition = definitions.get(id);
    assert.ok(definition, `${id} must remain registered`);
    assert.equal(definition.selector.startsWith(pushSelector), true, `${id} must prefer Push Diff`);
    assert.match(definition.selector, /not\(:has\(#push-diff-backdrop\)\)/u);
    assert.equal(definition.scopes.includes("dialog"), true, `${id} must be dialog-scoped`);
  }
});
