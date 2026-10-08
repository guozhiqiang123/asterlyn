import { ChangeSet, RangeSetBuilder, StateEffect, StateField, Text, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { lineAwareDiff } from "./features/files-editor/line-aware-diff.ts";

export type ConflictCollapseSide = "ours" | "result" | "theirs";

interface ConflictCollapseRange {
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly lines: number;
}

interface ChangedLineRange {
  from: number;
  to: number;
}

const expandConflictRange = StateEffect.define<number>();

/**
 * Projects one Base-owned set of unchanged ranges into Ours, Result, and Theirs. Both Result editor
 * instances therefore receive identical folds even though they live in separate MergeViews.
 */
export class ConflictCollapseCoordinator {
  private readonly ranges: Readonly<Record<ConflictCollapseSide, readonly ConflictCollapseRange[]>>;
  private readonly views = new Set<EditorView>();
  private readonly expanded = new Set<number>();

  constructor(base: string, ours: string, result: string, theirs: string) {
    this.ranges = buildConflictCollapseRanges(base, ours, result, theirs);
  }

  extension(side: ConflictCollapseSide): Extension {
    const coordinator = this;
    const ranges = this.ranges[side];
    const field = StateField.define<DecorationSet>({
      create() {
        return collapseDecorations(ranges, coordinator);
      },
      update(decorations, transaction) {
        let next = decorations.map(transaction.changes);
        const expandedIds = transaction.effects
          .filter((effect) => effect.is(expandConflictRange))
          .map((effect) => effect.value);
        if (expandedIds.length > 0) {
          const ids = new Set(expandedIds);
          next = next.update({
            filter: (_from, _to, decoration) => {
              const widget = decoration.spec.widget;
              return !(widget instanceof ConflictCollapseWidget && ids.has(widget.id));
            },
          });
        }
        return next;
      },
      provide: (value) => EditorView.decorations.from(value),
    });
    return field;
  }

  register(view: EditorView): void {
    this.views.add(view);
  }

  destroy(): void {
    this.views.clear();
    this.expanded.clear();
  }

  expand(id: number): void {
    if (this.expanded.has(id)) return;
    this.expanded.add(id);
    for (const view of this.views) view.dispatch({ effects: expandConflictRange.of(id) });
  }
}

export function buildConflictCollapseRanges(
  base: string,
  ours: string,
  result: string,
  theirs: string,
  margin = 3,
  minimumLines = 8,
): Readonly<Record<ConflictCollapseSide, readonly ConflictCollapseRange[]>> {
  const baseDocument = text(base);
  const documents = {
    ours: text(ours),
    result: text(result),
    theirs: text(theirs),
  } as const;
  const mappings = {
    ours: mapping(base, ours),
    result: mapping(base, result),
    theirs: mapping(base, theirs),
  } as const;
  const changed = mergedChangedLines(baseDocument, [ours, result, theirs].flatMap((document) =>
    lineAwareDiff(base, document).map((change) => ({ from: change.fromA, to: change.toA })),
  ));
  const resultRanges: Record<ConflictCollapseSide, ConflictCollapseRange[]> = {
    ours: [], result: [], theirs: [],
  };
  let previousChangedLine = 0;
  let id = 0;

  for (let index = 0; index <= changed.length; index += 1) {
    const next = changed[index] ?? null;
    const collapseFrom = previousChangedLine === 0 ? 1 : previousChangedLine + margin + 1;
    const collapseTo = next ? next.from - margin - 1 : baseDocument.lines;
    if (collapseTo - collapseFrom + 1 >= minimumLines) {
      const baseFrom = baseDocument.line(collapseFrom).from;
      const baseTo = baseDocument.line(collapseTo).to;
      for (const side of ["ours", "result", "theirs"] as const) {
        const document = documents[side];
        const projectedFrom = mappings[side].mapPos(baseFrom, 1);
        const projectedTo = mappings[side].mapPos(baseTo, -1);
        const fromLine = document.lineAt(Math.min(document.length, projectedFrom)).number;
        const toLine = document.lineAt(Math.min(document.length, projectedTo)).number;
        resultRanges[side].push({
          id,
          from: document.line(fromLine).from,
          to: document.line(toLine).to,
          lines: collapseTo - collapseFrom + 1,
        });
      }
      id += 1;
    }
    if (next) previousChangedLine = Math.max(previousChangedLine, next.to);
  }
  return resultRanges;
}

class ConflictCollapseWidget extends WidgetType {
  readonly id: number;
  private readonly lines: number;
  private readonly coordinator: ConflictCollapseCoordinator;

  constructor(
    id: number,
    lines: number,
    coordinator: ConflictCollapseCoordinator,
  ) {
    super();
    this.id = id;
    this.lines = lines;
    this.coordinator = coordinator;
  }

  eq(other: ConflictCollapseWidget): boolean {
    return this.id === other.id && this.lines === other.lines;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-collapsedLines conflict-collapsed-lines";
    element.textContent = view.state.phrase("$ unchanged lines", this.lines);
    element.addEventListener("click", () => this.coordinator.expand(this.id));
    return element;
  }

  ignoreEvent(event: Event): boolean {
    return event instanceof MouseEvent;
  }

  get estimatedHeight(): number {
    return 27;
  }

  get type(): string {
    return "conflict-collapsed-unchanged-code";
  }
}

function collapseDecorations(
  ranges: readonly ConflictCollapseRange[],
  coordinator: ConflictCollapseCoordinator,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    builder.add(range.from, range.to, Decoration.replace({
      widget: new ConflictCollapseWidget(range.id, range.lines, coordinator),
      block: true,
    }));
  }
  return builder.finish();
}

function mergedChangedLines(
  base: Text,
  changes: readonly { readonly from: number; readonly to: number }[],
): ChangedLineRange[] {
  const ranges = changes.map((change) => {
    const from = base.lineAt(Math.min(base.length, change.from)).number;
    const endPosition = change.to > change.from ? change.to - 1 : change.from;
    const to = base.lineAt(Math.min(base.length, endPosition)).number;
    return { from, to };
  }).sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: ChangedLineRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to + 1) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function mapping(base: string, target: string) {
  const changes = lineAwareDiff(base, target);
  return ChangeSet.of(changes.map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: target.slice(change.fromB, change.toB),
  })), base.length).desc;
}

function text(content: string): Text {
  return Text.of(content.split("\n"));
}
