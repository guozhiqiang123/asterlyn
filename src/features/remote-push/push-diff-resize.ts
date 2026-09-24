/** Session-only geometry for the nested Push Diff review window. */
export interface PushDiffRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PushDiffBounds {
  width: number;
  height: number;
}

export type PushDiffResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const INSET = 12;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 360;
const geometry = new WeakMap<HTMLElement, PushDiffRect>();
const bindings = new WeakMap<HTMLElement, AbortController>();

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function fitPushDiffRect(rect: PushDiffRect, bounds: PushDiffBounds): PushDiffRect {
  const availableWidth = Math.max(0, bounds.width - 2 * INSET);
  const availableHeight = Math.max(0, bounds.height - 2 * INSET);
  const width = clamp(rect.width, Math.min(MIN_WIDTH, availableWidth), availableWidth);
  const height = clamp(rect.height, Math.min(MIN_HEIGHT, availableHeight), availableHeight);
  return {
    left: clamp(rect.left, INSET, Math.max(INSET, bounds.width - INSET - width)),
    top: clamp(rect.top, INSET, Math.max(INSET, bounds.height - INSET - height)),
    width,
    height,
  };
}

export function resizePushDiffRect(
  initial: PushDiffRect,
  edge: PushDiffResizeEdge,
  dx: number,
  dy: number,
  bounds: PushDiffBounds,
): PushDiffRect {
  const start = fitPushDiffRect(initial, bounds);
  const minWidth = Math.min(MIN_WIDTH, bounds.width - 2 * INSET);
  const minHeight = Math.min(MIN_HEIGHT, bounds.height - 2 * INSET);
  let left = start.left;
  let right = start.left + start.width;
  let top = start.top;
  let bottom = start.top + start.height;
  if (edge.includes("e")) right = clamp(right + dx, left + minWidth, bounds.width - INSET);
  if (edge.includes("w")) left = clamp(left + dx, INSET, right - minWidth);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + minHeight, bounds.height - INSET);
  if (edge.includes("n")) top = clamp(top + dy, INSET, bottom - minHeight);
  return { left, top, width: right - left, height: bottom - top };
}

/** Rebind after each remote-dialog render while retaining the user's last size. */
export function bindPushDiffResize(root: HTMLElement): void {
  bindings.get(root)?.abort();
  bindings.delete(root);
  const backdrop = root.querySelector<HTMLElement>("#push-diff-backdrop");
  const dialog = backdrop?.querySelector<HTMLElement>(".push-diff-dialog");
  if (!backdrop || !dialog) return;
  const controller = new AbortController();
  bindings.set(root, controller);
  const signal = controller.signal;
  const bounds = (): PushDiffBounds => {
    const rect = backdrop.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  };
  const measured = (): PushDiffRect => {
    const frame = backdrop.getBoundingClientRect();
    const rect = dialog.getBoundingClientRect();
    return { left: rect.left - frame.left, top: rect.top - frame.top, width: rect.width, height: rect.height };
  };
  const apply = (rect: PushDiffRect): void => {
    const next = fitPushDiffRect(rect, bounds());
    geometry.set(root, next);
    dialog.style.position = "absolute";
    dialog.style.left = `${next.left}px`;
    dialog.style.top = `${next.top}px`;
    dialog.style.width = `${next.width}px`;
    dialog.style.height = `${next.height}px`;
  };
  const saved = geometry.get(root);
  if (saved) apply(saved);

  let drag: { pointerId: number; edge: PushDiffResizeEdge; x: number; y: number; rect: PushDiffRect } | null = null;
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const handle = event.target.closest<HTMLElement>("[data-push-diff-resize]");
    if (!handle || !dialog.contains(handle)) return;
    const edge = handle.dataset.pushDiffResize as PushDiffResizeEdge;
    const rect = fitPushDiffRect(geometry.get(root) ?? measured(), bounds());
    apply(rect);
    drag = { pointerId: event.pointerId, edge, x: event.clientX, y: event.clientY, rect };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, { signal });
  backdrop.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    apply(resizePushDiffRect(drag.rect, drag.edge, event.clientX - drag.x, event.clientY - drag.y, bounds()));
    event.preventDefault();
  }, { signal });
  const finish = (event: PointerEvent): void => {
    if (drag?.pointerId === event.pointerId) drag = null;
  };
  backdrop.addEventListener("pointerup", finish, { signal });
  backdrop.addEventListener("pointercancel", finish, { signal });
  backdrop.addEventListener("keydown", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-push-diff-resize="se"]')) return;
    const step = event.shiftKey ? 48 : 16;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    apply(resizePushDiffRect(geometry.get(root) ?? measured(), "se", dx, dy, bounds()));
    event.preventDefault();
  }, { signal });
  window.addEventListener("resize", () => {
    const current = geometry.get(root);
    if (current) apply(current);
  }, { signal });
}
