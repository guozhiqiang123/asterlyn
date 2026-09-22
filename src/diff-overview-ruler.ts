import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { SourceDiffRow, UnifiedDiffRow } from "./diff-presentation";
import {
  splitChangeBlocks,
  unifiedDiffChangeBlocks,
} from "./features/files-editor/diff-navigation";

export interface DiffOverviewBlock {
  kind: "added" | "modified" | "deleted";
  fromLine: number;
  toLine: number;
  pos: number;
}

export function splitOverviewBlocks(
  rows: readonly SourceDiffRow[],
  view: EditorView,
): DiffOverviewBlock[] {
  const blocks: DiffOverviewBlock[] = [];
  const rawBlocks = splitChangeBlocks(rows);
  for (const block of rawBlocks) {
    let hasAdded = false;
    let hasRemoved = false;
    let hasModified = false;
    for (let i = block.fromLine - 1; i < block.toLine; i += 1) {
      const row = rows[i];
      if (!row) continue;
      if (row.kind === "added") hasAdded = true;
      else if (row.kind === "removed") hasRemoved = true;
      else if (row.kind === "modified") hasModified = true;
    }
    const kind: "added" | "modified" | "deleted" = hasModified || (hasAdded && hasRemoved)
      ? "modified"
      : hasAdded
        ? "added"
        : "deleted";
    const line = view.state.doc.line(Math.min(block.fromLine, view.state.doc.lines));
    blocks.push({
      kind,
      fromLine: block.fromLine,
      toLine: block.toLine,
      pos: line.from,
    });
  }
  return blocks;
}

export function unifiedOverviewBlocks(
  rows: readonly UnifiedDiffRow[],
  view: EditorView,
): DiffOverviewBlock[] {
  const blocks: DiffOverviewBlock[] = [];
  const rawBlocks = unifiedDiffChangeBlocks(rows);
  for (const block of rawBlocks) {
    let hasAdded = false;
    let hasRemoved = false;
    for (let i = block.fromLine - 1; i < block.toLine; i += 1) {
      const row = rows[i];
      if (!row) continue;
      if (row.kind === "added") hasAdded = true;
      else if (row.kind === "removed") hasRemoved = true;
    }
    const kind: "added" | "modified" | "deleted" = hasAdded && hasRemoved
      ? "modified"
      : hasAdded
        ? "added"
        : "deleted";
    const line = view.state.doc.line(Math.min(block.fromLine, view.state.doc.lines));
    blocks.push({
      kind,
      fromLine: block.fromLine,
      toLine: block.toLine,
      pos: line.from,
    });
  }
  return blocks;
}

export function renderOverviewRuler(
  parent: HTMLElement,
  totalLines: number,
  blocks: readonly DiffOverviewBlock[],
  onSelect: (block: DiffOverviewBlock) => void,
): HTMLDivElement {
  const ruler = document.createElement("div");
  ruler.className = "cm-change-overview-ruler";
  ruler.setAttribute("aria-label", "Change overview");
  const docLines = Math.max(1, totalLines);

  for (const block of blocks) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `cm-change-overview-marker cm-change-${block.kind}`;
    const lineCount = Math.max(1, block.toLine - block.fromLine + 1);
    const topPercent = ((block.fromLine - 1) / docLines) * 100;
    const heightPercent = (lineCount / docLines) * 100;
    marker.style.top = `${topPercent}%`;
    marker.style.height = `max(5px, ${heightPercent}%)`;
    marker.title = `Go to change at line ${block.fromLine}`;
    marker.setAttribute("aria-label", marker.title);
    marker.addEventListener("click", () => {
      onSelect(block);
    });
    ruler.appendChild(marker);
  }

  parent.appendChild(ruler);
  return ruler;
}

export function unifiedLineDecorations(rows: readonly UnifiedDiffRow[]): Extension {
  return EditorView.decorations.compute(["doc"], (state) => {
    const decorations: Array<Range<Decoration>> = [];
    for (const [index, row] of rows.entries()) {
      if (index >= state.doc.lines) break;
      const line = state.doc.line(index + 1);
      let className = "";
      if (row.kind === "added") {
        className = "cm-source-added";
      } else if (row.kind === "removed") {
        className = "cm-source-removed";
      } else if (row.kind === "omitted") {
        className = "cm-source-omitted";
      } else if (row.kind === "notice") {
        className = "cm-source-notice";
      }
      if (className) {
        decorations.push(Decoration.line({ class: className }).range(line.from));
      }
      if (row.changed && row.changed.length > 0) {
        const markClass =
          row.kind === "removed" ? "cm-source-word-removed" : "cm-source-word-added";
        for (const range of row.changed) {
          if (range.to <= range.from || range.from >= line.length) continue;
          decorations.push(
            Decoration.mark({ class: markClass }).range(
              line.from + range.from,
              line.from + Math.min(line.length, range.to),
            ),
          );
        }
      }
    }
    return Decoration.set(decorations, true);
  });
}

class UnifiedGutterMarker extends GutterMarker {
  readonly elementClass: string;

  constructor(private readonly kind: "added" | "deleted" | null) {
    super();
    this.elementClass = kind
      ? `cm-change-gutter-element cm-change-${kind}`
      : "cm-change-gutter-element";
  }

  eq(other: UnifiedGutterMarker): boolean {
    return other.kind === this.kind;
  }

  toDOM(): Node {
    const marker = document.createElement("span");
    marker.className = "cm-change-gutter-marker";
    marker.textContent = this.kind === "deleted" ? "−" : "";
    return marker;
  }
}

export function unifiedChangeGutter(rows: readonly UnifiedDiffRow[]): Extension {
  return gutter({
    class: "cm-change-indicator-gutter cm-source-change-indicator-gutter",
    side: "before",
    initialSpacer: () => new UnifiedGutterMarker(null),
    lineMarker: (view, line) => {
      const row = rows[view.state.doc.lineAt(line.from).number - 1];
      if (!row) return null;
      const kind = row.kind === "added" ? "added" : row.kind === "removed" ? "deleted" : null;
      return kind ? new UnifiedGutterMarker(kind) : null;
    },
  });
}
