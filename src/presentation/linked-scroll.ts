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

export interface ScrollFrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export function linkScrollElements(
  first: LinkedScrollElement,
  second: LinkedScrollElement,
  scheduler: ScrollFrameScheduler = defaultScrollFrameScheduler(),
): () => void {
  return linkMappedScrollElements(first, second, absolutePosition, false, scheduler);
}

export function linkVerticalScrollProportionally(
  first: LinkedScrollElement,
  second: LinkedScrollElement,
  scheduler: ScrollFrameScheduler = defaultScrollFrameScheduler(),
): () => void {
  return linkMappedScrollElements(
    first,
    second,
    proportionalVerticalPosition,
    true,
    scheduler,
  );
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
  scheduler: ScrollFrameScheduler,
): () => void {
  let suppressedFirst: Position | null = null;
  let suppressedSecond: Position | null = null;
  let pending: {
    source: LinkedScrollElement;
    target: LinkedScrollElement;
    targetName: "first" | "second";
  } | null = null;
  let framePending = false;
  let frameHandle = 0;
  let disposed = false;
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
    targetName: "first" | "second",
  ) => {
    const position = mapPosition(source, target);
    if (
      Math.abs(target.scrollTop - position.top) < 0.5 &&
      Math.abs(target.scrollLeft - position.left) < 0.5
    ) {
      return;
    }
    if (targetName === "first") suppressedFirst = position;
    else suppressedSecond = position;
    target.scrollTo(position.left, position.top);
  };
  const flush = () => {
    framePending = false;
    frameHandle = 0;
    const next = pending;
    pending = null;
    if (!disposed && next) mirror(next.source, next.target, next.targetName);
  };
  const queueMirror = (
    source: LinkedScrollElement,
    target: LinkedScrollElement,
    targetName: "first" | "second",
  ) => {
    pending = { source, target, targetName };
    if (framePending) return;
    framePending = true;
    frameHandle = scheduler.request(flush);
  };
  const mirrorFirst = () => {
    if (
      consumeSuppressed(first, suppressedFirst, () => {
        suppressedFirst = null;
      })
    ) {
      return;
    }
    suppressedFirst = null;
    queueMirror(first, second, "second");
  };
  const mirrorSecond = () => {
    if (
      consumeSuppressed(second, suppressedSecond, () => {
        suppressedSecond = null;
      })
    ) {
      return;
    }
    suppressedSecond = null;
    queueMirror(second, first, "first");
  };
  first.addEventListener("scroll", mirrorFirst);
  second.addEventListener("scroll", mirrorSecond);
  if (synchronizeImmediately) mirror(first, second, "second");
  return () => {
    disposed = true;
    pending = null;
    if (framePending) scheduler.cancel(frameHandle);
    framePending = false;
    first.removeEventListener("scroll", mirrorFirst);
    second.removeEventListener("scroll", mirrorSecond);
  };
}

function defaultScrollFrameScheduler(): ScrollFrameScheduler {
  if (typeof window !== "undefined") {
    return {
      request: (callback) => window.requestAnimationFrame(callback),
      cancel: (handle) => window.cancelAnimationFrame(handle),
    };
  }
  return {
    request: (callback) => {
      callback();
      return 0;
    },
    cancel: () => undefined,
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
