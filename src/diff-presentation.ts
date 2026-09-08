export type DiffLayout = "unified" | "split";

export interface DiffPresentation {
  layout: DiffLayout;
  showWhitespace: boolean;
}

export interface SplitDiffDocument {
  oldDocument: string;
  newDocument: string;
}

export function splitUnifiedDiff(document: string): SplitDiffDocument {
  const lines = document.split("\n");
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let index = 0;
  let inHunk = false;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.startsWith("diff --git ")) inHunk = false;
    if (line.startsWith("@@")) inHunk = true;
    if (isRemoval(line, inHunk)) {
      const removed: string[] = [];
      const added: string[] = [];
      while (index < lines.length && isRemoval(lines[index] ?? "", inHunk)) {
        removed.push(lines[index] ?? "");
        index += 1;
      }
      const oldMarker = isNoNewlineMarker(lines[index] ?? "")
        ? (lines[index++] ?? "")
        : null;
      while (index < lines.length && isAddition(lines[index] ?? "", inHunk)) {
        added.push(lines[index] ?? "");
        index += 1;
      }
      const newMarker = isNoNewlineMarker(lines[index] ?? "")
        ? (lines[index++] ?? "")
        : null;
      appendAlignedChange(oldLines, newLines, removed, added);
      appendNoNewlineMarkers(oldLines, newLines, oldMarker, newMarker);
      continue;
    }
    if (isAddition(line, inHunk)) {
      const added: string[] = [];
      while (index < lines.length && isAddition(lines[index] ?? "", inHunk)) {
        added.push(lines[index] ?? "");
        index += 1;
      }
      const newMarker = isNoNewlineMarker(lines[index] ?? "")
        ? (lines[index++] ?? "")
        : null;
      appendAlignedChange(oldLines, newLines, [], added);
      appendNoNewlineMarkers(oldLines, newLines, null, newMarker);
      continue;
    }
    if (!inHunk && line.startsWith("--- ")) {
      oldLines.push(line);
      newLines.push("");
    } else if (!inHunk && line.startsWith("+++ ")) {
      oldLines.push("");
      newLines.push(line);
    } else {
      oldLines.push(line);
      newLines.push(line);
    }
    index += 1;
  }

  return {
    oldDocument: oldLines.join("\n"),
    newDocument: newLines.join("\n"),
  };
}

function appendNoNewlineMarkers(
  oldLines: string[],
  newLines: string[],
  oldMarker: string | null,
  newMarker: string | null,
): void {
  if (!oldMarker && !newMarker) return;
  oldLines.push(oldMarker ?? "");
  newLines.push(newMarker ?? "");
}

function appendAlignedChange(
  oldLines: string[],
  newLines: string[],
  removed: string[],
  added: string[],
): void {
  const count = Math.max(removed.length, added.length);
  for (let index = 0; index < count; index += 1) {
    oldLines.push(removed[index] ?? "");
    newLines.push(added[index] ?? "");
  }
}

function isRemoval(line: string, inHunk: boolean): boolean {
  return line.startsWith("-") && (inHunk || !line.startsWith("--- "));
}

function isAddition(line: string, inHunk: boolean): boolean {
  return line.startsWith("+") && (inHunk || !line.startsWith("+++ "));
}

function isNoNewlineMarker(line: string): boolean {
  return line === "\\ No newline at end of file";
}
