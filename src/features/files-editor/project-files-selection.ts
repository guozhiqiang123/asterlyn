import type { ProjectTreeNode, ProjectTreeSelection } from "../../presentation/project-tree.ts";
import { findProjectTreeNode } from "../../presentation/project-tree.ts";
import type { ProjectTreeRow } from "./project-files-view.ts";

export interface ProjectFilesSelectionState {
  readonly selection: ProjectTreeSelection | null;
  readonly selections: readonly ProjectTreeSelection[];
  readonly anchor: ProjectTreeSelection | null;
}

export function createProjectFilesSelectionState(
  initial?: ProjectTreeSelection | null,
): ProjectFilesSelectionState {
  return {
    selection: initial ?? null,
    selections: initial ? [initial] : [],
    anchor: initial ?? null,
  };
}

export function selectSingle(target: ProjectTreeSelection): ProjectFilesSelectionState {
  return {
    selection: target,
    selections: [target],
    anchor: target,
  };
}

export function toggleSelection(
  state: ProjectFilesSelectionState,
  target: ProjectTreeSelection,
): ProjectFilesSelectionState {
  const exists = state.selections.some((s) => s.path === target.path);
  if (exists) {
    const next = state.selections.filter((s) => s.path !== target.path);
    return {
      selection: next.at(-1) ?? null,
      selections: next,
      anchor: target,
    };
  }
  const next = [...state.selections, target];
  return {
    selection: target,
    selections: next,
    anchor: target,
  };
}

export function rangeSelection(
  state: ProjectFilesSelectionState,
  target: ProjectTreeSelection,
  rows: readonly ProjectTreeRow[],
): ProjectFilesSelectionState {
  const anchorPath = state.anchor?.path ?? state.selection?.path ?? target.path;
  const anchorIndex = rows.findIndex(
    (row) => row.node.path === anchorPath || row.directoryPaths.includes(anchorPath),
  );
  const targetIndex = rows.findIndex(
    (row) => row.node.path === target.path || row.directoryPaths.includes(target.path),
  );
  if (anchorIndex === -1 || targetIndex === -1) {
    return selectSingle(target);
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  const rangeRows = rows.slice(start, end + 1);
  const seen = new Set<string>();
  const selections: ProjectTreeSelection[] = [];
  for (const row of rangeRows) {
    if (!seen.has(row.node.path)) {
      seen.add(row.node.path);
      selections.push({ path: row.node.path, kind: row.node.kind });
    }
  }
  return {
    selection: target,
    selections,
    anchor: state.anchor ?? target,
  };
}

export function isProjectTreeRowSelected(
  selections: readonly ProjectTreeSelection[],
  fallbackSelection: ProjectTreeSelection | null,
  row: ProjectTreeRow,
): boolean {
  if (selections.length > 0) {
    return selections.some(
      (item) =>
        item.kind === row.node.kind &&
        (item.path === row.node.path || row.directoryPaths.includes(item.path)),
    );
  }
  if (!fallbackSelection) return false;
  return (
    fallbackSelection.kind === row.node.kind &&
    (fallbackSelection.path === row.node.path || row.directoryPaths.includes(fallbackSelection.path))
  );
}

export function reconcileSelections(
  selections: readonly ProjectTreeSelection[],
  tree: readonly ProjectTreeNode[],
): ProjectTreeSelection[] {
  return selections.filter((item) => {
    const node = findProjectTreeNode([...tree], item.path);
    return Boolean(node && node.kind === item.kind);
  });
}

export function projectTreeElementRepresentsPath(element: HTMLElement, path: string): boolean {
  if (element.dataset.projectNode === path) return true;
  const serialized = element.dataset.projectDirectoryPaths;
  if (!serialized) return false;
  try {
    const paths: unknown = JSON.parse(serialized);
    return Array.isArray(paths) && paths.includes(path);
  } catch {
    return false;
  }
}

export function isProjectTreeElementSelected(
  element: HTMLElement,
  selections: readonly ProjectTreeSelection[],
  fallbackPath?: string,
): boolean {
  if (selections.length > 0) {
    return selections.some((s) => projectTreeElementRepresentsPath(element, s.path));
  }
  return fallbackPath ? projectTreeElementRepresentsPath(element, fallbackPath) : false;
}

export function syncProjectTreeSelectionUi(
  root: HTMLElement,
  selections: readonly ProjectTreeSelection[],
  fallbackPath?: string,
  directorySelected = false,
): void {
  root.querySelectorAll<HTMLElement>("[data-project-node]").forEach((row) => {
    const selected = isProjectTreeElementSelected(row, selections, fallbackPath);
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
  });
  root.querySelectorAll<HTMLButtonElement>(
    "#expand-project-folder, #collapse-project-folder",
  ).forEach((button) => {
    button.disabled = !directorySelected;
  });
}

export type SelectionModifierMode = "single" | "toggle" | "range";

export function getSelectionModifierMode(event: MouseEvent): SelectionModifierMode {
  if (event.shiftKey) return "range";
  if (event.metaKey || event.ctrlKey) return "toggle";
  return "single";
}

export interface ProjectNodeClickBridge {
  onSelectSingle(path: string, kind: "file" | "directory"): void;
  onSelectMulti(path: string, kind: "file" | "directory", mode: "range" | "toggle"): void;
  onActivateFile(path: string): void;
  onToggleDirectory(path: string): void;
}

export function handleProjectNodeClick(
  event: MouseEvent,
  path: string,
  kind: "file" | "directory",
  bridge: ProjectNodeClickBridge,
): void {
  const mode = getSelectionModifierMode(event);
  if (mode === "single") {
    bridge.onSelectSingle(path, kind);
    if (kind === "file") bridge.onActivateFile(path);
    else bridge.onToggleDirectory(path);
  } else {
    bridge.onSelectMulti(path, kind, mode);
  }
}

export function bindProjectTreeRowEvents(
  root: HTMLElement,
  bridge: ProjectNodeClickBridge,
): void {
  root.querySelectorAll<HTMLElement>("[data-project-directory]").forEach((row) => {
    const path = row.dataset.projectDirectory;
    if (!path) return;
    row.addEventListener("click", (event) => handleProjectNodeClick(event, path, "directory", bridge));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      bridge.onSelectSingle(path, "directory");
      bridge.onToggleDirectory(path);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-project-file]").forEach((row) => {
    const path = row.dataset.projectFile;
    if (!path) return;
    row.addEventListener("click", (event) => handleProjectNodeClick(event, path, "file", bridge));
  });
}

