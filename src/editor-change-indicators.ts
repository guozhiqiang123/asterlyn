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

export interface EditorChangeIndicatorOptions {
  readonly gutter?: boolean;
  readonly gutterSide?: "before" | "after";
  readonly overview?: boolean;
  /** Which side of the comparison is represented by the editor document. */
  readonly documentSide?: "a" | "b";
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
  options: EditorChangeIndicatorOptions = {},
): EditorChangeIndicators {
  const updateIndicator = StateEffect.define<IndicatorUpdate>();
  const baseline = text(initialBaseline);
  const documentSide = options.documentSide ?? "b";
  const field = StateField.define<IndicatorState>({
    create: (state) => ({
      baseline,
      chunks: documentSide === "a"
        ? Chunk.build(state.doc, baseline, DIFF_CONFIG)
        : Chunk.build(baseline, state.doc, DIFF_CONFIG),
      copy: initialCopy,
    }),
    update: (value, transaction) => {
      let next = transaction.docChanged
        ? {
            ...value,
            chunks: documentSide === "a"
              ? Chunk.updateA(value.chunks, transaction.newDoc, value.baseline, transaction.changes, DIFF_CONFIG)
              : Chunk.updateB(value.chunks, value.baseline, transaction.newDoc, transaction.changes, DIFF_CONFIG),
          }
        : value;
      for (const effect of transaction.effects) {
        if (!effect.is(updateIndicator)) continue;
        if (effect.value.kind === "baseline") {
          next = {
            ...next,
            baseline: effect.value.baseline,
            chunks: documentSide === "a"
              ? Chunk.build(transaction.newDoc, effect.value.baseline, DIFF_CONFIG)
              : Chunk.build(effect.value.baseline, transaction.newDoc, DIFF_CONFIG),
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
    options.gutter === false ? [] : gutter({
      class: "cm-change-indicator-gutter",
      side: options.gutterSide ?? "before",
      initialSpacer: () => new ChangeGutterSpacer(),
      lineMarker: (view, line) => {
        const block = blockAtLine(
          indicatorBlocks(view.state, field, documentSide),
          view.state.doc.lineAt(line.from).number,
        );
        return block ? new ChangeGutterMarker(block.kind, view.state.field(field).copy) : null;
      },
      lineMarkerChange: indicatorChanged(updateIndicator),
    }),
    options.overview === false ? [] : ViewPlugin.fromClass(class {
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
        const blocks = blocksFromChunks(state.chunks, this.view.state.doc, documentSide);
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
  documentSide: "a" | "b" = "b",
): readonly EditorChangeIndicatorBlock[] {
  const before = text(baseline);
  const after = text(current);
  return blocksFromChunks(
    Chunk.build(before, after, DIFF_CONFIG),
    documentSide === "a" ? before : after,
    documentSide,
  );
}

function indicatorChanged(effect: StateEffectType<IndicatorUpdate>) {
  return (update: ViewUpdate): boolean => update.docChanged ||
    update.transactions.some((transaction) =>
      transaction.effects.some((candidate) => candidate.is(effect)));
}

function indicatorBlocks(
  state: EditorState,
  field: StateField<IndicatorState>,
  documentSide: "a" | "b",
): readonly EditorChangeIndicatorBlock[] {
  return blocksFromChunks(state.field(field).chunks, state.doc, documentSide);
}

function blocksFromChunks(
  chunks: readonly Chunk[],
  current: Text,
  documentSide: "a" | "b" = "b",
): readonly EditorChangeIndicatorBlock[] {
  const blocks: EditorChangeIndicatorBlock[] = [];
  for (const chunk of chunks) {
    if (documentSide === "a" && chunk.fromA === chunk.toA) continue;
    const kind = chunk.fromB === chunk.toB
      ? "deleted"
      : chunk.fromA === chunk.toA
        ? "added"
        : "modified";
    const from = Math.min(documentSide === "a" ? chunk.fromA : chunk.fromB, current.length);
    const to = Math.min(documentSide === "a" ? chunk.endA : chunk.endB, current.length);
    const lineFrom = current.lineAt(from).number;
    const lineTo = current.lineAt(Math.max(from, to)).number;
    blocks.push({ kind, from, to, lineFrom, lineTo });
  }
  return blocks;
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
