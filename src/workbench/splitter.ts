export type SplitterOrientation = "horizontal" | "vertical";

export interface SplitterRange {
  minimum: number;
  maximum: number;
}

export interface SplitterOptions {
  orientation: SplitterOrientation;
  direction?: 1 | -1;
  step?: number;
  getValue(): number;
  getRange(): SplitterRange;
  onChange(value: number): void;
  onCommit?(): void;
  onReset?(): void;
}

export function attachSplitter(
  element: HTMLElement,
  options: SplitterOptions,
): () => void {
  const direction = options.direction ?? 1;
  const step = options.step ?? 16;
  let activePointerDispose: (() => void) | null = null;

  element.setAttribute("role", "separator");
  element.setAttribute("aria-orientation", options.orientation);
  element.tabIndex = 0;

  const syncAria = () => {
    const range = normalizeRange(options.getRange());
    element.setAttribute("aria-valuemin", String(Math.round(range.minimum)));
    element.setAttribute("aria-valuemax", String(Math.round(range.maximum)));
    element.setAttribute("aria-valuenow", String(Math.round(options.getValue())));
  };
  const update = (value: number) => {
    const range = normalizeRange(options.getRange());
    options.onChange(resizeValue(value, 0, 1, range));
    syncAria();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activePointerDispose?.();
    activePointerDispose = null;
    const startCoordinate = pointerCoordinate(event, options.orientation);
    const startValue = options.getValue();
    element.classList.add("dragging");
    element.setPointerCapture(event.pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const delta =
        pointerCoordinate(moveEvent, options.orientation) - startCoordinate;
      update(
        resizeValue(startValue, delta, direction, options.getRange()),
      );
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== event.pointerId) return;
      activePointerDispose?.();
      activePointerDispose = null;
      options.onCommit?.();
    };
    activePointerDispose = () => {
      element.classList.remove("dragging");
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", finish);
      element.removeEventListener("pointercancel", finish);
    };
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", finish);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const negativeKey = options.orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const positiveKey = options.orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    const range = normalizeRange(options.getRange());
    let next: number | null = null;
    if (event.key === negativeKey) {
      next = options.getValue() - step * direction;
    } else if (event.key === positiveKey) {
      next = options.getValue() + step * direction;
    } else if (event.key === "Home") {
      next = direction === 1 ? range.minimum : range.maximum;
    } else if (event.key === "End") {
      next = direction === 1 ? range.maximum : range.minimum;
    }
    if (next === null) return;
    event.preventDefault();
    update(next);
    options.onCommit?.();
  };

  const onDoubleClick = () => {
    options.onReset?.();
    syncAria();
    options.onCommit?.();
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("dblclick", onDoubleClick);
  syncAria();

  return () => {
    element.classList.remove("dragging");
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("keydown", onKeyDown);
    element.removeEventListener("dblclick", onDoubleClick);
    activePointerDispose?.();
    activePointerDispose = null;
  };
}

export function resizeValue(
  start: number,
  pointerDelta: number,
  direction: 1 | -1,
  range: SplitterRange,
): number {
  const normalized = normalizeRange(range);
  return Math.min(
    normalized.maximum,
    Math.max(normalized.minimum, start + pointerDelta * direction),
  );
}

function normalizeRange(range: SplitterRange): SplitterRange {
  const minimum = Number.isFinite(range.minimum) ? range.minimum : 0;
  const maximum = Number.isFinite(range.maximum) ? range.maximum : minimum;
  return maximum >= minimum
    ? { minimum, maximum }
    : { minimum: maximum, maximum: minimum };
}

function pointerCoordinate(
  event: PointerEvent,
  orientation: SplitterOrientation,
): number {
  return orientation === "vertical" ? event.clientX : event.clientY;
}
