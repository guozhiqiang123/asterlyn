import type { ContextMenuAnchor } from "./context-menu-model.ts";

export interface ContextMenuSize {
  readonly width: number;
  readonly height: number;
}

export interface ContextMenuViewport {
  readonly width: number;
  readonly height: number;
}

export interface ContextMenuRectangle extends ContextMenuAnchor, ContextMenuSize {}

export interface ContextMenuPosition extends ContextMenuAnchor {
  readonly opensLeft: boolean;
}

const DEFAULT_MARGIN = 4;

export function placeContextMenu(
  anchor: ContextMenuAnchor,
  size: ContextMenuSize,
  viewport: ContextMenuViewport,
  margin = DEFAULT_MARGIN,
): ContextMenuPosition {
  return {
    x: fitCoordinate(anchor.x, size.width, viewport.width, margin),
    y: fitCoordinate(anchor.y, size.height, viewport.height, margin),
    opensLeft: false,
  };
}

export function placeContextSubmenu(
  trigger: ContextMenuRectangle,
  size: ContextMenuSize,
  viewport: ContextMenuViewport,
  margin = DEFAULT_MARGIN,
): ContextMenuPosition {
  const right = trigger.x + trigger.width - 2;
  const left = trigger.x - size.width + 2;
  const fitsRight = right + size.width <= viewport.width - margin;
  const fitsLeft = left >= margin;
  const opensLeft = !fitsRight && fitsLeft;
  return {
    x: fitCoordinate(opensLeft ? left : right, size.width, viewport.width, margin),
    y: fitCoordinate(trigger.y - margin, size.height, viewport.height, margin),
    opensLeft,
  };
}

export function fitCoordinate(
  preferred: number,
  extent: number,
  boundary: number,
  margin = DEFAULT_MARGIN,
): number {
  const maximum = Math.max(margin, boundary - Math.max(0, extent) - margin);
  return Math.round(Math.min(maximum, Math.max(margin, preferred)));
}
