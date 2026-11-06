import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { EDITOR_CONTENT_CONTEXT_OWNER, type EditorContentContextPort, type EditorContentHandle } from "./editor-content-context.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";

export function editorContentContextExtension(handle: () => EditorContentHandle, active: (view: EditorView) => boolean, port: EditorContentContextPort, host: ContextMenuPort): Extension {
  return ViewPlugin.fromClass(class {
    constructor(private readonly view: EditorView) {
      view.dom.addEventListener("contextmenu", this.contextmenu);
      view.contentDOM.addEventListener("keydown", this.keydown);
    }
    update(update: { docChanged: boolean; selectionSet: boolean }): void {
      if (update.docChanged || update.selectionSet) host.revalidate();
    }
    destroy(): void {
      this.view.dom.removeEventListener("contextmenu", this.contextmenu);
      this.view.contentDOM.removeEventListener("keydown", this.keydown);
      host.close(EDITOR_CONTENT_CONTEXT_OWNER);
    }
    private readonly keydown = (event: KeyboardEvent): void => {
      if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey)) return;
      const coords = this.view.coordsAtPos(this.view.state.selection.main.head);
      if (!coords) return;
      event.preventDefault(); event.stopPropagation();
      this.open(coords.left, coords.bottom);
    };
    private readonly contextmenu = (event: MouseEvent): void => {
      if (event.defaultPrevented || !(event.target instanceof Element) ||
          event.target.closest(".cm-gutters, .cm-panels, .cm-tooltip") || !this.view.scrollDOM.contains(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      this.open(event.clientX, event.clientY);
    };
    private open(x: number, y: number): void {
      const view = this.view, captured = view.state, target = { ...handle() };
      const targetCurrent = () => active(view) && handle().tabId === target.tabId && handle().loadEpoch === target.loadEpoch && handle().path === target.path &&
        view.state.doc === captured.doc && view.state.readOnly === captured.readOnly;
      const current = () => targetCurrent() && view.state.selection.eq(captured.selection);
      port.open({
        handle: target, anchor: { x, y }, readOnly: captured.readOnly,
        hasSelection: captured.selection.ranges.some(range => !range.empty),
        selectedText: captured.selection.ranges.filter(range => !range.empty).map(range => captured.doc.sliceString(range.from, range.to)).join("\n"),
        isCurrent: current, isTargetCurrent: targetCurrent,
        restoreFocus: () => {
          if (!active(view)) return;
          // Focusable overlays can clear native read-only selections. Keep the
          // captured intent while the menu owns focus, then restore before invoke.
          if (targetCurrent() && !view.state.selection.eq(captured.selection)) view.dispatch({ selection: captured.selection });
          view.focus();
        },
        replaceSelection: (text, kind) => {
          if (!current() || view.state.readOnly) return;
          view.dispatch(view.state.replaceSelection(text), { userEvent: kind === "cut" ? "delete.cut" : "input.paste", scrollIntoView: true });
        },
        replaceDocument: text => {
          if (!current() || view.state.readOnly) return;
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(Math.min(captured.selection.main.head, text.length)), userEvent: "input.rollback" });
        },
      });
    }
  });
}
