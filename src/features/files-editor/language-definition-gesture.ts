import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { LanguageEditorContext } from "./language-service-editor.ts";
import { normalizeDefinitionTargets } from "../../application/language-services/definition-targets.ts";
import type { EditorLanguageServiceLocation } from "../../protocol/editor-language-service.ts";

export function definitionModifier(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): boolean {
  return !event.shiftKey && !event.altKey && (event.ctrlKey || (mac && event.metaKey));
}
const OWNER = "editor.text.definition";
class DefinitionGesture {
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
  private cancel(repaint = true): void { this.sequence++; this.gesture = null; this.choosing = false; this.context.definitionUi?.menu.close(OWNER); this.clear(repaint); }
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
    this.cancel(); this.suppressContextUntil = 0;
    if (event.button !== 0 || !definitionModifier(event, this.mac)) return false;
    const pos = this.candidate(event); if (pos === null) return false;
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
      if (event.key === "F12" && event.repeat) { event.preventDefault(); return; }
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
  async lookup(pos: number, anchor?: { x: number; y: number }): Promise<void> {
    this.cancel(); if (!this.context.active()) return;
    const token = ++this.sequence; this.context.flush(); const version = this.context.version();
    const line = this.view.state.doc.lineAt(pos), ui = this.context.definitionUi;
    this.context.port.definitionEvent?.({ outcome: "requested", targetCount: 0 });
    ui?.status(ui.copy().findingDefinition, "information");
    const response = await this.context.port.request(this.context.handle, "textDocument/definition", { position: { line: line.number - 1, character: pos - line.from } }, version).catch(() => null);
    if (!this.current(token, version)) { this.context.port.definitionEvent?.({ outcome: "discarded", targetCount: 0 }); return; }
    const result = normalizeDefinitionTargets(response);
    if (!result.locations.length) {
      this.context.port.definitionEvent?.({ outcome: result.invalid ? "invalid" : "empty", targetCount: 0 });
      ui?.status(result.invalid ? ui.copy().invalidDefinition : ui.copy().noDefinition, "warning"); return;
    }
    const navigate = (location: EditorLanguageServiceLocation) => {
      if (!this.current(token, version)) return;
      this.context.port.definitionEvent?.({ outcome: "selected", targetCount: result.locations.length });
      this.context.port.navigate?.(location);
    };
    if (result.locations.length === 1 && !result.limited) { navigate(result.locations[0]!); return; }
    this.context.port.definitionEvent?.({ outcome: "choices", targetCount: result.locations.length });
    if (!ui) return;
    this.choosing = true;
    ui.status(ui.copy().chooseDefinition, "information");
    const caret = this.view.coordsAtPos(pos);
    ui.menu.open(anchor ?? { x: caret?.left ?? 0, y: caret?.bottom ?? 0 }, {
      ownerId: OWNER, isCurrent: () => this.current(token, version),
      model: { ariaLabel: ui.copy().chooseDefinition, items: [
        { kind: "heading", label: result.limited ? ui.copy().definitionsLimited : ui.copy().chooseDefinition },
        ...result.locations.map((location, index) => {
          const path = decodeURIComponent(new URL(location.uri).pathname);
          return { kind: "command" as const, id: `definition-${index}`, actionId: `${index}`, label: `${path.split("/").at(-1)?.slice(0, 128)}:${location.range.start.line + 1}:${location.range.start.character + 1}`, secondaryText: path.slice(-260), availability: { kind: "enabled" as const } };
        }),
      ] },
      invoke: (id) => { const location = result.locations[Number(id)]; if (location) navigate(location); },
      blocked: (reason) => ui.status(reason, "warning"),
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
  return [plugin, keymap.of([{ key: "F12", run: (view) => { void view.plugin(plugin)?.lookup(view.state.selection.main.head); return true; } }]),
    EditorView.baseTheme({ ".cm-definition-link": { color: "var(--syntax-link, currentColor)", textDecoration: "underline", cursor: "pointer" } })];
}
