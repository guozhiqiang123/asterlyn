import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { EditorNavigationUpdate } from "./editor-navigation-history.ts";

/** CodeMirror coordinates and user-event annotations stop at this adapter. */
export function editorNavigationUpdate(view: EditorView, tabId: string, update?: ViewUpdate): EditorNavigationUpdate {
  const { anchor, head } = view.state.selection.main;
  return {
    tabId, anchor, head, line: view.state.doc.lineAt(head).number,
    kind: !update ? "activation" : update.docChanged ? "edit"
      : update.transactions.some(transaction => transaction.isUserEvent("select.pointer")) ? "pointer"
        : update.transactions.some(transaction => transaction.isUserEvent("select")) ? "move" : "jump",
    ...(update?.docChanged ? {
      mapPosition: (position: number) => update.changes.mapPos(Math.min(position, update.startState.doc.length)),
    } : {}),
  };
}

export function validEditorRange(length: number | undefined, from: number, to: number): boolean {
  return length !== undefined && Number.isInteger(from) && Number.isInteger(to)
    && from >= 0 && to >= from && to <= length;
}
