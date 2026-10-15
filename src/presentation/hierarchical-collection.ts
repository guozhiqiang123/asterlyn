export type CollectionViewMode = "tree" | "flat";

export interface CollectionNodeLike {
  readonly id: string;
  readonly parentId: string | null;
  readonly label: string;
  readonly order: number;
}

export interface CollectionVisibleRow<T extends CollectionNodeLike> {
  readonly node: T;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
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
