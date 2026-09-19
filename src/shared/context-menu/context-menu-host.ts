import {
  assertContextMenuModel,
  itemAvailabilityReason,
  type ContextMenuAnchor,
  type ContextMenuItem,
  type ContextMenuPort,
  type ContextMenuSession,
  type ContextMenuSubmenuItem,
} from "./context-menu-model.ts";
import {
  contextMenuEdgeIndex,
  contextMenuTypeaheadIndex,
  initialContextMenuIndex,
  moveContextMenuIndex,
} from "./context-menu-navigation.ts";
import {
  placeContextMenu,
  placeContextSubmenu,
  type ContextMenuRectangle,
} from "./context-menu-position.ts";

interface RenderedMenu {
  readonly element: HTMLElement;
  readonly items: readonly ContextMenuItem[];
  readonly buttons: readonly HTMLButtonElement[];
}

interface ActiveContextMenu {
  readonly session: ContextMenuSession;
  readonly layer: HTMLElement;
  readonly root: RenderedMenu;
  readonly listeners: AbortController;
  submenu: {
    readonly menu: RenderedMenu;
    readonly trigger: HTMLButtonElement;
  } | null;
  typeahead: string;
  typeaheadTimer: number | null;
}

const TYPEAHEAD_RESET_MS = 600;

/** Owns transient context-menu presentation for exactly one browser/native window. */
export class ContextMenuHost implements ContextMenuPort {
  private active: ActiveContextMenu | null = null;
  private disposed = false;

  constructor(
    private readonly document: Document,
    private readonly window: Window,
  ) {}

  get ownerId(): string | null {
    return this.active?.session.ownerId ?? null;
  }

  open(anchor: ContextMenuAnchor, session: ContextMenuSession): void {
    if (this.disposed || !session.isCurrent()) {
      session.dismissed?.();
      return;
    }
    assertContextMenuModel(session.model);
    this.closeActive(undefined, false);

    const listeners = new AbortController();
    const layer = this.document.createElement("div");
    layer.className = "context-menu-layer";
    layer.dataset.contextMenuOwner = session.ownerId;
    const root = this.renderMenu(session.model.items, session.model.ariaLabel, "root");
    layer.append(root.element);
    this.document.body.append(layer);
    const active: ActiveContextMenu = {
      session,
      layer,
      root,
      listeners,
      submenu: null,
      typeahead: "",
      typeaheadTimer: null,
    };
    this.active = active;
    this.bind(active);
    this.positionRoot(root.element, anchor);
    this.focusIndex(root, initialContextMenuIndex(root.items));
  }

