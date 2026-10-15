export type CollectionViewMode = "tree" | "flat";

export interface CollectionNodeLike {
  readonly id: string;
  readonly parentId: string | null;
  readonly label: string;
  readonly order: number;
}

export type CollectionNodeRole = "branch" | "leaf";

export interface HierarchicalCollectionNode extends CollectionNodeLike {
  readonly role: CollectionNodeRole;
  readonly defaultExpanded?: boolean;
}

export interface CollectionVisibleRow<T extends CollectionNodeLike> {
  readonly node: T;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

export interface HierarchicalCollectionRow<T extends HierarchicalCollectionNode> extends CollectionVisibleRow<T> {
  readonly positionInSet: number;
  readonly setSize: number;
}

export interface HierarchicalCollectionProjection<T extends HierarchicalCollectionNode> {
  readonly rows: readonly HierarchicalCollectionRow<T>[];
  readonly visibleLeaves: number;
  readonly renderedLeaves: number;
  readonly truncated: boolean;
}

export interface HierarchicalCollectionProjectionOptions<T extends HierarchicalCollectionNode> {
  readonly mode?: CollectionViewMode;
  readonly disclosure?: DisclosureState;
  readonly forceExpanded?: boolean;
  readonly leafLimit?: number;
  /** Project this branch's children as top-level rows without rendering the synthetic branch. */
  readonly contentRootId?: string;
  /** Matching nodes, their ancestors, and a matching branch's descendants remain in the projection. */
  readonly filter?: (node: T) => boolean;
}

export interface DisclosureSnapshot {
  readonly defaultExpanded: boolean;
  readonly exceptions: ReadonlySet<string>;
}

export class DisclosureState {
  private defaultExpanded: boolean;
  private readonly exceptions = new Set<string>();

  constructor(snapshot: Partial<DisclosureSnapshot> = {}) {
    this.defaultExpanded = snapshot.defaultExpanded ?? false;
    for (const id of snapshot.exceptions ?? []) this.exceptions.add(id);
  }

  isExpanded(id: string): boolean { return this.exceptions.has(id) ? !this.defaultExpanded : this.defaultExpanded; }
  get snapshot(): DisclosureSnapshot { return { defaultExpanded: this.defaultExpanded, exceptions: new Set(this.exceptions) }; }
  expandAll(): void { this.defaultExpanded = true; this.exceptions.clear(); }
  collapseAll(): void { this.defaultExpanded = false; this.exceptions.clear(); }

  toggle(id: string): void {
    const next = !this.isExpanded(id);
    if (next === this.defaultExpanded) this.exceptions.delete(id);
    else this.exceptions.add(id);
  }

  setSubtreeExpanded<T extends CollectionNodeLike>(selectedId: string, expanded: boolean, nodes: readonly T[]): void {
    const children = childMap(nodes);
    const visit = (id: string): void => {
      if (expanded === this.defaultExpanded) this.exceptions.delete(id);
      else this.exceptions.add(id);
      for (const child of children.get(id) ?? []) visit(child.id);
    };
    if (nodes.some((node) => node.id === selectedId)) visit(selectedId);
  }

  reconcile<T extends CollectionNodeLike>(nodes: readonly T[]): void {
    const ids = new Set(nodes.map((node) => node.id));
    for (const id of this.exceptions) if (!ids.has(id)) this.exceptions.delete(id);
  }
}

/**
 * Immutable, DOM-neutral hierarchy used by host-owned collection surfaces.
 *
 * Feature records stay on node subtypes. This class owns only stable hierarchy, ordering,
 * projection, disclosure metadata, and bounded leaf rendering.
 */
export class HierarchicalCollection<T extends HierarchicalCollectionNode> {
  private readonly orderedNodes: readonly T[];
  private readonly byId = new Map<string, T>();
  private readonly children = new Map<string | null, readonly T[]>();

