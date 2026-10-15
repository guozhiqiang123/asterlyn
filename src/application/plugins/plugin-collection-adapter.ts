import {
  SDK_COLLECTION_LIMITS,
  type SdkCollectionNode,
  type SdkHierarchicalCollection,
} from "../../../packages/plugin-sdk/index.ts";

export interface NormalizedCollectionNode extends SdkCollectionNode {
  readonly depth: number;
}

export interface NormalizedCollectionRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly label: string;
  readonly kind: SdkCollectionNode["kind"];
  readonly taskId?: string;
}

export interface NormalizedHierarchicalCollection {
  readonly providerId: string;
  readonly nodes: readonly NormalizedCollectionNode[];
  readonly rows: readonly NormalizedCollectionRow[];
  readonly truncated: boolean;
}

const STABLE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u;

export function normalizeHierarchicalCollection(collection: SdkHierarchicalCollection): NormalizedHierarchicalCollection {
  validateText(collection.providerId, "providerId", SDK_COLLECTION_LIMITS.maxIdLength);
  if (!Array.isArray(collection.nodes) || collection.nodes.length > SDK_COLLECTION_LIMITS.maxNodes) {
    throw new Error("Collection node count exceeds the limit.");
  }
  if (typeof collection.truncated !== "boolean") throw new Error("Collection truncated flag is invalid.");

  const byId = new Map<string, SdkCollectionNode>();
  const taskIds = new Set<string>();
  for (const node of collection.nodes) {
    validateNode(node);
    if (byId.has(node.id)) throw new Error(`Duplicate collection node ID: ${node.id}`);
    byId.set(node.id, node);
    if (node.kind === "task") {
      if (!node.taskId) throw new Error(`Task node is missing taskId: ${node.id}`);
      if (taskIds.has(node.taskId)) throw new Error(`Duplicate collection taskId: ${node.taskId}`);
      taskIds.add(node.taskId);
    } else if (node.taskId !== undefined) {
      throw new Error(`Group node cannot reference taskId: ${node.id}`);
    }
  }

  const children = new Map<string | null, SdkCollectionNode[]>();
  for (const node of collection.nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) throw new Error(`Missing collection parent: ${node.parentId}`);
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    for (let index = 1; index < siblings.length; index += 1) {
      if (siblings[index - 1]!.order === siblings[index]!.order) throw new Error("Collection sibling order must be unique.");
    }
  }

  const nodes: NormalizedCollectionNode[] = [];
  const rows: NormalizedCollectionRow[] = [];
  const visiting = new Set<string>();
  const visit = (node: SdkCollectionNode, depth: number): void => {
    if (visiting.has(node.id)) throw new Error(`Collection contains a cycle at: ${node.id}`);
    if (depth > SDK_COLLECTION_LIMITS.maxDepth) throw new Error("Collection depth exceeds the limit.");
    visiting.add(node.id);
    const normalized = { ...node, depth };
    nodes.push(normalized);
    rows.push({ id: node.id, parentId: node.parentId, depth, label: node.label, kind: node.kind, ...(node.taskId === undefined ? {} : { taskId: node.taskId }) });
    for (const child of children.get(node.id) ?? []) visit(child, depth + 1);
    visiting.delete(node.id);
  };
  for (const root of children.get(null) ?? []) visit(root, 0);
  if (nodes.length !== collection.nodes.length) throw new Error("Collection contains an unreachable node.");
  return { providerId: collection.providerId, nodes, rows, truncated: collection.truncated };
}

function validateNode(node: SdkCollectionNode): void {
  validateText(node.id, "node ID", SDK_COLLECTION_LIMITS.maxIdLength);
  if (!STABLE_ID.test(node.id)) throw new Error(`Collection node ID is not stable: ${node.id}`);
  if (node.parentId !== null) {
    validateText(node.parentId, "parent ID", SDK_COLLECTION_LIMITS.maxIdLength);
    if (!STABLE_ID.test(node.parentId)) throw new Error(`Collection parent ID is not stable: ${node.parentId}`);
  }
  if (node.kind !== "group" && node.kind !== "task") throw new Error(`Collection node kind is invalid: ${node.id}`);
  validateText(node.label, "label", SDK_COLLECTION_LIMITS.maxLabelLength);
  if (!Number.isSafeInteger(node.order) || node.order < 0) throw new Error(`Collection order is invalid: ${node.id}`);
  if (node.taskId !== undefined) validateText(node.taskId, "task ID", SDK_COLLECTION_LIMITS.maxIdLength);
  const metadata = node.metadata;
  if (metadata !== undefined) {
    const entries = Object.entries(metadata);
    if (entries.length > SDK_COLLECTION_LIMITS.maxMetadataEntries) throw new Error("Collection metadata exceeds the limit.");
    for (const [key, value] of entries) {
      validateText(key, "metadata key", SDK_COLLECTION_LIMITS.maxMetadataKeyLength);
      validateText(value, "metadata value", SDK_COLLECTION_LIMITS.maxMetadataValueLength);
    }
  }
}

function validateText(value: string, label: string, max: number): void {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0")) throw new Error(`Collection ${label} is invalid.`);
}
