import { definitionGestureExtension } from "./language-definition-gesture.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import type { LanguageServiceCopy } from "../../localization/language-service-copy.ts";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { lintGutter, type Diagnostic } from "@codemirror/lint";
import { EditorView, hoverTooltip } from "@codemirror/view";
import type { EditorLanguageServicePort, EditorLanguageServiceHandle, EditorLanguageServiceDiagnostic, EditorLanguageServicePosition, EditorLanguageServiceCompletionItem } from "../../protocol/editor-language-service.ts";
export interface LanguageEditorContext {
  readonly port: EditorLanguageServicePort; readonly handle: EditorLanguageServiceHandle;
  version(): number; active(): boolean; flush(): void;
  definitionUi?: { menu: ContextMenuPort; copy(): LanguageServiceCopy; status(message: string, kind: "information" | "warning"): void };
}
export function languageServiceEditorExtensions(context: LanguageEditorContext, complete = (completion: CompletionContext) => completeLanguageService(context, completion)) {
  return [lintGutter(), autocompletion({ override: [complete] }),
    hoverTooltip((view, pos) => hover(context, view, pos)),
    definitionGestureExtension(context)];
}
export function languageDiagnostic(view: EditorView, diagnostic: EditorLanguageServiceDiagnostic): Diagnostic {
  const offset = (position: EditorLanguageServicePosition) => { const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, position.line + 1))); return Math.min(line.to, line.from + Math.max(0, position.character)); };
  const from = offset(diagnostic.range.start), to = Math.max(from, offset(diagnostic.range.end));
  return { from, to, severity: diagnostic.severity === 1 ? "error" : diagnostic.severity === 2 ? "warning" : "info", message: diagnostic.message, source: diagnostic.source };
}
async function hover(context: LanguageEditorContext, view: EditorView, pos: number) {
  if (!context.active()) return null; context.flush(); const version = context.version();
  const line = view.state.doc.lineAt(pos);
  const response = await context.port.request<{ contents?: unknown }>(context.handle, "textDocument/hover", { position: { line: line.number - 1, character: pos - line.from } }, version);
  if (!response || !context.active() || context.version() !== version) return null;
  const content = response.contents;
  const part = (value: unknown): string => typeof value === "string" ? value : value && typeof value === "object" && "value" in value && typeof value.value === "string" ? value.value : "";
  const plain = (Array.isArray(content) ? content.map(part).join("\n") : part(content)).slice(0, 65536);
  if (!plain) return null;
  return { pos, end: pos, above: true, create: () => { const dom = document.createElement("div"); dom.className = "cm-tooltip-language-service"; dom.textContent = plain; return { dom }; } };
}
export async function completeLanguageService(context: LanguageEditorContext, completion: CompletionContext): Promise<CompletionResult | null> {
  if (!context.active()) return null; context.flush(); const version = context.version();
  const line = completion.state.doc.lineAt(completion.pos);
  const response = await context.port.request<{ items?: readonly EditorLanguageServiceCompletionItem[] } | readonly EditorLanguageServiceCompletionItem[]>(context.handle, "textDocument/completion", { position: { line: line.number - 1, character: completion.pos - line.from } }, version);
  if (!response || !context.active() || context.version() !== version) return null;
  const from = completion.matchBefore(/[\w$]*/)?.from ?? completion.pos;
  const items = Array.isArray(response) ? response : "items" in response ? response.items ?? [] : [];
  const offset = (position: EditorLanguageServicePosition): number | null => {
    if (!Number.isSafeInteger(position?.line) || !Number.isSafeInteger(position?.character) || position.line < 0 || position.line >= completion.state.doc.lines || position.character < 0) return null;
    const line = completion.state.doc.line(position.line + 1), result = line.from + position.character;
    if (result > line.to) return null;
    const before = completion.state.doc.sliceString(result - 1, result).charCodeAt(0), after = completion.state.doc.sliceString(result, result + 1).charCodeAt(0);
    return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff ? null : result;
  };
  return { from, options: items.slice(0, 512).filter((item: EditorLanguageServiceCompletionItem) => typeof item.label === "string" && item.label.length <= 1024 && typeof (item.textEdit?.newText ?? item.insertText ?? item.label) === "string" && (item.textEdit?.newText ?? item.insertText ?? item.label).length <= 65536 && item.insertTextFormat !== 2 && !item.insertReplaceEdit && !item.additionalTextEdits?.length && !item.command).map((item: EditorLanguageServiceCompletionItem) => ({
    label: item.label, detail: item.detail, type: "text", apply: (view: EditorView, _option: unknown, _from: number, to: number) => {
      if (!context.active() || context.version() !== version) return;
      const edit = item.textEdit; if (edit && !("range" in edit)) return;
      const start = edit ? offset(edit.range.start) : from, end = edit ? offset(edit.range.end) : to;
      if (start === null || end === null || start > end) return;
      view.dispatch({ changes: { from: start, to: end, insert: edit?.newText ?? item.insertText ?? item.label }, userEvent: "input.complete" });
    },
  })) };
}
