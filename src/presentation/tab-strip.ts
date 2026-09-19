export interface HorizontalScrollTarget {
  clientWidth: number;
  scrollLeft: number;
  scrollWidth: number;
}

export interface HorizontalTabBounds {
  offsetLeft: number;
  offsetWidth: number;
}

export function scrollTabStrip(
  target: HorizontalScrollTarget,
  deltaX: number,
  deltaY: number,
): boolean {
  const maxScroll = Math.max(0, target.scrollWidth - target.clientWidth);
  if (maxScroll === 0) return false;
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  if (!Number.isFinite(delta) || delta === 0) return false;
  const next = Math.min(maxScroll, Math.max(0, target.scrollLeft + delta));
  if (next === target.scrollLeft) return false;
  target.scrollLeft = next;
  return true;
}

export function revealTabInStrip(
  target: HorizontalScrollTarget,
  tab: HorizontalTabBounds,
  padding = 4,
): boolean {
  const maxScroll = Math.max(0, target.scrollWidth - target.clientWidth);
  const safePadding = Math.max(0, padding);
  const visibleLeft = target.scrollLeft;
  const visibleRight = visibleLeft + target.clientWidth;
  const tabLeft = tab.offsetLeft;
  const tabRight = tab.offsetLeft + tab.offsetWidth;
  let next = visibleLeft;
  if (tabLeft - safePadding < visibleLeft) {
    next = tabLeft - safePadding;
  } else if (tabRight + safePadding > visibleRight) {
    next = tabRight + safePadding - target.clientWidth;
  }
  next = Math.min(maxScroll, Math.max(0, next));
  if (next === target.scrollLeft) return false;
  target.scrollLeft = next;
  return true;
}
