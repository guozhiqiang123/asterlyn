import {
  DisclosureState,
  HierarchicalCollection,
  type CollectionViewMode,
  type HierarchicalCollectionNode,
  type HierarchicalCollectionProjection,
  type HierarchicalCollectionRow,
} from "../../presentation/hierarchical-collection.ts";
import type { TaskProviderProjection, TasksEntry } from "./tasks-model.ts";

export const TASK_TREE_ROOT_KEY = "tasks-tree:workspace";

export type TaskTreeBranchKind = "workspace" | "module" | "tasks" | "group";

export interface TaskTreeBranch extends HierarchicalCollectionNode {
  readonly type: "branch";
  readonly role: "branch";
  readonly kind: TaskTreeBranchKind;
  readonly key: string;
  readonly parentKey: string | null;
  readonly detail?: string;
  readonly children: readonly TaskTreeNode[];
}

export interface TaskTreeTask extends HierarchicalCollectionNode {
  readonly type: "task";
  readonly role: "leaf";
  readonly key: string;
  readonly parentKey: string;
  readonly entry: TasksEntry;
}

export type TaskTreeNode = TaskTreeBranch | TaskTreeTask;
export type TaskTreeRow = HierarchicalCollectionRow<TaskTreeNode>;

export interface TaskTreeRowsResult extends HierarchicalCollectionProjection<TaskTreeNode> {
  readonly renderedTasks: number;
  readonly visibleTasks: number;
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
  providers: readonly TaskProviderProjection[] = [],
): TaskTreeBranch {
  const contributedProviderIds = new Set(providers.filter((provider) => provider.collection).map((provider) => provider.id));
  const contributed = providers
    .filter((provider) => provider.collection)
    .sort((left, right) => compareText(left.id, right.id))
    .flatMap((provider) => contributedNodes(provider, entries, tasksLabel));
  const fallback = fallbackNodes(entries.filter((entry) => !contributedProviderIds.has(entry.providerId)), tasksLabel);
  const children = [...contributed, ...fallback]
    .sort(compareRootNodes)
    .map((node, order) => ({ ...node, order }));
  return branch("workspace", TASK_TREE_ROOT_KEY, null, workspaceName(workspaceRoot), 0, children, true);
}

export function taskTreeRows(
  root: TaskTreeBranch,
  expanded: ReadonlySet<string>,
  taskLimit: number,
  forceExpanded = false,
  mode: CollectionViewMode = "tree",
): TaskTreeRowsResult {
  const disclosure = new DisclosureState({ defaultExpanded: false, exceptions: expanded });
  const projection = taskTreeCollection(root).project({ mode, disclosure, forceExpanded, leafLimit: taskLimit });
  return {
    ...projection,
    renderedTasks: projection.renderedLeaves,
    visibleTasks: projection.visibleLeaves,
  };
}

export function taskTreeBranchKeys(root: TaskTreeBranch): Set<string> {
  return new Set(taskTreeCollection(root).branchIds());
}

export function taskTreeDefaultExpandedKeys(root: TaskTreeBranch): Set<string> {
  return new Set(taskTreeCollection(root).defaultExpandedIds());
}

function contributedNodes(
  provider: TaskProviderProjection,
  entries: readonly TasksEntry[],
  tasksLabel: string,
): readonly TaskTreeNode[] {
  const collection = provider.collection;
  if (!collection) return [];
  const entriesByTaskId = new Map(entries
    .filter((entry) => entry.providerId === provider.id)
    .map((entry) => [entry.task.id, entry] as const));
  const children = new Map<string | null, typeof collection.nodes[number][]>();
  for (const node of collection.nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.order - right.order || compareText(left.id, right.id));
  const visit = (node: typeof collection.nodes[number], parentKey: string): TaskTreeNode | null => {
    if (node.kind === "task") {
      const entry = node.taskId ? entriesByTaskId.get(node.taskId) : undefined;
      return entry ? task(node.id, parentKey, node.label, node.order, entry) : null;
    }
    const nested = (children.get(node.id) ?? []).map((child) => visit(child, node.id)).filter(isTaskTreeNode);
    if (nested.length === 0) return null;
    const kind = contributedBranchKind(node.metadata?.["android.gradle.nodeKind"]);
    return branch(
      kind,
      node.id,
      parentKey,
      kind === "tasks" ? tasksLabel : node.label,
      node.order,
      nested,
      kind !== "group",
      kind === "tasks" && node.parentId === null ? provider.label : undefined,
    );
  };
  return (children.get(null) ?? []).map((node) => visit(node, TASK_TREE_ROOT_KEY)).filter(isTaskTreeNode);
}

