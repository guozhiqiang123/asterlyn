const VIEWPORT_MARGIN = 4;
const MENU_GAP = 4;
const TYPEAHEAD_RESET_MS = 600;

interface ActiveSelectMenu {
  readonly select: HTMLSelectElement;
  readonly layer: HTMLDivElement;
  readonly menu: HTMLDivElement;
  readonly options: readonly HTMLOptionElement[];
  readonly buttons: readonly HTMLButtonElement[];
  activeIndex: number;
  typeahead: string;
  typeaheadTimer: number | null;
}

export interface ThemedSelectPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

let menuSequence = 0;

/** Replaces the platform popup of shared selects with one theme-owned, window-scoped listbox. */
export class ThemedSelectHost {
  private active: ActiveSelectMenu | null = null;
  private readonly document: Document;
  private readonly window: Window;
  private readonly observer: MutationObserver;
  private disposed = false;

  constructor(document: Document, window: Window) {
    this.document = document;
    this.window = window;
    document.addEventListener("pointerdown", this.handlePointerDown, true);
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("keydown", this.handleKeydown, true);
    document.addEventListener("scroll", this.handleScroll, true);
    window.addEventListener("blur", this.handleWindowBlur);
    window.addEventListener("resize", this.handleResize);
    this.observer = new MutationObserver(() => {
      if (this.active && !this.active.select.isConnected) this.close(false);
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.close(false);
    this.observer.disconnect();
    this.document.removeEventListener("pointerdown", this.handlePointerDown, true);
    this.document.removeEventListener("click", this.handleClick, true);
    this.document.removeEventListener("keydown", this.handleKeydown, true);
    this.document.removeEventListener("scroll", this.handleScroll, true);
    this.window.removeEventListener("blur", this.handleWindowBlur);
    this.window.removeEventListener("resize", this.handleResize);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    const select = this.selectFor(event.target);
    if (select) {
      if (select.disabled) return;
      event.preventDefault();
      select.focus({ preventScroll: true });
      if (this.active?.select === select) this.close(true);
      else this.open(select);
      return;
    }
    if (this.active && !this.active.layer.contains(event.target as Node)) this.close(false);
  };

  private readonly handleClick = (event: MouseEvent): void => {
    if (this.selectFor(event.target)) event.preventDefault();
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    const select = this.selectFor(event.target);
    if (select && !select.disabled && !this.active) {
      if (["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        this.open(select, event.key);
      }
      return;
    }
    const active = this.active;
    if (!active) return;
    if (event.key === "Tab") {
      this.close(false);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const next = themedSelectNextIndex(
        active.options.map((option) => option.disabled),
        active.activeIndex,
        event.key as "ArrowDown" | "ArrowUp" | "Home" | "End",
      );
      this.focus(active, next);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      this.choose(active, active.activeIndex);
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      active.typeahead += event.key.toLocaleLowerCase();
      if (active.typeaheadTimer !== null) this.window.clearTimeout(active.typeaheadTimer);
      active.typeaheadTimer = this.window.setTimeout(() => {
        if (this.active === active) active.typeahead = "";
        active.typeaheadTimer = null;
      }, TYPEAHEAD_RESET_MS);
      const match = themedSelectTypeaheadIndex(
        active.options.map((option) => option.label || option.textContent || ""),
        active.options.map((option) => option.disabled),
        active.activeIndex,
        active.typeahead,
      );
      if (match >= 0) {
        event.preventDefault();
        this.focus(active, match);
      }
    }
  };

  private readonly handleScroll = (event: Event): void => {
    if (this.active && !this.active.layer.contains(event.target as Node)) this.close(false);
  };

  private readonly handleWindowBlur = (): void => this.close(false);
  private readonly handleResize = (): void => this.close(false);

  private selectFor(target: EventTarget | null): HTMLSelectElement | null {
    const select = target instanceof HTMLSelectElement ? target : null;
    return select?.closest(".select-control") ? select : null;
  }

  private open(select: HTMLSelectElement, openingKey = ""): void {
    this.close(false);
    const options = Array.from(select.options).filter((option) => !option.hidden);
    if (options.length === 0) return;
    const layer = this.document.createElement("div");
    layer.className = "themed-select-layer";
    const menu = this.document.createElement("div");
    menu.className = "themed-select-menu";
    menu.id = `themed-select-menu-${++menuSequence}`;
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", select.getAttribute("aria-label") || select.name || select.id);
    const buttons = options.map((option, index) => {
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = `themed-select-option${option.selected ? " selected" : ""}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.selected));
      button.disabled = option.disabled;
      button.dataset.selectOptionIndex = String(index);
      const mark = this.document.createElement("span");
      mark.className = "themed-select-option-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = option.selected ? "✓" : "";
      const label = this.document.createElement("span");
      label.textContent = option.label || option.textContent || "";
      button.append(mark, label);
      button.addEventListener("pointerenter", () => this.focus(this.active, index, false));
      button.addEventListener("click", () => {
        if (this.active?.select === select) this.choose(this.active, index);
      });
      menu.append(button);
      return button;
    });
    layer.append(menu);
    this.document.body.append(layer);
    const selectedIndex = Math.max(0, options.findIndex((option) => option.selected));
    const activeIndex = themedSelectOpeningIndex(
      options.map((option) => option.disabled),
      selectedIndex,
      openingKey,
    );
    const active: ActiveSelectMenu = {
      select,
      layer,
      menu,
      options,
      buttons,
      activeIndex,
      typeahead: "",
      typeaheadTimer: null,
    };
    this.active = active;
    select.setAttribute("aria-expanded", "true");
    select.setAttribute("aria-controls", menu.id);
    const rectangle = select.closest<HTMLElement>(".select-control")?.getBoundingClientRect() ??
      select.getBoundingClientRect();
    const menuRectangle = menu.getBoundingClientRect();
    const placement = themedSelectPlacement(rectangle, menuRectangle.height, {
      width: this.window.innerWidth,
      height: this.window.innerHeight,
    });
    menu.style.left = `${placement.left}px`;
    menu.style.top = `${placement.top}px`;
    menu.style.width = `${placement.width}px`;
    this.focus(active, activeIndex);
  }

  private focus(active: ActiveSelectMenu | null, index: number, moveFocus = true): void {
    if (!active || this.active !== active || index < 0 || index >= active.buttons.length) return;
    active.activeIndex = index;
    active.buttons.forEach((button, buttonIndex) => {
      button.classList.toggle("active", buttonIndex === index);
    });
    const button = active.buttons[index];
    if (moveFocus && button && !button.disabled) {
      button.focus({ preventScroll: true });
      button.scrollIntoView({ block: "nearest" });
    }
  }

  private choose(active: ActiveSelectMenu, index: number): void {
    const option = active.options[index];
    if (!option || option.disabled) return;
    const select = active.select;
    const changed = select.selectedIndex !== option.index;
    select.selectedIndex = option.index;
    this.close(true);
    if (changed && select.isConnected) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  private close(restoreFocus: boolean): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    if (active.typeaheadTimer !== null) this.window.clearTimeout(active.typeaheadTimer);
    active.layer.remove();
    active.select.setAttribute("aria-expanded", "false");
    active.select.removeAttribute("aria-controls");
    if (restoreFocus && active.select.isConnected) active.select.focus({ preventScroll: true });
  }
}

export function themedSelectPlacement(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">,
  menuHeight: number,
  viewport: { width: number; height: number },
): ThemedSelectPlacement {
  const width = Math.min(
    Math.max(anchor.width, 120),
    Math.max(120, viewport.width - VIEWPORT_MARGIN * 2),
  );
  const left = Math.min(
    Math.max(anchor.left, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN),
  );
  const below = anchor.bottom + MENU_GAP;
  const above = anchor.top - menuHeight - MENU_GAP;
  const top = below + menuHeight <= viewport.height - VIEWPORT_MARGIN || above < VIEWPORT_MARGIN
    ? Math.min(below, Math.max(VIEWPORT_MARGIN, viewport.height - menuHeight - VIEWPORT_MARGIN))
    : above;
  return { left, top, width };
}

export function themedSelectNextIndex(
  disabled: readonly boolean[],
  current: number,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
): number {
  const enabled = disabled.map((value, index) => value ? -1 : index).filter((index) => index >= 0);
  if (enabled.length === 0) return -1;
  if (key === "Home") return enabled[0]!;
  if (key === "End") return enabled.at(-1)!;
  const delta = key === "ArrowDown" ? 1 : -1;
  for (let offset = 1; offset <= disabled.length; offset += 1) {
    const index = (current + delta * offset + disabled.length * 2) % disabled.length;
    if (!disabled[index]) return index;
  }
  return -1;
}

export function themedSelectOpeningIndex(
  disabled: readonly boolean[],
  selected: number,
  key: string,
): number {
  if (key === "Home" || key === "End") return themedSelectNextIndex(disabled, selected, key);
  if (!disabled[selected]) return selected;
  return themedSelectNextIndex(disabled, selected, "ArrowDown");
}

export function themedSelectTypeaheadIndex(
  labels: readonly string[],
  disabled: readonly boolean[],
  current: number,
  query: string,
): number {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || labels.length === 0) return -1;
  for (let offset = 1; offset <= labels.length; offset += 1) {
    const index = (Math.max(current, -1) + offset) % labels.length;
    if (!disabled[index] && labels[index]!.trim().toLocaleLowerCase().startsWith(needle)) {
      return index;
    }
  }
  return -1;
}
