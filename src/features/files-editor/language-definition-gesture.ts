import { LanguageServiceIndexingError } from "../../protocol/editor-language-service.ts";
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { LanguageEditorContext } from "./language-service-editor.ts";
import { isCurrentSymbolDefinition, normalizeDefinitionTargets } from "../../application/language-services/definition-targets.ts";
import { LanguageLocationPicker } from "./language-location-picker.ts";

export function definitionModifier(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): boolean {
  return !event.shiftKey && !event.altKey && (event.ctrlKey || (mac && event.metaKey));
}
class DefinitionGesture {
  private readonly picker = new LanguageLocationPicker();
  decorations: DecorationSet = Decoration.none;
  private sequence = 0;
  private alive = true;
  private choosing = false;
  private lastPointer: { x: number; y: number } | null = null;
  private gesture: { pos: number; x: number; y: number; version: number; dragged: boolean } | null = null;
  private suppressContextUntil = 0;
  private readonly document: Document;
  private readonly window: Window;
  private readonly mac: boolean;
  readonly view: EditorView; readonly context: LanguageEditorContext;
  constructor(view: EditorView, context: LanguageEditorContext) {
    this.view = view; this.context = context;
    this.document = view.dom.ownerDocument; this.window = this.document.defaultView!;
    this.mac = /Mac|iPhone|iPad/u.test(this.window.navigator.platform);
    this.document.addEventListener("keydown", this.modifier, true);
    this.document.addEventListener("keyup", this.modifier);
    this.document.addEventListener("mouseup", this.mouseup, true);
    this.window.addEventListener("blur", this.windowBlur);
  }
  private current(token: number, version: number): boolean { return this.alive && this.sequence === token && this.context.active() && this.context.version() === version; }
  private marked: string | null = null;
  private clear(repaint = true): void { if (this.marked !== null) { this.marked = null; this.decorations = Decoration.none; if (repaint) this.view.dispatch({}); } }
  private cancel(repaint = true): void { this.sequence++; this.gesture = null; this.choosing = false; this.picker.close(false); this.clear(repaint); }
  update(update: ViewUpdate): void {
    // WebKit may move its DOM selection during Control-click before mouseup.
    // The held gesture still addresses the hit-tested symbol, independently of that caret.
    if (update.docChanged || (update.selectionSet && !this.gesture)) this.cancel(false);
  }
  private candidate(event: { clientX: number; clientY: number; target: EventTarget | null }): number | null {
    if (!this.view.contentDOM.contains(event.target as Node) || !this.context.active()) return null;
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return null;
    const word = this.view.state.wordAt(pos); if (!word) return null;
    const from = this.view.coordsAtPos(word.from), to = this.view.coordsAtPos(word.to);
    return from && to && event.clientX >= Math.min(from.left, to.left) - 1 && event.clientX <= Math.max(from.left, to.left) + 1 ? pos : null;
  }
  move(event: MouseEvent): boolean {
    this.lastPointer = { x: event.clientX, y: event.clientY };
    if (this.gesture && Math.hypot(event.clientX - this.gesture.x, event.clientY - this.gesture.y) > 5) this.gesture.dragged = true;
    this.markAt(event.clientX, event.clientY, !event.buttons && definitionModifier(event, this.mac), event.target); return false;
  }
  private markAt(x: number, y: number, modifier: boolean, target: EventTarget | null): void {
    const pos = modifier ? this.candidate({ clientX: x, clientY: y, target }) : null;
    const word = pos === null ? null : this.view.state.wordAt(pos);
    const hint = this.context.definitionUi?.copy().pointerHint ?? "Ctrl-click to go to definition";
    const key = word ? `${word.from}:${word.to}:${hint}` : null;
    if (this.marked === key) return;
    this.marked = key;
    this.decorations = word ? Decoration.set([Decoration.mark({ class: "cm-definition-link", attributes: { title: hint } }).range(word.from, word.to)]) : Decoration.none;
    this.view.dispatch({});
  }
  down(event: MouseEvent): boolean {
    // Clearing the underline can detach a highlighted token's span (the event target).
    // Hit-test before repainting; later stages use the stored position and version.
    const pos = event.button === 0 && definitionModifier(event, this.mac) ? this.candidate(event) : null;
    this.cancel(); this.suppressContextUntil = 0;
    if (pos === null) return false;
    this.gesture = { pos, x: event.clientX, y: event.clientY, version: this.context.version(), dragged: false };
    this.suppressContextUntil = performance.now() + 750;
    this.view.focus(); event.preventDefault(); return true;
  }
  contextmenu(event: MouseEvent): boolean {
    if (event.ctrlKey && this.suppressContextUntil > performance.now()) { event.preventDefault(); return true; }
    return false;
  }
  leave(): boolean { this.lastPointer = null; this.clear(); return false; }
  blur(): boolean { this.clear(); if (!this.choosing) this.cancel(); return false; }
  private readonly modifier = (event: KeyboardEvent): void => {
    if (this.view.hasFocus && this.context.active()) {
      if ((event.key === "F12" || (event.key === "F7" && event.altKey)) && event.repeat) { event.preventDefault(); return; }
      if (event.key === "Escape") this.cancel();
    }
    if (event.key !== "Control" && event.key !== "Meta") return;
    if (!definitionModifier(event, this.mac)) { this.clear(); return; }
    if (this.lastPointer) {
      this.markAt(this.lastPointer.x, this.lastPointer.y, true, this.document.elementFromPoint(this.lastPointer.x, this.lastPointer.y));
    }
  };
  private readonly windowBlur = (): void => this.cancel();
  private readonly mouseup = (event: MouseEvent): void => {
    const gesture = this.gesture; this.gesture = null;
    if (!gesture || event.button !== 0 || gesture.dragged || !definitionModifier(event, this.mac) || !this.context.active() || this.context.version() !== gesture.version || !this.view.contentDOM.contains(event.target as Node)) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) return;
    void this.lookup(gesture.pos, { x: event.clientX, y: event.clientY });
  };
  async lookup(pos: number, anchor?: { x: number; y: number }, intent: "definition" | "references" = "definition"): Promise<void> {
    this.cancel(); if (!this.context.active()) return;
    const token = ++this.sequence; this.context.flush(); const version = this.context.version();
    const line = this.view.state.doc.lineAt(pos), ui = this.context.definitionUi;
    const position = { line: line.number - 1, character: pos - line.from }, uri = this.context.port.documentUri;
    const word = this.view.state.wordAt(pos), symbol = word ? { start: { line: position.line, character: word.from - line.from }, end: { line: position.line, character: word.to - line.from } } : null;
    let kind = intent;
    const trace = (outcome: "requested" | "discarded" | "invalid" | "empty" | "selected" | "choices", targetCount = 0) => this.context.port.definitionEvent?.({ kind, outcome, targetCount });
    let requestError: unknown = null;
    const failed = () => {
      if (requestError === null) return false;
      if (this.current(token, version)) ui?.status(requestError instanceof LanguageServiceIndexingError ? ui.copy().indexing : ui.copy().requestFailed, requestError instanceof LanguageServiceIndexingError ? "information" : "warning");
      trace("discarded"); return true;
    };
    const request = async () => {
      trace("requested"); ui?.status(kind === "references" ? ui.copy().findingReferences : ui.copy().findingDefinition, "information");
      return this.context.port.request(this.context.handle, `textDocument/${kind}`, { position }, version).catch((error: unknown) => { requestError = error ?? new Error("Language request failed"); return null; });
    };
    let response = await request(); if (failed()) return;
    if (!this.current(token, version)) { trace("discarded"); return; }
    let result = normalizeDefinitionTargets(response, kind);
    const missingDefinition = kind === "definition" && !result.locations.length && !result.invalid && !result.limited;
    // Servers can return no definition when the pointer is already on its declaration.
    // Ask the semantic service for usages before reporting an unresolved symbol.
    if (kind === "definition" && !result.invalid && !result.limited && (missingDefinition || (result.locations.length === 1 && isCurrentSymbolDefinition(result.locations[0]!, uri, symbol)))) {
      kind = "references"; response = await request(); if (failed()) return;
      if (!this.current(token, version)) { trace("discarded"); return; }
      result = normalizeDefinitionTargets(response, kind);
    }
    if (!result.locations.length) {
      trace(result.invalid ? "invalid" : "empty");
      ui?.status(result.invalid ? ui.copy().invalidDefinition : missingDefinition ? ui.copy().noDefinition : kind === "references" ? ui.copy().noReferences : ui.copy().noDefinition, "warning"); return;
    }
    const navigate = (location: (typeof result.locations)[number]) => {
      if (!this.current(token, version)) return;
      trace("selected", result.locations.length);
      this.context.port.navigate?.(location);
    };
    if (result.locations.length === 1 && !result.limited && intent !== "references") { navigate(result.locations[0]!); return; }
    trace("choices", result.locations.length);
    if (!ui) return;
    this.choosing = true;
    const title = kind === "references" ? ui.copy().chooseReference : ui.copy().chooseDefinition;
    ui.status(title, "information");
    const caret = this.view.coordsAtPos(pos);
    this.picker.open(this.document, anchor ?? { x: caret?.left ?? 0, y: caret?.bottom ?? 0 }, result.locations, {
      title, limited: result.limited, copy: ui.copy(), current: () => this.current(token, version), select: navigate,
      dismissed: () => { this.choosing = false; }, restoreFocus: () => { if (this.context.active()) this.view.focus(); },
    });
  }
  destroy(): void {
    this.cancel(false); this.alive = false;
    this.document.removeEventListener("keydown", this.modifier, true); this.document.removeEventListener("keyup", this.modifier);
    this.document.removeEventListener("mouseup", this.mouseup, true); this.window.removeEventListener("blur", this.windowBlur);
  }
}
export function definitionGestureExtension(context: LanguageEditorContext) {
  const plugin = ViewPlugin.fromClass(class extends DefinitionGesture { constructor(view: EditorView) { super(view, context); } }, {
    decorations: (value) => value.decorations,
    eventHandlers: {
      mousemove(event) { return this.move(event); }, mousedown(event) { return this.down(event); },
      contextmenu(event) { return this.contextmenu(event); }, mouseleave() { return this.leave(); }, blur() { return this.blur(); },
    },
  });
  return [plugin, keymap.of([
    { key: "F12", run: (view) => { void view.plugin(plugin)?.lookup(view.state.selection.main.head); return true; } },
    { key: "Shift-F12", run: (view) => { void view.plugin(plugin)?.lookup(view.state.selection.main.head, undefined, "references"); return true; } },
    { key: "Alt-F7", run: (view) => { void view.plugin(plugin)?.lookup(view.state.selection.main.head, undefined, "references"); return true; } },
  ]),
    EditorView.baseTheme({ ".cm-definition-link": { color: "var(--syntax-link, currentColor)", textDecoration: "underline", cursor: "pointer" } })];
}
