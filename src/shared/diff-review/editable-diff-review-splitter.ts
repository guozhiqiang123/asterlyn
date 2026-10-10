import { attachSplitter } from "../../presentation/splitter.ts";

interface EditableDiffReviewSplitterOptions {
  readonly initialPercentage: number;
  readonly label: string;
  readonly onChange: (percentage: number, committed: boolean) => void;
  readonly onMeasure: () => void;
}

export function attachEditableDiffReviewSplitter(
  parent: HTMLElement,
  merge: HTMLElement,
  options: EditableDiffReviewSplitterOptions,
): () => void {
  let percentage = clampEditableDiffPercentage(options.initialPercentage);
  const apply = () => {
    parent.style.setProperty("--diff-before-width", `${percentage}%`);
    merge.style.setProperty("--diff-before-width", `${percentage}%`);
    options.onMeasure();
  };
  apply();
  const splitter = document.createElement("div");
  splitter.className = "workbench-splitter vertical editable-diff-splitter";
  splitter.setAttribute("aria-label", options.label);
  // MergeView scrolls its entire document. Anchor to that document's height so the
  // splitter still covers the viewport after scrolling beyond the initial screen.
  const editors = merge.querySelector<HTMLElement>(".cm-mergeViewEditors") ?? merge;
  editors.append(splitter);
  const releaseSplitter = attachSplitter(splitter, {
    orientation: "vertical",
    getValue: () => Math.max(1, merge.clientWidth) * percentage / 100,
    getRange: () => {
      const width = Math.max(1, merge.clientWidth);
      return { minimum: width * 0.25, maximum: width * 0.75 };
    },
    onChange: (value) => {
      percentage = clampEditableDiffPercentage(value / Math.max(1, merge.clientWidth) * 100);
      apply();
      options.onChange(percentage, false);
    },
    onCommit: () => options.onChange(percentage, true),
    onReset: () => {
      percentage = 42;
      apply();
      options.onChange(percentage, false);
    },
  });
  return () => {
    releaseSplitter();
    splitter.remove();
  };
}

function clampEditableDiffPercentage(value: number): number {
  return Math.max(25, Math.min(75, Number.isFinite(value) ? value : 42));
}
