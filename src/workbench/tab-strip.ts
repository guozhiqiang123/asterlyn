export interface HorizontalScrollTarget {
  clientWidth: number;
  scrollLeft: number;
  scrollWidth: number;
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