  close(ownerId?: string): void {
    this.closeActive(ownerId, true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.closeActive(undefined, false);
  }

  private closeActive(ownerId: string | undefined, restoreFocus: boolean): void {
    const active = this.active;
    if (!active || (ownerId !== undefined && active.session.ownerId !== ownerId)) return;
    this.active = null;
    active.listeners.abort();
    if (active.typeaheadTimer !== null) this.window.clearTimeout(active.typeaheadTimer);
    active.layer.remove();
    try {
      active.session.dismissed?.();
    } catch (error) {
      console.error(error);
    }
    if (!restoreFocus) return;
    try {
      active.session.restoreFocus();
    } catch (error) {
      console.error(error);
    }
  }

  private bind(active: ActiveContextMenu): void {
    const options = { capture: true, signal: active.listeners.signal };
    this.document.addEventListener("pointerdown", (event) => {
      if (this.active !== active || active.layer.contains(event.target as Node)) return;
      this.closeActive(active.session.ownerId, true);
    }, options);
    this.document.addEventListener("keydown", (event) => {
      if (this.active === active) this.handleKeydown(active, event);
    }, options);
    this.document.addEventListener("scroll", (event) => {
      if (this.active !== active || active.layer.contains(event.target as Node)) return;
      this.closeActive(active.session.ownerId, true);
    }, options);
    this.window.addEventListener("blur", () => {
      this.closeActive(active.session.ownerId, false);
    }, { signal: active.listeners.signal });
    this.window.addEventListener("resize", () => {
      this.closeActive(active.session.ownerId, true);
    }, { signal: active.listeners.signal });

    for (const button of active.root.buttons) this.bindButton(active, active.root, button);
  }

  private bindButton(
    active: ActiveContextMenu,
    menu: RenderedMenu,
    button: HTMLButtonElement,
  ): void {
    button.addEventListener("pointerenter", () => {
      if (this.active !== active) return;
      button.focus();
      const item = this.itemForButton(menu, button);
      if (item?.kind === "submenu" && item.availability.kind === "enabled") {
        this.openSubmenu(active, item, button, false);
      } else if (menu === active.root) {
        this.closeSubmenu(active, false);
      }
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.activate(active, menu, button);
    });
  }

  private handleKeydown(active: ActiveContextMenu, event: KeyboardEvent): void {
    const menu = this.menuForFocus(active);
    if (!menu) return;
    const current = menu.buttons.indexOf(this.document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.focusIndex(
        menu,
        moveContextMenuIndex(menu.items, this.itemIndex(menu, current), event.key === "ArrowDown" ? 1 : -1),
      );
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      this.focusIndex(menu, contextMenuEdgeIndex(menu.items, event.key === "Home" ? "first" : "last"));
      return;
    }
    if (event.key === "ArrowRight") {
      const button = menu.buttons[current];
      const item = button ? this.itemForButton(menu, button) : null;
      if (menu === active.root && item?.kind === "submenu") {
        event.preventDefault();
        this.activate(active, menu, button!);
      }
      return;
    }
    if (event.key === "ArrowLeft" && active.submenu) {
      event.preventDefault();
      this.closeSubmenu(active, true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (active.submenu) this.closeSubmenu(active, true);
      else this.closeActive(active.session.ownerId, true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const button = menu.buttons[current];
      if (!button) return;
      event.preventDefault();
      this.activate(active, menu, button);
      return;
    }
    if (
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      active.typeahead += event.key;
      if (active.typeaheadTimer !== null) this.window.clearTimeout(active.typeaheadTimer);
      active.typeaheadTimer = this.window.setTimeout(() => {
        if (this.active === active) active.typeahead = "";
        active.typeaheadTimer = null;
      }, TYPEAHEAD_RESET_MS);
      const target = contextMenuTypeaheadIndex(menu.items, this.itemIndex(menu, current), active.typeahead);
      if (target >= 0) {
        event.preventDefault();
        this.focusIndex(menu, target);
      }
    }
  }

  private activate(
    active: ActiveContextMenu,
    menu: RenderedMenu,
    button: HTMLButtonElement,
  ): void {
    if (this.active !== active) return;
    const item = this.itemForButton(menu, button);
    if (!item || item.kind === "separator") return;
    const reason = itemAvailabilityReason(item);
    if (reason) {
      active.session.blocked(reason);
      return;
    }
    if (item.kind === "submenu") {
      this.openSubmenu(active, item, button, true);
      return;
    }
    if (!active.session.isCurrent()) {
      this.closeActive(active.session.ownerId, true);
      return;
    }
    this.closeActive(active.session.ownerId, true);
    void Promise.resolve(active.session.invoke(item.actionId)).catch(console.error);
  }

  private openSubmenu(
    active: ActiveContextMenu,
    item: ContextMenuSubmenuItem,
    trigger: HTMLButtonElement,
    focusFirst: boolean,
  ): void {
    if (active.submenu?.trigger === trigger) {
      if (focusFirst) this.focusIndex(active.submenu.menu, initialContextMenuIndex(item.children));
      return;
    }
    this.closeSubmenu(active, false);
    const submenu = this.renderMenu(item.children, item.label, "submenu");
    submenu.element.id = `context-submenu-${item.id}`;
    active.layer.append(submenu.element);
    active.submenu = { menu: submenu, trigger };
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", submenu.element.id);
    for (const button of submenu.buttons) this.bindButton(active, submenu, button);
    const rectangle = trigger.getBoundingClientRect();
    const triggerRectangle: ContextMenuRectangle = {
      x: rectangle.left,
      y: rectangle.top,
      width: rectangle.width,
      height: rectangle.height,
    };
    const size = submenu.element.getBoundingClientRect();
    const position = placeContextSubmenu(
      triggerRectangle,
      { width: size.width, height: size.height },
      { width: this.window.innerWidth, height: this.window.innerHeight },
    );
    submenu.element.style.left = `${position.x}px`;
    submenu.element.style.top = `${position.y}px`;
    submenu.element.dataset.opensLeft = String(position.opensLeft);
    if (focusFirst) this.focusIndex(submenu, initialContextMenuIndex(item.children));
  }

  private closeSubmenu(active: ActiveContextMenu, restoreTrigger: boolean): void {
    const submenu = active.submenu;
    if (!submenu) return;
    active.submenu = null;
    submenu.trigger.setAttribute("aria-expanded", "false");
    submenu.trigger.removeAttribute("aria-controls");
    submenu.menu.element.remove();
    if (restoreTrigger) submenu.trigger.focus();
  }

  private renderMenu(
    items: readonly ContextMenuItem[],
    ariaLabel: string,
    level: "root" | "submenu",
  ): RenderedMenu {
    const menu = this.document.createElement("div");
    menu.className = `context-menu context-menu-${level}`;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", ariaLabel);
    menu.dataset.contextMenuLevel = level;
    const buttons: HTMLButtonElement[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      if (item.kind === "separator") {
        const separator = this.document.createElement("div");
        separator.className = "context-menu-separator";
        separator.setAttribute("role", "separator");
        menu.append(separator);
        continue;
      }
      const entry = this.document.createElement("div");
      entry.className = "context-menu-entry";
      entry.setAttribute("role", "presentation");
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = "context-menu-item";
      button.tabIndex = -1;
      button.dataset.contextMenuIndex = String(index);
      button.dataset.availability = item.availability.kind;
      button.setAttribute("role", menuItemRole(item));
      button.setAttribute("aria-disabled", String(item.availability.kind !== "enabled"));
      if (item.availability.kind === "busy") button.setAttribute("aria-busy", "true");
      if (item.kind === "check" || item.kind === "radio") {
        button.setAttribute("aria-checked", String(item.checked));
      }
      if (item.kind === "submenu") {
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
      }
      if (item.kind !== "submenu" && item.tone === "danger") button.dataset.tone = "danger";
      const mark = this.document.createElement("span");
      mark.className = "context-menu-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = checkedMark(item);
      const label = this.document.createElement("span");
      label.className = "context-menu-label";
      label.textContent = item.availability.kind === "busy" ? item.availability.label : item.label;
      const trailing = this.document.createElement("span");
      trailing.className = "context-menu-trailing";
      trailing.setAttribute("aria-hidden", "true");
      trailing.textContent = item.kind === "submenu" ? "›" : item.shortcut ?? "";
      button.append(mark, label, trailing);
      const reason = itemAvailabilityReason(item);
      if (reason && item.availability.kind === "blocked") {
        const reasonElement = this.document.createElement("small");
        reasonElement.className = "context-menu-reason";
        reasonElement.id = `context-menu-reason-${item.id}`;
        reasonElement.textContent = reason;
        button.setAttribute("aria-describedby", reasonElement.id);
        entry.append(button, reasonElement);
      } else {
        entry.append(button);
      }
      buttons.push(button);
      menu.append(entry);
    }
    return { element: menu, items, buttons };
  }

  private positionRoot(menu: HTMLElement, anchor: ContextMenuAnchor): void {
    const rectangle = menu.getBoundingClientRect();
    const position = placeContextMenu(
      anchor,
      { width: rectangle.width, height: rectangle.height },
      { width: this.window.innerWidth, height: this.window.innerHeight },
    );
    menu.style.left = `${position.x}px`;
    menu.style.top = `${position.y}px`;
  }

  private menuForFocus(active: ActiveContextMenu): RenderedMenu | null {
    const focused = this.document.activeElement;
    if (active.submenu?.menu.element.contains(focused)) return active.submenu.menu;
    if (active.root.element.contains(focused)) return active.root;
    return null;
  }

  private focusIndex(menu: RenderedMenu, itemIndex: number): void {
    if (itemIndex < 0) return;
    menu.buttons.find(
      (button) => Number(button.dataset.contextMenuIndex) === itemIndex,
    )?.focus();
  }

  private itemForButton(menu: RenderedMenu, button: HTMLButtonElement): ContextMenuItem | null {
    return menu.items[Number(button.dataset.contextMenuIndex)] ?? null;
  }

  private itemIndex(menu: RenderedMenu, buttonIndex: number): number {
    return Number(menu.buttons[buttonIndex]?.dataset.contextMenuIndex ?? -1);
  }
}

function menuItemRole(item: ContextMenuItem): "menuitem" | "menuitemcheckbox" | "menuitemradio" {
  if (item.kind === "check") return "menuitemcheckbox";
  if (item.kind === "radio") return "menuitemradio";
  return "menuitem";
}

function checkedMark(item: ContextMenuItem): string {
  return (item.kind === "check" || item.kind === "radio") && item.checked ? "✓" : "";
}