  constructor(nodes: readonly T[]) {
    for (const node of nodes) {
      if (this.byId.has(node.id)) throw new Error(`Duplicate collection node ID: ${node.id}`);
      this.byId.set(node.id, node);
    }
    const mutableChildren = new Map<string | null, T[]>();
    for (const node of nodes) {
      if (node.parentId !== null && !this.byId.has(node.parentId)) {
        throw new Error(`Missing collection parent: ${node.parentId}`);
      }
      const siblings = mutableChildren.get(node.parentId) ?? [];
      siblings.push(node);
      mutableChildren.set(node.parentId, siblings);
    }
    for (const [parentId, siblings] of mutableChildren) {
      siblings.sort(compareCollectionNodes);
      this.children.set(parentId, Object.freeze([...siblings]));
    }
    const ordered: T[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (node: T): void => {
      if (visiting.has(node.id)) throw new Error(`Collection contains a cycle at: ${node.id}`);
      if (visited.has(node.id)) return;
      visiting.add(node.id);
      ordered.push(node);
      for (const child of this.children.get(node.id) ?? []) visit(child);
      visiting.delete(node.id);
      visited.add(node.id);
    };
    for (const root of this.children.get(null) ?? []) visit(root);
    if (visited.size !== nodes.length) throw new Error("Collection contains an unreachable node.");
    this.orderedNodes = Object.freeze(ordered);
  }

  get nodes(): readonly T[] { return this.orderedNodes; }
  node(id: string): T | undefined { return this.byId.get(id); }
  childrenOf(parentId: string | null): readonly T[] { return this.children.get(parentId) ?? []; }
  branchIds(): ReadonlySet<string> { return new Set(this.orderedNodes.filter((node) => node.role === "branch").map((node) => node.id)); }
  defaultExpandedIds(): ReadonlySet<string> { return new Set(this.orderedNodes.filter((node) => node.role === "branch" && node.defaultExpanded).map((node) => node.id)); }

  ancestorsOf(selectedId: string): readonly T[] {
    const result: T[] = [];
    const seen = new Set<string>();
    let current = this.byId.get(selectedId)?.parentId ?? null;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      const node = this.byId.get(current);
      if (!node) break;
      result.unshift(node);
      current = node.parentId;
    }
    return result;
  }

  descendantsOf(selectedId: string): readonly T[] {
    const result: T[] = [];
    const visit = (id: string): void => {
      for (const child of this.children.get(id) ?? []) {
        result.push(child);
        visit(child.id);
      }
    };
    visit(selectedId);
    return result;
  }

  project(options: HierarchicalCollectionProjectionOptions<T> = {}): HierarchicalCollectionProjection<T> {
    const mode = options.mode ?? "tree";
    const disclosure = options.disclosure ?? new DisclosureState();
    const forceExpanded = options.forceExpanded ?? false;
    let contentRoot: T | null = null;
    if (options.contentRootId !== undefined) {
      const candidate = this.byId.get(options.contentRootId);
      if (!candidate || candidate.role !== "branch") {
        throw new Error(`Invalid collection content root: ${options.contentRootId}`);
      }
      contentRoot = candidate;
    }
    const contentIds = contentRoot === null
      ? null
      : new Set(this.descendantsOf(contentRoot.id).map((node) => node.id));
    const limit = options.leafLimit === undefined
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, Math.floor(options.leafLimit));
    const included = options.filter ? this.filteredIds(options.filter) : null;
    const activeChildren = (parentId: string | null): readonly T[] => (this.children.get(parentId) ?? [])
      .filter((node) => (contentIds === null || contentIds.has(node.id)) && (included === null || included.has(node.id)));
    const rows: HierarchicalCollectionRow<T>[] = [];
    let visibleLeaves = 0;
    let renderedLeaves = 0;
    const append = (node: T, depth: number, positionInSet: number, setSize: number, expanded: boolean): void => {
      if (node.role === "leaf") {
        visibleLeaves += 1;
        if (renderedLeaves >= limit) return;
        renderedLeaves += 1;
      }
      rows.push({
        node,
        depth,
        hasChildren: activeChildren(node.id).length > 0,
        expanded,
        positionInSet,
        setSize,
      });
    };
    if (mode === "flat") {
      const leaves = this.orderedNodes.filter((node) =>
        node.role === "leaf" &&
        (contentIds === null || contentIds.has(node.id)) &&
        (included === null || included.has(node.id)));
      leaves.forEach((node, index) => append(node, 0, index + 1, leaves.length, false));
      return { rows, visibleLeaves, renderedLeaves, truncated: renderedLeaves < visibleLeaves };
    }
    const visit = (nodesAtDepth: readonly T[], depth: number): void => {
      nodesAtDepth.forEach((node, index) => {
        const children = activeChildren(node.id);
        const expanded = node.role === "branch" && (forceExpanded || disclosure.isExpanded(node.id));
        append(node, depth, index + 1, nodesAtDepth.length, expanded);
        if (children.length > 0 && expanded) visit(children, depth + 1);
      });
    };
    visit(activeChildren(contentRoot?.id ?? null), 0);
    return { rows, visibleLeaves, renderedLeaves, truncated: renderedLeaves < visibleLeaves };
  }

