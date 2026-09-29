const OVERVIEW_SURFACE_CLASS = "cm-change-overview-surface";
const OVERVIEW_FOOTER_CLASS = "cm-change-overview-footer-clearance";

export function attachOverviewRuler(
  target: HTMLElement,
  ruler: HTMLDivElement,
  footerScrollbar: boolean,
): void {
  const previous = ruler.parentElement;
  ruler.toggleAttribute("data-footer-scrollbar", footerScrollbar);
  if (previous !== target) {
    ruler.remove();
    syncOverviewSurface(previous);
    target.append(ruler);
  }
  syncOverviewSurface(target);
}

export function removeOverviewRuler(ruler: HTMLDivElement | null): void {
  const parent = ruler?.parentElement ?? null;
  ruler?.remove();
  syncOverviewSurface(parent);
}

function syncOverviewSurface(target: HTMLElement | null): void {
  if (!target) return;
  const rulers = [...target.children].filter((child) =>
    child.classList.contains("cm-change-overview-ruler")
  );
  target.classList.toggle(OVERVIEW_SURFACE_CLASS, rulers.length > 0);
  target.classList.toggle(
    OVERVIEW_FOOTER_CLASS,
    rulers.some((ruler) => ruler.hasAttribute("data-footer-scrollbar")),
  );
}
