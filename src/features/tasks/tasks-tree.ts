import type { TasksEntry } from "./tasks-model.ts";

export const TASK_TREE_ROOT_KEY = "tasks-tree:workspace";

export type TaskTreeBranchKind = "workspace" | "module" | "tasks" | "group";

export interface TaskTreeBranch {
  readonly type: "branch";
  readonly kind: TaskTreeBranchKind;
  readonly key: string;
  readonly parentKey: string | null;
  readonly label: string;
  readonly detail?: string;
  readonly children: readonly TaskTreeNode[];
}

export interface TaskTreeTask {
  readonly type: "task";
  readonly key: string;
  readonly parentKey: string;
  readonly label: string;
  readonly entry: TasksEntry;
}

export type TaskTreeNode = TaskTreeBranch | TaskTreeTask;

export interface TaskTreeRow {
  readonly node: TaskTreeNode;
  readonly depth: number;
  readonly positionInSet: number;
  readonly setSize: number;
}

export interface TaskTreeRowsResult {
  readonly rows: readonly TaskTreeRow[];
  readonly renderedTasks: number;
  readonly visibleTasks: number;
  readonly truncated: boolean;
}

interface ProjectBucket {
  readonly providerId: string;
  readonly providerLabel: string;
  readonly projectPath: string;
  readonly groups: Map<string, TasksEntry[]>;
}

export function buildTaskTree(
  entries: readonly TasksEntry[],
  workspaceRoot: string,
  tasksLabel = "Tasks",
): TaskTreeBranch {
  const buckets = new Map<string, ProjectBucket>();
  for (const entry of entries) {
    const projectPath = taskProjectPath(entry);
    const bucketKey = `${encode(entry.providerId)}:${encode(projectPath)}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { providerId: entry.providerId, providerLabel: entry.providerLabel, projectPath, groups: new Map() };
      buckets.set(bucketKey, bucket);
    }
    const group = entry.task.group || "Other";
    const tasks = bucket.groups.get(group) ?? [];
    tasks.push(entry);
    bucket.groups.set(group, tasks);
  }

  const children: TaskTreeNode[] = [];
  const sorted = [...buckets.values()].sort(compareProjects);
  for (const bucket of sorted.filter(({ projectPath }) => projectPath === ":")) {
    children.push(tasksBranch(bucket, TASK_TREE_ROOT_KEY, tasksLabel));
  }
  for (const bucket of sorted.filter(({ projectPath }) => projectPath !== ":")) {
    const key = projectKey(bucket);
    children.push({
      type: "branch",
      kind: "module",
      key,
      parentKey: TASK_TREE_ROOT_KEY,
      label: bucket.projectPath.slice(1) || bucket.projectPath,
      detail: bucket.providerLabel,
      children: [tasksBranch(bucket, key, tasksLabel)],
    });
  }
  return {
    type: "branch",
    kind: "workspace",
    key: TASK_TREE_ROOT_KEY,
    parentKey: null,
    label: workspaceName(workspaceRoot),
    children,
  };
}

export function taskTreeRows(
  root: TaskTreeBranch,
  expanded: ReadonlySet<string>,
  taskLimit: number,
  forceExpanded = false,
): TaskTreeRowsResult {
  const rows: TaskTreeRow[] = [{ node: root, depth: 0, positionInSet: 1, setSize: 1 }];
  let renderedTasks = 0;
  let visibleTasks = 0;
  let truncated = false;
  const visit = (nodes: readonly TaskTreeNode[], depth: number): void => {
    nodes.forEach((node, index) => {
      if (node.type === "task") {
        visibleTasks += 1;
        if (renderedTasks >= Math.max(1, taskLimit)) { truncated = true; return; }
        renderedTasks += 1;
      }
      rows.push({ node, depth, positionInSet: index + 1, setSize: nodes.length });
      if (node.type === "branch" && (forceExpanded || expanded.has(node.key))) visit(node.children, depth + 1);
    });
  };
  if (forceExpanded || expanded.has(root.key)) visit(root.children, 1);
  return { rows, renderedTasks, visibleTasks, truncated };
}

export function taskTreeBranchKeys(root: TaskTreeBranch): Set<string> {
  const keys = new Set<string>();
  const visit = (branch: TaskTreeBranch): void => {
    keys.add(branch.key);
    for (const child of branch.children) if (child.type === "branch") visit(child);
  };
  visit(root);
  return keys;
}

export function taskTreeDefaultExpandedKeys(root: TaskTreeBranch): Set<string> {
  const keys = new Set<string>();
  const visit = (branch: TaskTreeBranch): void => {
    if (branch.kind !== "group") keys.add(branch.key);
    for (const child of branch.children) if (child.type === "branch") visit(child);
  };
  visit(root);
  return keys;
}

function tasksBranch(bucket: ProjectBucket, parentKey: string, label: string): TaskTreeBranch {
  const key = `${projectKey(bucket)}:tasks`;
  const groups = [...bucket.groups.entries()].sort(([left], [right]) => compareText(left, right));
  return {
    type: "branch",
    kind: "tasks",
    key,
    parentKey,
    label,
    detail: bucket.projectPath === ":" ? bucket.providerLabel : undefined,
    children: groups.map(([group, entries]) => {
      const groupKey = `${key}:group:${encode(group)}`;
      return {
        type: "branch" as const,
        kind: "group" as const,
        key: groupKey,
        parentKey: key,
        label: groupLabel(group),
        children: [...entries].sort((left, right) => compareText(left.task.id, right.task.id)).map((entry) => ({
          type: "task" as const,
          key: `${groupKey}:task:${encode(entry.key)}`,
          parentKey: groupKey,
          label: entry.displayLabel ?? taskName(entry.task.id, entry.task.label),
          entry,
        })),
      };
    }),
  };
}

function taskProjectPath(entry: TasksEntry): string {
  const explicit = entry.task.projectPath;
  if (explicit && /^:(?:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*)?$/u.test(explicit)) return explicit;
  if (!entry.task.id.startsWith(":")) return ":";
  const separator = entry.task.id.lastIndexOf(":");
  return separator > 0 ? entry.task.id.slice(0, separator) : ":";
}

function projectKey(bucket: Pick<ProjectBucket, "providerId" | "projectPath">): string {
  return `tasks-tree:provider:${encode(bucket.providerId)}:project:${encode(bucket.projectPath)}`;
}

function taskName(id: string, fallback: string): string {
  const separator = id.lastIndexOf(":");
  const name = separator >= 0 ? id.slice(separator + 1) : id;
  return name || fallback;
}

function groupLabel(group: string): string {
  const trimmed = group.replace(/\s+tasks$/iu, "").trim() || group.trim() || "Other";
  return trimmed.charAt(0).toLocaleLowerCase() + trimmed.slice(1);
}

function workspaceName(root: string): string {
  const segments = root.replace(/[\\/]+$/u, "").split(/[\\/]/u).filter(Boolean);
  return segments.at(-1) ?? (root || "Workspace");
}

function compareProjects(left: ProjectBucket, right: ProjectBucket): number {
  if (left.projectPath === ":" && right.projectPath !== ":") return -1;
  if (right.projectPath === ":" && left.projectPath !== ":") return 1;
  return compareText(left.projectPath, right.projectPath) || compareText(left.providerId, right.providerId);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function encode(value: string): string { return encodeURIComponent(value); }
