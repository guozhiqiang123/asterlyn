import { ChangeSet, RangeSetBuilder, StateEffect, StateField, Text, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { lineAwareDiff } from "./line-aware-diff.ts";

export interface DiffReviewCollapseRange {
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly lines: number;
}

interface ChangedLineRange { from: number; to: number }

const setExpandedRanges = StateEffect.define<ReadonlySet<number>>();

export class DiffReviewCollapseCoordinator<Side extends string> {
  private readonly ranges: Readonly<Record<Side, readonly DiffReviewCollapseRange[]>>;
  private readonly sides: readonly Side[];
  private readonly views = new Set<EditorView>();
  private readonly expanded = new Set<number>();

  constructor(
    anchor: string,
    targets: Readonly<Record<Side, string>>,
    margin = 3,
    minimumLines = 8,
  ) {
    this.sides = Object.keys(targets) as Side[];
    this.ranges = buildDiffReviewCollapseRanges(anchor, targets, margin, minimumLines);
  }

  extension(side: Side): Extension {
    const coordinator = this;
    const ranges = this.ranges[side];
    const field = StateField.define<DecorationSet>({
      create: () => collapseDecorations(ranges, coordinator.expanded, coordinator),
      update(decorations, transaction) {
        const effect = transaction.effects.find((candidate) => candidate.is(setExpandedRanges));
        return effect
          ? collapseDecorations(ranges, effect.value, coordinator)
          : decorations.map(transaction.changes);
      },
      provide: (value) => EditorView.decorations.from(value),
    });
    return field;
  }

  register(view: EditorView): void { this.views.add(view); }
  destroy(): void { this.views.clear(); this.expanded.clear(); }

  isExpanded(): boolean {
    return this.rangesForAnySide().every((range) => this.expanded.has(range.id));
  }

  expand(id: number): void {
    if (this.expanded.has(id)) return;
    this.expanded.add(id);
    this.broadcast();
  }

  setExpanded(expanded: boolean): void {
    this.expanded.clear();
    if (expanded) for (const range of this.rangesForAnySide()) this.expanded.add(range.id);
    this.broadcast();
  }

  private rangesForAnySide(): readonly DiffReviewCollapseRange[] {
    const side = this.sides[0];
    return side === undefined ? [] : this.ranges[side];
  }

  private broadcast(): void {
    const value = new Set(this.expanded);
    for (const view of this.views) view.dispatch({ effects: setExpandedRanges.of(value) });
  }
}

export function buildDiffReviewCollapseRanges<Side extends string>(
  anchor: string,
  targets: Readonly<Record<Side, string>>,
  margin = 3,
  minimumLines = 8,
): Readonly<Record<Side, readonly DiffReviewCollapseRange[]>> {
  const anchorDocument = text(anchor);
  const sides = Object.keys(targets) as Side[];
  const documents = Object.fromEntries(sides.map((side) => [side, text(targets[side])])) as Record<Side, Text>;
  const mappings = Object.fromEntries(sides.map((side) => [side, mapping(anchor, targets[side])])) as Record<Side, ReturnType<typeof mapping>>;
  const changed = mergedChangedLines(anchorDocument, sides.flatMap((side) =>
    lineAwareDiff(anchor, targets[side]).map((change) => ({ from: change.fromA, to: change.toA })),
  ));
  const result = {} as Record<Side, DiffReviewCollapseRange[]>;
  for (const side of sides) result[side] = [];
  let previousChangedLine = 0;
  let id = 0;

  for (let index = 0; index <= changed.length; index += 1) {
    const next = changed[index] ?? null;
    const collapseFrom = previousChangedLine === 0 ? 1 : previousChangedLine + margin + 1;
    const collapseTo = next ? next.from - margin - 1 : anchorDocument.lines;
    if (collapseTo - collapseFrom + 1 >= minimumLines) {
      const anchorFrom = anchorDocument.line(collapseFrom).from;
      const anchorTo = anchorDocument.line(collapseTo).to;
      for (const side of sides) {
        const document = documents[side];
        const projectedFrom = mappings[side].mapPos(anchorFrom, 1);
        const projectedTo = mappings[side].mapPos(anchorTo, -1);
        const fromLine = document.lineAt(Math.min(document.length, projectedFrom)).number;
        const toLine = document.lineAt(Math.min(document.length, projectedTo)).number;
        result[side].push({
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
  return result;
}

class DiffReviewCollapseWidget<Side extends string> extends WidgetType {
  readonly id: number;
  private readonly lines: number;
  private readonly coordinator: DiffReviewCollapseCoordinator<Side>;

  constructor(
    id: number,
    lines: number,
    coordinator: DiffReviewCollapseCoordinator<Side>,
  ) {
    super();
    this.id = id;
    this.lines = lines;
    this.coordinator = coordinator;
  }

  eq(other: DiffReviewCollapseWidget<Side>): boolean {
    return this.id === other.id && this.lines === other.lines;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-collapsedLines diff-review-collapsed-lines";
    element.textContent = view.state.phrase("$ unchanged lines", this.lines);
    element.addEventListener("click", () => this.coordinator.expand(this.id));
    return element;
  }

  ignoreEvent(event: Event): boolean { return event instanceof MouseEvent; }
  get estimatedHeight(): number { return 27; }
  get type(): string { return "diff-review-collapsed-unchanged-code"; }
}

function collapseDecorations<Side extends string>(
  ranges: readonly DiffReviewCollapseRange[],
  expanded: ReadonlySet<number>,
  coordinator: DiffReviewCollapseCoordinator<Side>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    if (expanded.has(range.id)) continue;
    builder.add(range.from, range.to, Decoration.replace({
      widget: new DiffReviewCollapseWidget(range.id, range.lines, coordinator),
      block: true,
    }));
  }
  return builder.finish();
}

function mergedChangedLines(
  anchor: Text,
  changes: readonly { readonly from: number; readonly to: number }[],
): ChangedLineRange[] {
  const ranges = changes.map((change) => {
    const from = anchor.lineAt(Math.min(anchor.length, change.from)).number;
    const endPosition = change.to > change.from ? change.to - 1 : change.from;
    const to = anchor.lineAt(Math.min(anchor.length, endPosition)).number;
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

function mapping(anchor: string, target: string) {
  const changes = lineAwareDiff(anchor, target);
  return ChangeSet.of(changes.map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: target.slice(change.fromB, change.toB),
  })), anchor.length).desc;
}

function text(content: string): Text { return Text.of(content.split("\n")); }
