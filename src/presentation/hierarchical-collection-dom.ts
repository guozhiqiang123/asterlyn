import {
  hierarchicalCollectionNavigation,
  type HierarchicalCollectionNavigation,
  type HierarchicalCollectionNavigationKey,
  type HierarchicalCollectionNavigationRow,
} from "./hierarchical-collection.ts";

/** Read only the shared collection DOM contract and return a DOM-neutral navigation decision. */
export function hierarchicalCollectionDomNavigation(
  root: ParentNode,
  current: Element | null,
  key: HierarchicalCollectionNavigationKey,
): HierarchicalCollectionNavigation {
  const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-collection-row]"));
  const rows: HierarchicalCollectionNavigationRow[] = elements.flatMap((element) => {
    const id = element.dataset.collectionNodeId;
    const role = element.dataset.collectionNodeRole;
    if (!id || (role !== "branch" && role !== "leaf")) return [];
    return [{
      node: { id, parentId: element.dataset.collectionParentId ?? null, role },
      expanded: element.getAttribute("aria-expanded") === "true",
    }];
  });
  const currentId = current?.closest<HTMLElement>("[data-collection-row]")?.dataset.collectionNodeId ?? null;
  return hierarchicalCollectionNavigation(rows, currentId, key);
}

export function hierarchicalCollectionRowElement(root: ParentNode, id: string): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-collection-row]"))
    .find((row) => row.dataset.collectionNodeId === id) ?? null;
}
