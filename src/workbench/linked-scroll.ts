export interface LinkedScrollElement {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
  scrollTo(left: number, top: number): void;
  addEventListener(type: "scroll", listener: () => void): void;
  removeEventListener(type: "scroll", listener: () => void): void;
}

export function linkScrollElements(
  first: LinkedScrollElement,
  second: LinkedScrollElement,
): () => void {
  return linkMappedScrollElements(first, second, absolutePosition, false);
}

export function linkVerticalScrollProportionally(
  first: LinkedScrollElement,
  second: LinkedScrollElement,
): () => void {
  return linkMappedScrollElements(first, second, proportionalVerticalPosition, true);
}

type Position = { top: number; left: number };

function linkMappedScrollElements(
  first: LinkedScrollElement,
  second: LinkedScrollElement,
  mapPosition: (
    source: LinkedScrollElement,
    target: LinkedScrollElement,
  ) => Position,
  synchronizeImmediately: boolean,
): () => void {
  let suppressedFirst: Position | null = null;
  let suppressedSecond: Position | null = null;
  const consumeSuppressed = (
    element: LinkedScrollElement,
    position: Position | null,
    clear: () => void,
  ) => {
    if (!position) return false;
    clear();
    return (
      Math.abs(element.scrollTop - position.top) < 0.5 &&
      Math.abs(element.scrollLeft - position.left) < 0.5
    );
  };
  const mirror = (
    source: LinkedScrollElement,
    target: LinkedScrollElement,
    suppressTarget: (position: Position) => void,
  ) => {
    const position = mapPosition(source, target);
    suppressTarget(position);
    target.scrollTo(position.left, position.top);
  };
  const mirrorFirst = () => {
    if (
      consumeSuppressed(first, suppressedFirst, () => {
        suppressedFirst = null;
      })
    ) {
      return;
    }
    mirror(first, second, (position) => {
      suppressedSecond = position;
    });
  };
  const mirrorSecond = () => {
    if (
      consumeSuppressed(second, suppressedSecond, () => {
        suppressedSecond = null;
      })
    ) {
      return;
    }
    mirror(second, first, (position) => {
      suppressedFirst = position;
    });
  };
  first.addEventListener("scroll", mirrorFirst);
  second.addEventListener("scroll", mirrorSecond);
  if (synchronizeImmediately) mirrorFirst();
  return () => {
    first.removeEventListener("scroll", mirrorFirst);
    second.removeEventListener("scroll", mirrorSecond);
  };
}

function absolutePosition(
  source: LinkedScrollElement,
  target: LinkedScrollElement,
): Position {
  return {
    top: Math.min(
      source.scrollTop,
      Math.max(0, target.scrollHeight - target.clientHeight),
    ),
    left: Math.min(
      source.scrollLeft,
      Math.max(0, target.scrollWidth - target.clientWidth),
    ),
  };
}

function proportionalVerticalPosition(
  source: LinkedScrollElement,
  target: LinkedScrollElement,
): Position {
  const sourceMaximum = Math.max(0, source.scrollHeight - source.clientHeight);
  const targetMaximum = Math.max(0, target.scrollHeight - target.clientHeight);
  const progress = sourceMaximum > 0
    ? Math.min(1, Math.max(0, source.scrollTop / sourceMaximum))
    : 0;
  return {
    top: progress * targetMaximum,
    left: target.scrollLeft,
  };
}
