import { Chunk } from "@codemirror/merge";
import { EditorState, StateEffect, StateField, Text, type Extension, type StateEffectType } from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  gutter,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { EditorCopy } from "./localization/catalog.ts";

export type EditorChangeIndicatorKind = "added" | "modified" | "deleted";

export interface EditorChangeIndicatorCopy {
  overview: string;
  added: string;
  modified: string;
  deleted: string;
  navigate(kind: EditorChangeIndicatorKind, line: number): string;
}

export interface EditorChangeIndicatorBlock {
  readonly kind: EditorChangeIndicatorKind;
  readonly from: number;
  readonly to: number;
  readonly lineFrom: number;
  readonly lineTo: number;
}

export interface EditorChangeIndicators {
  readonly extension: Extension;
  setBaseline(view: EditorView, content: string): void;
  setCopy(view: EditorView, copy: EditorChangeIndicatorCopy): void;
}

export function editorChangeIndicatorCopy(copy: EditorCopy): EditorChangeIndicatorCopy {
  return {
    overview: copy.diffNavigation,
    added: copy.changeIndicatorAdded,
    modified: copy.changeIndicatorModified,
    deleted: copy.changeIndicatorDeleted,
    navigate: copy.navigateChangeIndicator,
  };
}

type IndicatorState = {
  readonly baseline: Text;
  readonly chunks: readonly Chunk[];
  readonly copy: EditorChangeIndicatorCopy;
};

type IndicatorUpdate =
  | { readonly kind: "baseline"; readonly baseline: Text }
  | { readonly kind: "copy"; readonly copy: EditorChangeIndicatorCopy };

const DIFF_CONFIG = { scanLimit: 1_000, timeout: 250 } as const;

export function createEditorChangeIndicators(
  initialBaseline: string,
  initialCopy: EditorChangeIndicatorCopy,
): EditorChangeIndicators {
  const updateIndicator = StateEffect.define<IndicatorUpdate>();
  const baseline = text(initialBaseline);
  const field = StateField.define<IndicatorState>({
    create: (state) => ({
      baseline,
      chunks: Chunk.build(baseline, state.doc, DIFF_CONFIG),
      copy: initialCopy,
    }),
    update: (value, transaction) => {
      let next = transaction.docChanged
        ? { ...value, chunks: Chunk.updateB(value.chunks, value.baseline, transaction.newDoc, transaction.changes, DIFF_CONFIG) }
        : value;
      for (const effect of transaction.effects) {
        if (!effect.is(updateIndicator)) continue;
        if (effect.value.kind === "baseline") {
          next = {
            ...next,
            baseline: effect.value.baseline,
            chunks: Chunk.build(effect.value.baseline, transaction.newDoc, DIFF_CONFIG),
          };
        } else {
          next = { ...next, copy: effect.value.copy };
        }
      }
      return next;
    },
  });
  const extension = [
    field,
    gutter({
      class: "cm-change-indicator-gutter",
      initialSpacer: () => new ChangeGutterSpacer(),
      lineMarker: (view, line) => {
        const block = blockAtLine(indicatorBlocks(view.state, field), view.state.doc.lineAt(line.from).number);
        return block ? new ChangeGutterMarker(block.kind, view.state.field(field).copy) : null;
      },
      lineMarkerChange: indicatorChanged(updateIndicator),
    }),
    ViewPlugin.fromClass(class {
      private readonly ruler: HTMLDivElement;
      private readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        this.ruler = document.createElement("div");
        this.ruler.className = "cm-change-overview-ruler";
        view.dom.append(this.ruler);
        this.render();
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(updateIndicator)))) this.render();
      }

      destroy(): void {
        this.ruler.remove();
      }

      private render(): void {
        const state = this.view.state.field(field);
        this.ruler.setAttribute("aria-label", state.copy.overview);
        const blocks = blocksFromChunks(state.chunks, this.view.state.doc);
        const lineRange = Math.max(1, this.view.state.doc.lines - 1);
        this.ruler.replaceChildren(...blocks.map((block) => {
          const marker = document.createElement("button");
          marker.type = "button";
          marker.className = `cm-change-overview-marker cm-change-${block.kind}`;
          marker.style.top = `${((block.lineFrom - 1) / lineRange) * 100}%`;
          marker.title = state.copy.navigate(block.kind, block.lineFrom);
          marker.setAttribute("aria-label", marker.title);
          marker.addEventListener("click", () => {
            this.view.dispatch({
              selection: { anchor: block.from },
              effects: EditorView.scrollIntoView(block.from, { y: "center" }),
            });
            this.view.focus();
          });
          return marker;
        }));
      }
    }),
  ];
  return {
    extension,
    setBaseline(view, content) {
      const next = text(content);
      if (next.eq(view.state.field(field).baseline)) return;
      view.dispatch({ effects: updateIndicator.of({ kind: "baseline", baseline: next }) });
    },
    setCopy(view, copy) {
      if (copy === view.state.field(field).copy) return;
      view.dispatch({ effects: updateIndicator.of({ kind: "copy", copy }) });
    },
  };
}

