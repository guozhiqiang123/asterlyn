import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { AppPreferences } from "../../preferences.ts";
import type { GitBlameSource } from "./editor-gutter.ts";

export function readOnlyCodeMirrorFocusAttributes(
  readOnly: boolean,
): { tabindex: "0" } | null {
  return readOnly ? { tabindex: "0" } : null;
}

/**
 * Keeps the CodeMirror content element as the keyboard owner even when the
 * document is read-only. CodeMirror removes `contenteditable` in that state,
 * which otherwise lets pointer selection appear active while key events are
 * still routed from the previously focused workbench surface.
 */
export const codeMirrorFocusOwnership: Extension = [
  EditorView.contentAttributes.of((view) =>
    readOnlyCodeMirrorFocusAttributes(view.state.readOnly)
  ),
  EditorView.domEventHandlers({
    mousedown: (_event, view) => {
      if (view.state.readOnly && !view.hasFocus) view.focus();
      return false;
    },
  }),
];

export function applyEditorPreferences(
  view: EditorView,
  preferences: AppPreferences,
): void {
  view.dom.style.setProperty("--editor-font-size", `${preferences.editorFontSize}px`);
  view.dom.style.setProperty(
    "--editor-line-height",
    preferences.editorLineHeight.toString(),
  );
  view.dom.style.setProperty(
    "--editor-letter-spacing",
    `${preferences.editorLetterSpacing}px`,
  );
}

export function sameBlameSource(
  left: GitBlameSource | null,
  right: GitBlameSource | null,
): boolean {
  return left === right || Boolean(
    left && right &&
      left.repositoryRoot === right.repositoryRoot &&
      left.repositoryId === right.repositoryId &&
      left.path === right.path &&
      left.commitOid === right.commitOid &&
      left.parent === right.parent,
  );
}
