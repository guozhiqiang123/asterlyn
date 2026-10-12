import type { Text } from "@codemirror/state";
import type { EditorView, TooltipView } from "@codemirror/view";
import { icon } from "../../icons.ts";
import type {
  EditorChangeIndicatorBlock,
  EditorChangeIndicatorCopy,
} from "../../editor-change-indicators.ts";

export interface EditorPatchLine {
  readonly lineNumber: number;
  readonly text: string;
}

export interface EditorPatchProjection {
  readonly before: readonly EditorPatchLine[];
  readonly after: readonly EditorPatchLine[];
}

export interface EditorPatchRollbackChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface EditorPatchPopoverOptions {
  readonly block: EditorChangeIndicatorBlock;
  readonly index: number;
  readonly total: number;
  readonly baseline: Text;
  readonly current: Text;
  readonly copy: EditorChangeIndicatorCopy;
  readonly readOnly: boolean;
  previous(): void;
  next(): void;
  rollback(): void;
  close(): void;
}

export function projectEditorPatch(
  baseline: Text,
  current: Text,
  block: EditorChangeIndicatorBlock,
): EditorPatchProjection {
  return {
    before: projectLines(
      baseline,
      block.baselineFrom,
      block.baselineTo,
      block.baselineLineFrom,
    ),
    after: projectLines(current, block.from, block.to, block.lineFrom),
  };
}

export function editorPatchRollbackChange(
  baseline: Text,
  current: Text,
  block: EditorChangeIndicatorBlock,
  lineBreak = "\n",
): EditorPatchRollbackChange {
  const baselineEnd = Math.min(
    baseline.length,
    Math.max(block.baselineFrom, block.baselineTo - 1),
  );
  let insert = baseline.sliceString(block.baselineFrom, baselineEnd);
  if (block.baselineFrom !== block.baselineTo && block.to <= current.length) {
    insert += lineBreak;
  }
  return {
    from: block.from,
    to: Math.min(current.length, block.to),
    insert,
  };
}

export function createEditorPatchPopover(
  view: EditorView,
  options: EditorPatchPopoverOptions,
): TooltipView {
  const projection = projectEditorPatch(options.baseline, options.current, options.block);
  const dom = document.createElement("section");
  dom.className = "cm-editor-patch-popover";
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", options.copy.patchPreview);

  const heading = document.createElement("header");
  heading.className = "cm-editor-patch-heading";
  const title = document.createElement("strong");
  title.textContent = options.copy.patchPreview;
  const position = document.createElement("span");
  position.textContent = `${options.index + 1} / ${options.total}`;
  const actions = document.createElement("div");
  actions.className = "cm-editor-patch-actions";
  actions.append(
    actionButton("up", options.copy.previousChange, options.index === 0, options.previous, "previous"),
    actionButton(
      "down",
      options.copy.nextChange,
      options.index >= options.total - 1,
      options.next,
      "next",
    ),
    actionButton(
      "revert",
      options.copy.revertDiffChange,
      options.readOnly,
      options.rollback,
      "rollback",
    ),
    actionButton("close", options.copy.close, false, options.close, "close"),
  );
  heading.append(title, position, actions);

  const comparison = document.createElement("div");
  comparison.className = "cm-editor-patch-comparison";
  const before = patchRows(options.copy.before, "before", projection.before);
  const after = patchRows(options.copy.after, "after", projection.after);
  if (before) comparison.append(before);
  if (after) comparison.append(after);
  dom.append(heading, comparison);
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    options.close();
    view.focus();
  };
  const closeOnOutsidePointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Node) || dom.contains(target)) return;
    if (target instanceof Element && target.closest(".cm-change-gutter-marker")) return;
    options.close();
  };
  return {
    dom,
    mount: () => {
      dom.ownerDocument.addEventListener("keydown", closeOnEscape);
      dom.ownerDocument.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    },
    destroy: () => {
      dom.ownerDocument.removeEventListener("keydown", closeOnEscape);
      dom.ownerDocument.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
    },
  };
}

function projectLines(
  document: Text,
  from: number,
  to: number,
  firstLine: number,
): readonly EditorPatchLine[] {
  if (from === to) return [];
  const end = Math.min(document.length, Math.max(from, to - 1));
  return document.sliceString(from, end).split("\n").map((text, index) => ({
    lineNumber: firstLine + index,
    text,
  }));
}

function patchRows(
  label: string,
  kind: "before" | "after",
  lines: readonly EditorPatchLine[],
): HTMLElement | null {
  if (lines.length === 0) return null;
  const section = document.createElement("section");
  section.className = `cm-editor-patch-side cm-editor-patch-${kind}`;
  section.setAttribute("aria-label", label);
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "cm-editor-patch-line";
    const oldNumber = document.createElement("span");
    oldNumber.className = "cm-editor-patch-line-number cm-editor-patch-old-line-number";
    oldNumber.textContent = kind === "before" ? String(line.lineNumber) : "";
    const newNumber = document.createElement("span");
    newNumber.className = "cm-editor-patch-line-number cm-editor-patch-new-line-number";
    newNumber.textContent = kind === "after" ? String(line.lineNumber) : "";
    const prefix = document.createElement("span");
    prefix.className = "cm-editor-patch-prefix";
    prefix.textContent = kind === "before" ? "−" : "+";
    prefix.setAttribute("aria-hidden", "true");
    const code = document.createElement("code");
    code.textContent = line.text || " ";
    row.append(oldNumber, newNumber, prefix, code);
    section.append(row);
  }
  return section;
}

function actionButton(
  iconName: "up" | "down" | "revert" | "close",
  label: string,
  disabled: boolean,
  activate: () => void,
  action?: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-editor-patch-action";
  button.disabled = disabled;
  button.title = label;
  button.setAttribute("aria-label", label);
  if (action) button.dataset.editorPatchAction = action;
  button.innerHTML = icon(iconName, 14);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    activate();
  });
  return button;
}
