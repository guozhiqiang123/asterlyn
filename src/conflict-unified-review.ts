import { StateEffect, StateField, Text, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type {
  ConflictResolutionBlockSnapshot,
  ConflictResolutionDecision,
  ConflictResolutionSide,
  ConflictSourceRange,
} from "./conflict-resolution-model.ts";
import type { GitOperationCopy } from "./localization/catalog.ts";
import { icon } from "./icons.ts";
import type { DiffReviewBlockStatus, DiffReviewSnapshot } from "./shared/diff-review/diff-review-model.ts";
import { createDiffReviewActionGroup } from "./shared/diff-review/diff-review-action-gutter.ts";

export interface UnifiedConflictSource {
  readonly side: ConflictResolutionSide;
  readonly text: string;
  readonly range: ConflictSourceRange;
  readonly firstLine: number;
  readonly lastLine: number;
  readonly changed: boolean;
  readonly decision: ConflictResolutionDecision;
}

export interface UnifiedConflictCard {
  readonly id: number;
  readonly result: ConflictSourceRange;
  readonly status: DiffReviewBlockStatus;
  readonly active: boolean;
  readonly ours: UnifiedConflictSource;
  readonly theirs: UnifiedConflictSource;
}

export interface UnifiedConflictReview {
  readonly cards: readonly UnifiedConflictCard[];
  readonly copy: GitOperationCopy;
  readonly readOnly: boolean;
  readonly decide: (
    side: ConflictResolutionSide,
    decision: Exclude<ConflictResolutionDecision, "pending">,
    source: ConflictSourceRange,
  ) => void;
}

export function projectUnifiedConflictCards(
  blocks: readonly ConflictResolutionBlockSnapshot[],
  review: DiffReviewSnapshot,
  ours: string,
  theirs: string,
): readonly UnifiedConflictCard[] {
  const reviewBlocks = new Map(review.blocks.map((block) => [block.id, block]));
  const oursDocument = Text.of(ours.split("\n"));
  const theirsDocument = Text.of(theirs.split("\n"));
  return blocks.map((block) => ({
    id: block.id,
    result: block.result,
    status: reviewBlocks.get(`conflict:${block.id}`)?.status ?? "pending",
    active: review.activeBlockId === `conflict:${block.id}`,
    ours: sourceProjection("ours", ours, oursDocument, block.ours, block.oursChanged, block.oursDecision),
    theirs: sourceProjection("theirs", theirs, theirsDocument, block.theirs, block.theirsChanged, block.theirsDecision),
  }));
}

export const setUnifiedConflictReview = StateEffect.define<UnifiedConflictReview | null>();

export const unifiedConflictReviewExtension: Extension = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    const effect = transaction.effects.find((candidate) => candidate.is(setUnifiedConflictReview));
    if (!effect) return decorations.map(transaction.changes);
    if (!effect.value) return Decoration.none;
    const widgets: Range<Decoration>[] = [];
    for (const card of effect.value.cards) {
      const from = lineStart(transaction.newDoc, card.result.from);
      const to = lineEnd(transaction.newDoc, card.result.from, card.result.to);
      widgets.push(Decoration.widget({
        widget: new UnifiedConflictSourceWidget(card, card.ours, effect.value),
        block: true,
        side: -1,
      }).range(from));
      widgets.push(Decoration.widget({
        widget: new UnifiedConflictSourceWidget(card, card.theirs, effect.value),
        block: true,
        side: 1,
      }).range(to));
    }
    return Decoration.set(widgets, true);
  },
  provide: (field) => EditorView.decorations.from(field),
});

class UnifiedConflictSourceWidget extends WidgetType {
  private readonly card: UnifiedConflictCard;
  private readonly source: UnifiedConflictSource;
  private readonly review: UnifiedConflictReview;

  constructor(
    card: UnifiedConflictCard,
    source: UnifiedConflictSource,
    review: UnifiedConflictReview,
  ) {
    super();
    this.card = card;
    this.source = source;
    this.review = review;
  }

  eq(other: UnifiedConflictSourceWidget): boolean {
    return this.card.id === other.card.id &&
      this.card.status === other.card.status &&
      this.card.active === other.card.active &&
      this.source.text === other.source.text &&
      this.source.firstLine === other.source.firstLine &&
      this.source.lastLine === other.source.lastLine &&
      this.source.changed === other.source.changed &&
      this.source.decision === other.source.decision &&
      this.review.copy === other.review.copy &&
      this.review.readOnly === other.review.readOnly &&
      this.review.decide === other.review.decide;
  }

