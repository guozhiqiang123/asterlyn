import type { DiffSideLabels } from "../../diff-presentation.ts";

export function createDiffSideLabels(
  labels: DiffSideLabels,
  owner: Document = document,
): HTMLElement {
  const header = owner.createElement("header");
  header.className = "diff-side-labels";
  const before = owner.createElement("strong");
  before.textContent = labels.before;
  const divider = owner.createElement("span");
  divider.setAttribute("aria-hidden", "true");
  const after = owner.createElement("strong");
  after.textContent = labels.after;
  header.append(before, divider, after);
  return header;
}

export function createDiffUnifiedLabel(
  labels: DiffSideLabels,
  owner: Document = document,
): HTMLElement {
  const header = owner.createElement("header");
  header.className = "diff-unified-label";
  header.textContent = unifiedLabel(labels);
  return header;
}

export function syncDiffSideLabels(
  parent: HTMLElement | null,
  labels: DiffSideLabels,
): void {
  const sides = parent?.querySelectorAll<HTMLElement>(".diff-side-labels strong");
  if (sides?.[0]) sides[0].textContent = labels.before;
  if (sides?.[1]) sides[1].textContent = labels.after;
  const unified = parent?.querySelector<HTMLElement>(".diff-unified-label");
  if (unified) unified.textContent = unifiedLabel(labels);
}

export function createReadOnlyDiffPane(
  parent: HTMLElement,
  label: string,
  side: "old" | "new",
  owner: Document = document,
): HTMLElement {
  const pane = owner.createElement("section");
  pane.className = `diff-pane diff-pane-${side}`;
  pane.setAttribute("aria-label", label);
  const host = owner.createElement("div");
  host.className = "diff-editor-host";
  pane.append(host);
  parent.append(pane);
  return host;
}

function unifiedLabel(labels: DiffSideLabels): string {
  return `${labels.before} → ${labels.after}`;
}
