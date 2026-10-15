import type {
  CollectionViewMode,
  HierarchicalCollectionNode,
  HierarchicalCollectionProjection,
  HierarchicalCollectionRow,
} from "./hierarchical-collection.ts";

export interface HierarchicalCollectionRenderedRow {
  readonly className?: string;
  readonly selected?: boolean;
  readonly attributes?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly content: string;
}

export interface HierarchicalCollectionRenderOptions<T extends HierarchicalCollectionNode> {
  readonly projection: HierarchicalCollectionProjection<T>;
  readonly mode: CollectionViewMode;
  readonly ariaLabel: string;
  readonly className?: string;
  readonly renderRow: (row: HierarchicalCollectionRow<T>) => HierarchicalCollectionRenderedRow;
}

/** Render one host-owned collection DOM contract while features supply only trusted row content. */
export function renderHierarchicalCollection<T extends HierarchicalCollectionNode>(
  options: HierarchicalCollectionRenderOptions<T>,
): string {
  const role = options.mode === "tree" ? "tree" : "list";
  const className = options.className ? `hierarchical-collection ${options.className}` : "hierarchical-collection";
  const rows = options.projection.rows.map((row) => renderRow(row, options.mode, options.renderRow(row))).join("");
  return `<div class="${escapeAttribute(className)}" role="${role}" aria-label="${escapeAttribute(options.ariaLabel)}" tabindex="0" data-collection-root data-collection-mode="${options.mode}">${rows}</div>`;
}

function renderRow<T extends HierarchicalCollectionNode>(
  row: HierarchicalCollectionRow<T>,
  mode: CollectionViewMode,
  rendered: HierarchicalCollectionRenderedRow,
): string {
  const role = mode === "tree" ? "treeitem" : "listitem";
  const className = rendered.className ? `hierarchical-collection-row ${rendered.className}` : "hierarchical-collection-row";
  const parent = row.node.parentId === null ? "" : ` data-collection-parent-id="${escapeAttribute(row.node.parentId)}"`;
  const expanded = mode === "tree" && row.node.role === "branch" ? ` aria-expanded="${row.expanded}"` : "";
  const treeMetadata = mode === "tree"
    ? ` aria-level="${row.depth + 1}" aria-posinset="${row.positionInSet}" aria-setsize="${row.setSize}"`
    : "";
  const selected = rendered.selected === undefined ? "" : ` aria-selected="${rendered.selected}"`;
  return `<div class="${escapeAttribute(className)}" role="${role}" tabindex="-1" data-collection-row data-collection-node-id="${escapeAttribute(row.node.id)}" data-collection-node-role="${row.node.role}"${parent} style="--tree-depth:${row.depth}"${expanded}${treeMetadata}${selected}${renderAttributes(rendered.attributes)}>${rendered.content}</div>`;
}

function renderAttributes(attributes: HierarchicalCollectionRenderedRow["attributes"]): string {
  if (!attributes) return "";
  return Object.entries(attributes).flatMap(([name, value]) => {
    if (!/^(?:aria|data)-[a-z0-9_.:-]+$/u.test(name) || value === null || value === undefined || value === false) return [];
    return value === true ? [` ${name}`] : [` ${name}="${escapeAttribute(String(value))}"`];
  }).join("");
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
