import { icon } from "../../icons.ts";
import type { DiffReviewActionId } from "./diff-review-model.ts";

export type DiffReviewActionIcon =
  | "double-chevron-right"
  | "double-chevron-left"
  | "close"
  | "forward"
  | "revert"
  | "sync";

export interface DiffReviewActionPresentation {
  readonly id: DiffReviewActionId | string;
  readonly label: string;
  readonly title?: string;
  readonly icon?: DiffReviewActionIcon;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function createDiffReviewActionButton(
  presentation: DiffReviewActionPresentation,
  owner: Document = document,
): HTMLButtonElement {
  const button = owner.createElement("button");
  button.type = "button";
  button.className = `diff-change-control diff-review-action ${presentation.className ?? ""}`.trim();
  syncDiffReviewActionButton(button, presentation);
  return button;
}

export function syncDiffReviewActionButton(
  button: HTMLButtonElement,
  presentation: DiffReviewActionPresentation,
): void {
  const title = presentation.title ?? presentation.label;
  const iconName = presentation.icon ?? "";
  if (button.dataset.controlIcon !== iconName || button.dataset.controlLabel !== presentation.label) {
    if (presentation.icon) button.innerHTML = icon(presentation.icon, 15);
    else button.textContent = presentation.label;
    button.dataset.controlIcon = iconName;
    button.dataset.controlLabel = presentation.label;
  }
  button.dataset.reviewAction = presentation.id;
  if (button.title !== title) button.title = title;
  if (button.getAttribute("aria-label") !== title) button.setAttribute("aria-label", title);
  const selected = presentation.selected === true;
  button.classList.toggle("is-selected", selected);
  button.setAttribute("aria-pressed", String(selected));
  if (button.disabled !== (presentation.disabled === true)) button.disabled = presentation.disabled === true;
}

export function createDiffReviewActionGroup(
  side: string,
  label: string,
  actions: readonly DiffReviewActionPresentation[],
  owner: Document = document,
): HTMLDivElement {
  const group = owner.createElement("div");
  group.className = "diff-review-action-group conflict-change-controls";
  group.dataset.side = side;
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  for (const action of actions) group.append(createDiffReviewActionButton(action, owner));
  return group;
}