export function editorChangeIndicatorBlocks(
  baseline: string,
  current: string,
): readonly EditorChangeIndicatorBlock[] {
  const currentText = text(current);
  return blocksFromChunks(Chunk.build(text(baseline), currentText, DIFF_CONFIG), currentText);
}

function indicatorChanged(effect: StateEffectType<IndicatorUpdate>) {
  return (update: ViewUpdate): boolean => update.docChanged ||
    update.transactions.some((transaction) =>
      transaction.effects.some((candidate) => candidate.is(effect)));
}

function indicatorBlocks(
  state: EditorState,
  field: StateField<IndicatorState>,
): readonly EditorChangeIndicatorBlock[] {
  return blocksFromChunks(state.field(field).chunks, state.doc);
}

function blocksFromChunks(chunks: readonly Chunk[], current: Text): readonly EditorChangeIndicatorBlock[] {
  return chunks.map((chunk) => {
    const kind = chunk.fromB === chunk.toB
      ? "deleted"
      : chunk.fromA === chunk.toA
        ? "added"
        : "modified";
    const from = Math.min(chunk.fromB, current.length);
    const to = Math.min(chunk.endB, current.length);
    const lineFrom = current.lineAt(from).number;
    const lineTo = current.lineAt(Math.max(from, to)).number;
    return { kind, from, to, lineFrom, lineTo };
  });
}

function blockAtLine(
  blocks: readonly EditorChangeIndicatorBlock[],
  line: number,
): EditorChangeIndicatorBlock | null {
  return blocks.find((block) => line >= block.lineFrom && line <= block.lineTo) ?? null;
}

function text(content: string): Text {
  return Text.of(content.replace(/\r\n?/g, "\n").split("\n"));
}

class ChangeGutterSpacer extends GutterMarker {
  toDOM(): Node {
    const marker = document.createElement("span");
    marker.className = "cm-change-gutter-spacer";
    return marker;
  }
}

class ChangeGutterMarker extends GutterMarker {
  readonly elementClass: string;
  private readonly kind: EditorChangeIndicatorKind;
  private readonly copy: EditorChangeIndicatorCopy;

  constructor(
    kind: EditorChangeIndicatorKind,
    copy: EditorChangeIndicatorCopy,
  ) {
    super();
    this.kind = kind;
    this.copy = copy;
    this.elementClass = `cm-change-gutter-element cm-change-${kind}`;
  }

  eq(other: ChangeGutterMarker): boolean {
    return other.kind === this.kind && other.copy === this.copy;
  }

  toDOM(): Node {
    const marker = document.createElement("span");
    marker.className = "cm-change-gutter-marker";
    marker.title = this.copy[this.kind];
    marker.textContent = this.kind === "deleted" ? "−" : "";
    return marker;
  }
}
