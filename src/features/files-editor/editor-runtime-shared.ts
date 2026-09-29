import type { EditorView } from "@codemirror/view";
import type { AppPreferences } from "../../preferences.ts";
import type { GitBlameSource } from "./editor-gutter.ts";

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
