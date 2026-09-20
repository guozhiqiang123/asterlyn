import type { ContextMenuItem } from "./context-menu-model.ts";

export function initialContextMenuIndex(items: readonly ContextMenuItem[]): number {
  const enabled = items.findIndex(
    (item) => isAction(item) && item.availability.kind === "enabled",
  );
  return enabled >= 0 ? enabled : items.findIndex(isAction);
}

export function moveContextMenuIndex(
  items: readonly ContextMenuItem[],
  current: number,
  direction: 1 | -1,
): number {
  if (items.length === 0) return -1;
  let index = current;
  for (let visited = 0; visited < items.length; visited += 1) {
    index = (index + direction + items.length) % items.length;
    if (items[index] && isAction(items[index]!)) return index;
  }
  return -1;
}

export function contextMenuEdgeIndex(
  items: readonly ContextMenuItem[],
  edge: "first" | "last",
): number {
  if (edge === "first") return items.findIndex(isAction);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index] && isAction(items[index]!)) return index;
  }
  return -1;
}

export function contextMenuTypeaheadIndex(
  items: readonly ContextMenuItem[],
  current: number,
  query: string,
): number {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized || items.length === 0) return -1;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (Math.max(current, -1) + offset) % items.length;
    const item = items[index];
    if (item && isAction(item) && item.label.toLocaleLowerCase().startsWith(normalized)) {
      return index;
    }
  }
  return -1;
}

function isAction(
  item: ContextMenuItem,
): item is Exclude<ContextMenuItem, { readonly kind: "separator" | "heading" }> {
  return item.kind !== "separator" && item.kind !== "heading";
}
