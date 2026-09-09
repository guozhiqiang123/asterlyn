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
  type Position = { top: number; left: number };
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
    const position = {
      top: Math.min(
        source.scrollTop,
        Math.max(0, target.scrollHeight - target.clientHeight),
      ),
      left: Math.min(
        source.scrollLeft,
        Math.max(0, target.scrollWidth - target.clientWidth),
      ),
    };
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
  return () => {
    first.removeEventListener("scroll", mirrorFirst);
    second.removeEventListener("scroll", mirrorSecond);
  };
}
