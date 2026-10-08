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

export interface DocumentScrollBlock {
  readonly from: number;
  readonly to: number;
  readonly top: number;
  readonly height: number;
}

export interface DocumentScrollView {
  readonly contentHeight: number;
  lineBlockAtHeight(height: number): DocumentScrollBlock;
  lineBlockAt(position: number): DocumentScrollBlock;
}

export function linkScrollElements(
  first: LinkedScrollElement,
  second: LinkedScrollElement,
  scheduler: ScrollFrameScheduler = defaultScrollFrameScheduler(),
): () => void {
  return linkMappedScrollElements(first, second, absolutePosition, false, scheduler);
}

/** Mirrors only the vertical offset and leaves each element's horizontal owner untouched. */
export function linkVerticalScroll(
  first: LinkedScrollElement,
  second: LinkedScrollElement,
  scheduler: ScrollFrameScheduler = defaultScrollFrameScheduler(),
): () => void {
  return linkMappedScrollElements(first, second, verticalPosition, true, scheduler);
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

/**
 * Links two independently decorated views through positions in the same document. This is used by
 * the conflict editor's duplicated Result view: pair-specific spacer widgets may give the two
 * MergeViews different pixel heights, but an identical Result position remains the stable anchor.
 */
export function linkVerticalScrollByDocument(
  first: LinkedScrollElement,
  second: LinkedScrollElement,
  firstDocument: DocumentScrollView,
  secondDocument: DocumentScrollView,
  scheduler: ScrollFrameScheduler = defaultScrollFrameScheduler(),
): () => void {
  return linkMappedScrollElements(
    first,
    second,
    (source, target) => documentVerticalPosition(
      source,
      target,
      source === first ? firstDocument : secondDocument,
      source === first ? secondDocument : firstDocument,
    ),
    true,
    scheduler,
    "immediate",
  );
}

/**
 * Mirrors horizontal offsets while leaving vertical offsets to whatever owns them. Merged Diff panes
 * share one vertical scroller but keep two independent horizontal ones, so only `scrollLeft` is
 * linked here.
 */
export function linkHorizontalScroll(
  first: LinkedScrollElement,
  second: LinkedScrollElement,
  scheduler: ScrollFrameScheduler = defaultScrollFrameScheduler(),
): () => void {
  return linkMappedScrollElements(first, second, horizontalPosition, true, scheduler);
}

/**
 * Coordinates an arbitrary set of horizontal scrollers through one frame-scheduled source. Using
 * one owner avoids the feedback loops and multi-frame latency produced by chaining pairwise links.
 * Unequal scroll ranges are mapped by progress so every visible scrollbar has the same position.
 */
export function linkHorizontalScrollGroup(
  elements: readonly LinkedScrollElement[],
  scheduler: ScrollFrameScheduler = defaultScrollFrameScheduler(),
): () => void {
  const members = [...new Set(elements)];
  if (members.length < 2) return () => undefined;
  const expected = new Map<LinkedScrollElement, number>();
  const listeners = new Map<LinkedScrollElement, () => void>();
  let pendingSource: LinkedScrollElement | null = null;
  let frameHandle = 0;
  let framePending = false;
  let disposed = false;

  const flush = () => {
    framePending = false;
    frameHandle = 0;
    const source = pendingSource;
    pendingSource = null;
    if (disposed || !source) return;
    const sourceMaximum = horizontalMaximum(source);
    const progress = sourceMaximum > 0
      ? Math.min(1, Math.max(0, source.scrollLeft / sourceMaximum))
      : 0;
    for (const target of members) {
      if (target === source) continue;
      const left = progress * horizontalMaximum(target);
      if (Math.abs(target.scrollLeft - left) < 0.5) continue;
      expected.set(target, left);
      target.scrollTo(left, target.scrollTop);
    }
  };
  const queue = (source: LinkedScrollElement) => {
    const anticipated = expected.get(source);
    if (anticipated !== undefined && Math.abs(source.scrollLeft - anticipated) < 0.5) {
      expected.delete(source);
      return;
    }
    expected.delete(source);
    pendingSource = source;
    if (framePending) return;
    framePending = true;
    frameHandle = scheduler.request(flush);
  };
  for (const member of members) {
    const listener = () => queue(member);
    listeners.set(member, listener);
    member.addEventListener("scroll", listener);
  }
  queue(members[0]!);
  return () => {
    disposed = true;
    pendingSource = null;
    expected.clear();
    if (framePending) scheduler.cancel(frameHandle);
    framePending = false;
    for (const [member, listener] of listeners) member.removeEventListener("scroll", listener);
  };
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
  scrollTiming: "frame" | "immediate" = "frame",
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
    if (scrollTiming === "immediate") {
      mirror(source, target, targetName);
      return;
    }
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

function documentVerticalPosition(
  source: LinkedScrollElement,
  target: LinkedScrollElement,
  sourceDocument: DocumentScrollView,
  targetDocument: DocumentScrollView,
): Position {
  const sourceHeight = Math.min(source.scrollTop, Math.max(0, sourceDocument.contentHeight - 1));
  const sourceBlock = sourceDocument.lineBlockAtHeight(sourceHeight);
  const targetBlock = targetDocument.lineBlockAt(sourceBlock.from);
  const progress = sourceBlock.height > 0
    ? Math.min(1, Math.max(0, (sourceHeight - sourceBlock.top) / sourceBlock.height))
    : 0;
  const mappedTop = targetBlock.top + progress * targetBlock.height;
  return {
    top: Math.min(mappedTop, Math.max(0, target.scrollHeight - target.clientHeight)),
    left: target.scrollLeft,
  };
}

function verticalPosition(
  source: LinkedScrollElement,
  target: LinkedScrollElement,
): Position {
  return {
    top: Math.min(source.scrollTop, Math.max(0, target.scrollHeight - target.clientHeight)),
    left: target.scrollLeft,
  };
}

function horizontalPosition(
  source: LinkedScrollElement,
  target: LinkedScrollElement,
): Position {
  return {
    top: target.scrollTop,
    left: Math.min(
      source.scrollLeft,
      Math.max(0, target.scrollWidth - target.clientWidth),
    ),
  };
}

function horizontalMaximum(element: LinkedScrollElement): number {
  return Math.max(0, element.scrollWidth - element.clientWidth);
}
