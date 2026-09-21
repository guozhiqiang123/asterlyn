import type {
  ContextMenuActionItem,
  ContextMenuSubmenuItem,
} from "./context-menu-model.ts";

const ENABLED = { kind: "enabled" } as const;

export interface TextCopyAction {
  readonly id: string;
  readonly actionId: string;
  readonly label: string;
  readonly text: string;
}

export interface WorkspacePathCopyTarget {
  readonly workspaceRoot: string;
  readonly workspacePath: string;
}

export interface PathCopyLabels {
  readonly copy: string;
  readonly fileName: string;
  readonly relativePath: string;
  readonly absolutePath: string;
}

export function workspacePathCopyActions(
  actionNamespace: string,
  target: WorkspacePathCopyTarget,
  labels: PathCopyLabels,
): readonly TextCopyAction[] {
  const relativePath = normalizeRelativeDisplayPath(target.workspacePath);
  return [
    {
      id: `${actionNamespace}.copy-name`,
      actionId: `${actionNamespace}.copy-name`,
      label: labels.fileName,
      text: pathName(relativePath),
    },
    {
      id: `${actionNamespace}.copy-relative-path`,
      actionId: `${actionNamespace}.copy-relative-path`,
      label: labels.relativePath,
      text: relativePath,
    },
    {
      id: `${actionNamespace}.copy-absolute-path`,
      actionId: `${actionNamespace}.copy-absolute-path`,
      label: labels.absolutePath,
      text: joinWorkspacePath(target.workspaceRoot, relativePath),
    },
  ];
}

/**
 * The workspace root itself: its name is the project folder name, its tree-relative path is "."
 * and its absolute path is the authorized workspace root.
 */
export function workspaceRootPathCopyActions(
  actionNamespace: string,
  workspaceRoot: string,
  labels: PathCopyLabels,
): readonly TextCopyAction[] {
  const root = workspaceRoot.replace(/[\\/]+$/gu, "") || workspaceRoot;
  return [
    {
      id: `${actionNamespace}.copy-name`,
      actionId: `${actionNamespace}.copy-name`,
      label: labels.fileName,
      text: rootName(root),
    },
    {
      id: `${actionNamespace}.copy-relative-path`,
      actionId: `${actionNamespace}.copy-relative-path`,
      label: labels.relativePath,
      text: ".",
    },
    {
      id: `${actionNamespace}.copy-absolute-path`,
      actionId: `${actionNamespace}.copy-absolute-path`,
      label: labels.absolutePath,
      text: root,
    },
  ];
}

export function buildPathCopyGroup(
  id: string,
  labels: PathCopyLabels,
  actions: readonly TextCopyAction[],
): ContextMenuSubmenuItem {
  return {
    kind: "submenu",
    id,
    label: labels.copy,
    availability: ENABLED,
    children: actions.map(copyCommandItem),
  };
}

export function referenceCopyAction(
  actionNamespace: string,
  label: string,
  fullName: string,
): TextCopyAction {
  return exactCopyAction(`${actionNamespace}.copy-ref`, label, fullName);
}

export function commitCopyAction(
  actionNamespace: string,
  label: string,
  oid: string,
): TextCopyAction {
  return exactCopyAction(`${actionNamespace}.copy-commit-id`, label, oid);
}

export function copyCommandItem(
  action: TextCopyAction,
): Extract<ContextMenuActionItem, { readonly kind: "command" }> {
  return {
    kind: "command",
    id: action.id,
    actionId: action.actionId,
    label: action.label,
    availability: ENABLED,
  };
}

export function textForCopyAction(
  actions: readonly TextCopyAction[],
  actionId: string,
): string | null {
  return actions.find((action) => action.actionId === actionId)?.text ?? null;
}

function exactCopyAction(id: string, label: string, text: string): TextCopyAction {
  return { id, actionId: id, label, text };
}

function normalizeRelativeDisplayPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}

function pathName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function rootName(root: string): string {
  return root.split(/[\\/]/u).filter(Boolean).at(-1) ?? root;
}

function joinWorkspacePath(root: string, path: string): string {
  const windows = root.includes("\\") && !root.includes("/");
  const separator = windows ? "\\" : "/";
  const normalizedPath = windows ? path.replaceAll("/", "\\") : path;
  return `${root.replace(/[\\/]+$/gu, "")}${separator}${normalizedPath}`;
}
