export type ContextMenuAvailability =
  | { readonly kind: "enabled" }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "busy"; readonly label: string };

interface ContextMenuActionBase {
  readonly id: string;
  readonly actionId: string;
  readonly label: string;
  readonly availability: ContextMenuAvailability;
  readonly shortcut?: string;
  readonly tone?: "normal" | "danger";
}

export type ContextMenuActionItem =
  | (ContextMenuActionBase & { readonly kind: "command" })
  | (ContextMenuActionBase & {
      readonly kind: "check" | "radio";
      readonly checked: boolean;
    });

export interface ContextMenuSubmenuItem {
  readonly kind: "submenu";
  readonly id: string;
  readonly label: string;
  readonly availability: ContextMenuAvailability;
  readonly children: readonly ContextMenuActionItem[];
}

export interface ContextMenuSeparator {
  readonly kind: "separator";
}

export type ContextMenuItem =
  | ContextMenuActionItem
  | ContextMenuSubmenuItem
  | ContextMenuSeparator;

export interface ContextMenuModel {
  readonly ariaLabel: string;
  readonly items: readonly ContextMenuItem[];
}

export interface ContextMenuAnchor {
  readonly x: number;
  readonly y: number;
}

export interface ContextMenuSession {
  readonly ownerId: string;
  readonly model: ContextMenuModel;
  isCurrent(): boolean;
  invoke(actionId: string): void | Promise<void>;
  blocked(reason: string): void;
  dismissed?(): void;
  restoreFocus(): void;
}

export interface ContextMenuPort {
  open(anchor: ContextMenuAnchor, session: ContextMenuSession): void;
  close(ownerId?: string): void;
  revalidate(): void;
}

export function contextMenuModelErrors(model: ContextMenuModel): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  if (!model.ariaLabel.trim()) errors.push("ariaLabel is required");
  validateGroup(model.items, "root", ids, errors, true);
  return errors;
}

export function assertContextMenuModel(model: ContextMenuModel): void {
  const errors = contextMenuModelErrors(model);
  if (errors.length > 0) {
    throw new Error(`Invalid context menu model: ${errors.join("; ")}`);
  }
}

export function itemAvailabilityReason(item: ContextMenuItem): string | null {
  if (item.kind === "separator" || item.availability.kind === "enabled") return null;
  return item.availability.kind === "busy"
    ? item.availability.label
    : item.availability.reason;
}

function validateGroup(
  items: readonly ContextMenuItem[],
  location: string,
  ids: Set<string>,
  errors: string[],
  allowSubmenus: boolean,
): void {
  if (items.length === 0) errors.push(`${location} menu is empty`);
  if (items[0]?.kind === "separator" || items.at(-1)?.kind === "separator") {
    errors.push(`${location} menu has a leading or trailing separator`);
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.kind === "separator") {
      if (items[index - 1]?.kind === "separator") {
        errors.push(`${location} menu has adjacent separators`);
      }
      continue;
    }
    if (!item.id.trim()) errors.push(`${location} item ${index} has no id`);
    else if (ids.has(item.id)) errors.push(`duplicate item id ${item.id}`);
    else ids.add(item.id);
    if (!item.label.trim()) errors.push(`${location} item ${item.id || index} has no label`);
    validateAvailability(item.availability, `${location} item ${item.id || index}`, errors);
    if (item.kind === "submenu") {
      if (!allowSubmenus) errors.push(`submenu ${item.id} exceeds the one-level limit`);
      validateGroup(item.children, `submenu ${item.id}`, ids, errors, false);
    } else if (!item.actionId.trim()) {
      errors.push(`${location} item ${item.id || index} has no actionId`);
    }
  }
}

function validateAvailability(
  availability: ContextMenuAvailability,
  location: string,
  errors: string[],
): void {
  if (availability.kind === "blocked" && !availability.reason.trim()) {
    errors.push(`${location} has an empty blocked reason`);
  }
  if (availability.kind === "busy" && !availability.label.trim()) {
    errors.push(`${location} has an empty busy label`);
  }
}
