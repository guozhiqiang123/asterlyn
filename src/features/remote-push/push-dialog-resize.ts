/** Geometry and persistence for the resizable Push review window. */
export interface PushDialogRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PushDialogBounds {
  width: number;
  height: number;
}

export type PushDialogResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export const PUSH_DIALOG_GEOMETRY_KEY = "asterlyn.push-dialog-geometry";

const INSET = 12;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 420;
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 680;

const geometry = new WeakMap<HTMLElement, PushDialogRect>();
const bindings = new WeakMap<HTMLElement, AbortController>();

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function defaultPushDialogRect(bounds: PushDialogBounds): PushDialogRect {
  const availableWidth = Math.max(0, bounds.width - 2 * INSET);
  const availableHeight = Math.max(0, bounds.height - 2 * INSET);
  const width = clamp(DEFAULT_WIDTH, Math.min(MIN_WIDTH, availableWidth), availableWidth);
  const height = clamp(DEFAULT_HEIGHT, Math.min(MIN_HEIGHT, availableHeight), availableHeight);
  const left = Math.max(INSET, Math.round((bounds.width - width) / 2));
  const top = Math.max(INSET, Math.round((bounds.height - height) / 2));
  return { left, top, width, height };
}

export function fitPushDialogRect(rect: PushDialogRect, bounds: PushDialogBounds): PushDialogRect {
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

export function resizePushDialogRect(
  initial: PushDialogRect,
  edge: PushDialogResizeEdge,
  dx: number,
  dy: number,
  bounds: PushDialogBounds,
): PushDialogRect {
  const start = fitPushDialogRect(initial, bounds);
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

export function loadPushDialogGeometry(
  storage: Pick<Storage, "getItem"> | null | undefined,
  bounds: PushDialogBounds,
): PushDialogRect {
  const raw = storage?.getItem(PUSH_DIALOG_GEOMETRY_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.left === "number" &&
        typeof parsed?.top === "number" &&
        typeof parsed?.width === "number" &&
        typeof parsed?.height === "number"
      ) {
        return fitPushDialogRect(parsed, bounds);
      }
    } catch {
      // Fall back to default on parse errors.
    }
  }
  return defaultPushDialogRect(bounds);
}

export function savePushDialogGeometry(
  storage: Pick<Storage, "setItem"> | null | undefined,
  rect: PushDialogRect,
): void {
  try {
    storage?.setItem(PUSH_DIALOG_GEOMETRY_KEY, JSON.stringify(rect));
  } catch {
    // Ignore storage quota or serialization failures.
  }
}

/** Rebind after each remote-dialog render while retaining and persisting the user's size history. */
export function bindPushDialogResize(
  root: HTMLElement,
  storage?: Pick<Storage, "getItem" | "setItem">,
): void {
  bindings.get(root)?.abort();
  bindings.delete(root);
  const backdrop = root.querySelector<HTMLElement>("#remote-action-dialog");
  const dialog = backdrop?.querySelector<HTMLElement>(".push-dialog");
  if (!backdrop || !dialog) return;
  const controller = new AbortController();
  bindings.set(root, controller);
  const signal = controller.signal;

  const bounds = (): PushDialogBounds => {
    const rect = backdrop.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    return { width, height };
  };

  const measured = (): PushDialogRect => {
    const frame = backdrop.getBoundingClientRect();
    const rect = dialog.getBoundingClientRect();
    return {
      left: rect.left - frame.left,
      top: rect.top - frame.top,
      width: rect.width,
      height: rect.height,
    };
  };

  const apply = (rect: PushDialogRect): void => {
    const next = fitPushDialogRect(rect, bounds());
    geometry.set(root, next);
    dialog.style.position = "absolute";
    dialog.style.left = `${next.left}px`;
    dialog.style.top = `${next.top}px`;
    dialog.style.width = `${next.width}px`;
    dialog.style.height = `${next.height}px`;
  };

  const saved = geometry.get(root) ?? loadPushDialogGeometry(storage, bounds());
  apply(saved);

  let drag: {
    pointerId: number;
    edge: PushDialogResizeEdge;
    x: number;
    y: number;
    rect: PushDialogRect;
  } | null = null;

  backdrop.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const handle = event.target.closest<HTMLElement>("[data-push-dialog-resize]");
    if (!handle || !dialog.contains(handle)) return;
    const edge = handle.dataset.pushDialogResize as PushDialogResizeEdge;
    const rect = fitPushDialogRect(geometry.get(root) ?? measured(), bounds());
    apply(rect);
    drag = { pointerId: event.pointerId, edge, x: event.clientX, y: event.clientY, rect };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, { signal });

  backdrop.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    apply(resizePushDialogRect(drag.rect, drag.edge, event.clientX - drag.x, event.clientY - drag.y, bounds()));
    event.preventDefault();
  }, { signal });

  const finish = (event: PointerEvent): void => {
    if (drag?.pointerId === event.pointerId) {
      drag = null;
      const current = geometry.get(root);
      if (current && storage) savePushDialogGeometry(storage, current);
    }
  };

  backdrop.addEventListener("pointerup", finish, { signal });
  backdrop.addEventListener("pointercancel", finish, { signal });

  backdrop.addEventListener("keydown", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-push-dialog-resize="se"]')) return;
    const step = event.shiftKey ? 48 : 16;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    const current = geometry.get(root) ?? measured();
    const updated = resizePushDialogRect(current, "se", dx, dy, bounds());
    apply(updated);
    if (storage) savePushDialogGeometry(storage, updated);
    event.preventDefault();
  }, { signal });

  window.addEventListener("resize", () => {
    const current = geometry.get(root);
    if (current) apply(current);
  }, { signal });
}