  private filteredIds(filter: (node: T) => boolean): ReadonlySet<string> {
    const included = new Set<string>();
    for (const node of this.orderedNodes) {
      if (!filter(node)) continue;
      included.add(node.id);
      for (const ancestor of this.ancestorsOf(node.id)) included.add(ancestor.id);
      if (node.role === "branch") for (const descendant of this.descendantsOf(node.id)) included.add(descendant.id);
    }
    return included;
  }
}

export type HierarchicalCollectionNavigationKey = "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft" | "Home" | "End";

export interface HierarchicalCollectionNavigation {
  readonly handled: boolean;
  readonly focusId?: string;
  readonly toggleId?: string;
}

export interface HierarchicalCollectionNavigationRow {
  readonly node: Pick<HierarchicalCollectionNode, "id" | "parentId" | "role">;
  readonly expanded: boolean;
}

/** Convert a tree key press into a feature-independent focus or disclosure decision. */
export function hierarchicalCollectionNavigation(
  rows: readonly HierarchicalCollectionNavigationRow[],
  currentId: string | null,
  key: HierarchicalCollectionNavigationKey,
): HierarchicalCollectionNavigation {
  if (rows.length === 0) return { handled: false };
  const index = currentId === null ? -1 : rows.findIndex((row) => row.node.id === currentId);
  if (index < 0) {
    const edge = key === "ArrowUp" || key === "End" ? rows.at(-1) : rows[0];
    return edge ? { handled: true, focusId: edge.node.id } : { handled: false };
  }
  const row = rows[index]!;
  if (key === "Home" || key === "End" || key === "ArrowDown" || key === "ArrowUp") {
    const nextIndex = key === "Home" ? 0
      : key === "End" ? rows.length - 1
        : Math.max(0, Math.min(rows.length - 1, index + (key === "ArrowDown" ? 1 : -1)));
    return { handled: true, focusId: rows[nextIndex]!.node.id };
  }
  if (key === "ArrowRight" && row.node.role === "branch") {
    if (!row.expanded) return { handled: true, toggleId: row.node.id };
    const child = rows[index + 1];
    return child && child.node.parentId === row.node.id
      ? { handled: true, focusId: child.node.id }
      : { handled: true };
  }
  if (key === "ArrowLeft") {
    if (row.node.role === "branch" && row.expanded) return { handled: true, toggleId: row.node.id };
    return row.node.parentId && rows.some((candidate) => candidate.node.id === row.node.parentId)
      ? { handled: true, focusId: row.node.parentId }
      : { handled: true };
  }
  return { handled: false };
}

export function projectVisibleRows<T extends CollectionNodeLike>(nodes: readonly T[], mode: CollectionViewMode, disclosure: DisclosureState): readonly CollectionVisibleRow<T>[] {
  const ordered = [...nodes].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const children = childMap(ordered);
  if (mode === "flat") {
    const flat: T[] = [];
    const visitFlat = (node: T): void => { flat.push(node); for (const child of children.get(node.id) ?? []) visitFlat(child); };
    for (const root of children.get(null) ?? []) visitFlat(root);
    return flat.map((node) => ({ node, depth: 0, hasChildren: false, expanded: false }));
  }
  const rows: CollectionVisibleRow<T>[] = [];
  const visit = (node: T, depth: number): void => {
    const descendants = children.get(node.id) ?? [];
    const expanded = disclosure.isExpanded(node.id);
    rows.push({ node, depth, hasChildren: descendants.length > 0, expanded });
    if (expanded) for (const child of descendants) visit(child, depth + 1);
  };
  for (const root of children.get(null) ?? []) visit(root, 0);
  return rows;
}

export function collectionAncestors<T extends CollectionNodeLike>(selectedId: string, nodes: readonly T[]): readonly T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: T[] = [];
  const seen = new Set<string>();
  let current = byId.get(selectedId)?.parentId ?? null;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) break;
    result.unshift(node);
    current = node.parentId;
  }
  return result;
}

export function collectionDescendants<T extends CollectionNodeLike>(selectedId: string, nodes: readonly T[]): readonly T[] {
  const children = childMap(nodes);
  const result: T[] = [];
  const visit = (id: string): void => { for (const child of children.get(id) ?? []) { result.push(child); visit(child.id); } };
  visit(selectedId);
  return result;
}

function childMap<T extends CollectionNodeLike>(nodes: readonly T[]): Map<string | null, T[]> {
  const children = new Map<string | null, T[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    siblings.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    children.set(node.parentId, siblings);
  }
  return children;
}

function compareCollectionNodes(left: CollectionNodeLike, right: CollectionNodeLike): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}