  toDOM(): HTMLElement {
    const { source, review } = this;
    const element = document.createElement("section");
    element.className = [
      "conflict-unified-source",
      `conflict-unified-source-${source.side}`,
      `is-${this.card.status}`,
      this.card.active ? "is-active" : "",
      source.decision !== "pending" ? `is-${source.decision}` : "",
    ].filter(Boolean).join(" ");
    element.dataset.conflictBlock = String(this.card.id);
    element.dataset.side = source.side;

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = source.side === "ours" ? review.copy.ours : review.copy.theirs;
    const range = document.createElement("small");
    range.textContent = source.firstLine === source.lastLine
      ? `L${source.firstLine}`
      : `L${source.firstLine}–${source.lastLine}`;
    title.append(range);
    header.append(title);
    const actions = this.actions();
    if (actions) header.append(actions);
    else if (source.changed && source.decision !== "pending") header.append(this.decisionIndicator());
    element.append(header);

    const code = document.createElement("pre");
    code.textContent = source.text || review.copy.notPresent;
    code.classList.toggle("is-empty", source.text.length === 0);
    element.append(code);
    return element;
  }

  ignoreEvent(): boolean { return true; }
  get estimatedHeight(): number { return 72; }
  get type(): string { return `unified-conflict-${this.source.side}`; }

  private actions(): HTMLDivElement | null {
    const { source, review } = this;
    if (!source.changed || source.decision !== "pending") return null;
    const ours = source.side === "ours";
    const group = createDiffReviewActionGroup(source.side, ours ? review.copy.ours : review.copy.theirs, [
      {
        id: ours ? "apply-ours" : "apply-theirs",
        label: ours ? review.copy.acceptOursChange : review.copy.acceptTheirsChange,
        icon: ours ? "down" : "up",
        className: "conflict-apply-change",
        disabled: review.readOnly,
      },
      {
        id: ours ? "ignore-ours" : "ignore-theirs",
        label: ours ? review.copy.ignoreOursChange : review.copy.ignoreTheirsChange,
        icon: "close",
        className: "conflict-ignore-change",
        disabled: review.readOnly,
      },
    ]);
    group.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const [apply, ignore] = group.querySelectorAll<HTMLButtonElement>("button");
    apply?.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      review.decide(source.side, "accepted", source.range);
    });
    ignore?.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      review.decide(source.side, "ignored", source.range);
    });
    return group;
  }

  private decisionIndicator(): HTMLElement {
    const accepted = this.source.decision === "accepted";
    const indicator = document.createElement("span");
    const label = accepted
      ? this.source.side === "ours" ? this.review.copy.acceptOursChange : this.review.copy.acceptTheirsChange
      : this.source.side === "ours" ? this.review.copy.ignoreOursChange : this.review.copy.ignoreTheirsChange;
    indicator.className = `conflict-unified-decision is-${this.source.decision}`;
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-label", label);
    indicator.title = label;
    indicator.innerHTML = icon(accepted ? "check" : "close", 15);
    return indicator;
  }
}

function sourceProjection(
  side: ConflictResolutionSide,
  content: string,
  document: Text,
  range: ConflictSourceRange,
  changed: boolean,
  decision: ConflictResolutionDecision,
): UnifiedConflictSource {
  const from = Math.min(document.length, Math.max(0, range.from));
  const to = Math.min(document.length, Math.max(from, range.to));
  const lastPosition = to > from ? to - 1 : from;
  const firstLine = document.lineAt(from);
  const lastLine = document.lineAt(lastPosition);
  const displayTo = to > from && lastLine.to < document.length ? lastLine.to + 1 : lastLine.to;
  return {
    side,
    text: to > from ? content.slice(firstLine.from, displayTo) : "",
    range: { from, to },
    firstLine: firstLine.number,
    lastLine: lastLine.number,
    changed,
    decision,
  };
}

function lineStart(document: Text, position: number): number {
  return document.lineAt(Math.min(document.length, Math.max(0, position))).from;
}

function lineEnd(document: Text, from: number, to: number): number {
  const position = to > from ? to - 1 : from;
  return document.lineAt(Math.min(document.length, Math.max(0, position))).to;
}
