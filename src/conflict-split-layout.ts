import type { MergeView } from "@codemirror/merge";
import type { DiffPresentation } from "./diff-presentation.ts";
import { attachSplitter } from "./presentation/splitter.ts";
import {
  CONFLICT_EQUAL_PERCENTAGE,
  CONFLICT_PANE_MIN_PERCENTAGE,
  conflictPaneLayout,
  normalizeConflictPercentages,
  resizeConflictOursPercentage,
} from "./shared/diff-review/conflict-diff-review-layout.ts";

export class ConflictSplitLayout {
  private presentation: DiffPresentation;
  private ours: number;
  private result: number;
  private readonly disposers: Array<() => void> = [];
  private readonly root: HTMLElement;
  private readonly leftMerge: MergeView;
  private readonly rightMerge: MergeView;
  private readonly changed: () => void;

  constructor(
    root: HTMLElement,
    leftMerge: MergeView,
    rightMerge: MergeView,
    presentation: DiffPresentation,
    changed: () => void,
  ) {
    this.root = root;
    this.leftMerge = leftMerge;
    this.rightMerge = rightMerge;
    this.changed = changed;
    this.presentation = { ...presentation };
    const percentages = normalizeConflictPercentages(
      presentation.conflictOursPercentage ?? CONFLICT_EQUAL_PERCENTAGE,
      presentation.conflictResultPercentage ?? CONFLICT_EQUAL_PERCENTAGE,
    );
    this.ours = percentages.ours;
    this.result = percentages.result;
    this.mount();
  }

  setPresentation(presentation: DiffPresentation): void {
    this.presentation = { ...presentation };
    const percentages = normalizeConflictPercentages(
      presentation.conflictOursPercentage ?? this.ours,
      presentation.conflictResultPercentage ?? this.result,
    );
    this.ours = percentages.ours;
    this.result = percentages.result;
    this.apply();
  }

  apply(): void {
    const { oursWidth, resultWidth, theirsWidth } = conflictPaneLayout(
      this.root.clientWidth,
      this.ours,
      this.result,
    );
    this.root.style.setProperty("--conflict-ours-width", `${oursWidth}px`);
    this.root.style.setProperty("--conflict-result-width", `${resultWidth}px`);
    this.root.style.setProperty("--conflict-theirs-width", `${theirsWidth}px`);
    const leftEditors = this.leftMerge.dom.querySelectorAll<HTMLElement>(".cm-mergeViewEditor");
    if (leftEditors[0]) leftEditors[0].style.flex = `0 0 ${oursWidth}px`;
    if (leftEditors[1]) leftEditors[1].style.flex = `0 0 ${resultWidth}px`;
    const theirsEditor = this.rightMerge.a.dom.closest<HTMLElement>(".cm-mergeViewEditor");
    if (theirsEditor) theirsEditor.style.flex = `0 0 ${theirsWidth}px`;
    this.changed();
  }

  destroy(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private mount(): void {
    const first = document.createElement("div");
    first.className = "workbench-splitter vertical conflict-splitter conflict-splitter-ours";
    first.setAttribute("aria-label", "Resize Ours and Result");
    const second = document.createElement("div");
    second.className = "workbench-splitter vertical conflict-splitter conflict-splitter-theirs";
    second.setAttribute("aria-label", "Resize Result and Theirs");
    this.root.append(first, second);
    const contentWidth = () => conflictPaneLayout(this.root.clientWidth, this.ours, this.result).contentWidth;
    const apply = () => {
      this.presentation = {
        ...this.presentation,
        conflictOursPercentage: this.ours,
        conflictResultPercentage: this.result,
      };
      this.apply();
    };
    const reset = () => {
      this.ours = CONFLICT_EQUAL_PERCENTAGE;
      this.result = CONFLICT_EQUAL_PERCENTAGE;
      apply();
    };
    this.disposers.push(
      attachSplitter(first, {
        orientation: "vertical",
        getValue: () => contentWidth() * this.ours / 100,
        getRange: () => {
          const minimum = CONFLICT_PANE_MIN_PERCENTAGE / 100;
          return {
            minimum: contentWidth() * minimum,
            maximum: contentWidth() * ((this.ours + this.result) / 100 - minimum),
          };
        },
        onChange: (value) => {
          ({ ours: this.ours, result: this.result } = resizeConflictOursPercentage(
            this.ours,
            this.result,
            value / contentWidth() * 100,
          ));
          apply();
          this.presentation.onConflictSplitPercentageChange?.(this.ours, this.result, false);
        },
        onCommit: () => this.presentation.onConflictSplitPercentageChange?.(this.ours, this.result, true),
        onReset: reset,
      }),
      attachSplitter(second, {
        orientation: "vertical",
        getValue: () => contentWidth() * (this.ours + this.result) / 100,
        getRange: () => ({
          minimum: contentWidth() * (this.ours + CONFLICT_PANE_MIN_PERCENTAGE) / 100,
          maximum: contentWidth() * (100 - CONFLICT_PANE_MIN_PERCENTAGE) / 100,
        }),
        onChange: (value) => {
          this.result = value / contentWidth() * 100 - this.ours;
          ({ ours: this.ours, result: this.result } = normalizeConflictPercentages(this.ours, this.result));
          apply();
          this.presentation.onConflictSplitPercentageChange?.(this.ours, this.result, false);
        },
        onCommit: () => this.presentation.onConflictSplitPercentageChange?.(this.ours, this.result, true),
        onReset: reset,
      }),
    );
    apply();
  }
}