function fallbackNodes(entries: readonly TasksEntry[], tasksLabel: string): readonly TaskTreeNode[] {
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
    bucket.groups.set(group, [...(bucket.groups.get(group) ?? []), entry]);
  }
  const children: TaskTreeNode[] = [];
  const sorted = [...buckets.values()].sort(compareProjects);
  for (const bucket of sorted.filter(({ projectPath }) => projectPath === ":")) {
    children.push(tasksBranch(bucket, TASK_TREE_ROOT_KEY, tasksLabel, children.length));
  }
  for (const bucket of sorted.filter(({ projectPath }) => projectPath !== ":")) {
    const key = projectKey(bucket);
    children.push(branch("module", key, TASK_TREE_ROOT_KEY, bucket.projectPath.slice(1) || bucket.projectPath, children.length, [
      tasksBranch(bucket, key, tasksLabel, 0),
    ], true, bucket.providerLabel));
  }
  return children;
}

function tasksBranch(bucket: ProjectBucket, parentKey: string, label: string, order: number): TaskTreeBranch {
  const key = `${projectKey(bucket)}:tasks`;
  const groups = [...bucket.groups.entries()].sort(([left], [right]) => compareText(left, right));
  return branch("tasks", key, parentKey, label, order, groups.map(([group, entries], groupOrder) => {
    const groupKey = `${key}:group:${encode(group)}`;
    return branch("group", groupKey, key, groupLabel(group), groupOrder,
      [...entries].sort((left, right) => compareText(left.task.id, right.task.id)).map((entry, taskOrder) =>
        task(`${groupKey}:task:${encode(entry.key)}`, groupKey, entry.displayLabel ?? taskName(entry.task.id, entry.task.label), taskOrder, entry)),
      false);
  }), true, bucket.projectPath === ":" ? bucket.providerLabel : undefined);
}

function branch(
  kind: TaskTreeBranchKind,
  key: string,
  parentKey: string | null,
  label: string,
  order: number,
  children: readonly TaskTreeNode[],
  defaultExpanded: boolean,
  detail?: string,
): TaskTreeBranch {
  return {
    type: "branch", role: "branch", kind, key, id: key, parentKey, parentId: parentKey,
    label, order, children, defaultExpanded, ...(detail ? { detail } : {}),
  };
}

function task(key: string, parentKey: string, label: string, order: number, entry: TasksEntry): TaskTreeTask {
  return { type: "task", role: "leaf", key, id: key, parentKey, parentId: parentKey, label, order, entry };
}

function taskTreeCollection(root: TaskTreeBranch): HierarchicalCollection<TaskTreeNode> {
  const nodes: TaskTreeNode[] = [];
  const visit = (node: TaskTreeNode): void => {
    nodes.push(node);
    if (node.type === "branch") for (const child of node.children) visit(child);
  };
  visit(root);
  return new HierarchicalCollection(nodes);
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

function contributedBranchKind(value: string | undefined): TaskTreeBranchKind {
  return value === "module" || value === "tasks" || value === "group" ? value : "group";
}

function compareRootNodes(left: TaskTreeNode, right: TaskTreeNode): number {
  const rank = (node: TaskTreeNode): number => node.type === "branch" && node.kind === "tasks" ? 0 : 1;
  return rank(left) - rank(right) || left.order - right.order || compareText(left.key, right.key);
}

function compareProjects(left: ProjectBucket, right: ProjectBucket): number {
  if (left.projectPath === ":" && right.projectPath !== ":") return -1;
  if (right.projectPath === ":" && left.projectPath !== ":") return 1;
  return compareText(left.projectPath, right.projectPath) || compareText(left.providerId, right.providerId);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function isTaskTreeNode(node: TaskTreeNode | null): node is TaskTreeNode { return node !== null; }
function encode(value: string): string { return encodeURIComponent(value); }
