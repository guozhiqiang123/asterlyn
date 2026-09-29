import type { DiffSideLabels } from "../../diff-presentation.ts";

export function createDiffSideLabels(
  labels: DiffSideLabels,
  owner: Document = document,
): HTMLElement {
  const header = owner.createElement("header");
  header.className = "diff-side-labels";
  const before = owner.createElement("strong");
  setDiffSideLabel(before, labels.before);
  const divider = owner.createElement("span");
  divider.setAttribute("aria-hidden", "true");
  const after = owner.createElement("strong");
  setDiffSideLabel(after, labels.after);
  header.append(before, divider, after);
  return header;
}

export function createDiffUnifiedLabel(
  labels: DiffSideLabels,
  owner: Document = document,
): HTMLElement {
  const header = owner.createElement("header");
  header.className = "diff-unified-label";
  setUnifiedDiffSideLabel(header, labels);
  return header;
}

export function syncDiffSideLabels(
  parent: HTMLElement | null,
  labels: DiffSideLabels,
): void {
  const sides = parent?.querySelectorAll<HTMLElement>(".diff-side-labels strong");
  if (sides?.[0]) setDiffSideLabel(sides[0], labels.before);
  if (sides?.[1]) setDiffSideLabel(sides[1], labels.after);
  const unified = parent?.querySelector<HTMLElement>(".diff-unified-label");
  if (unified) setUnifiedDiffSideLabel(unified, labels);
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

export function diffSideLabelParts(label: string): {
  prefix: string;
  revision: string | null;
} {
  const match = /^(.*?)([0-9a-f]{7,40})$/iu.exec(label);
  return match
    ? { prefix: match[1] ?? "", revision: (match[2] ?? "").toLowerCase() }
    : { prefix: label, revision: null };
}

function setDiffSideLabel(target: HTMLElement, label: string): void {
  target.replaceChildren();
  appendDiffSideLabel(target, label);
}

function setUnifiedDiffSideLabel(target: HTMLElement, labels: DiffSideLabels): void {
  target.replaceChildren();
  appendDiffSideLabel(target, labels.before);
  target.append(target.ownerDocument.createTextNode(" → "));
  appendDiffSideLabel(target, labels.after);
}

function appendDiffSideLabel(target: HTMLElement, label: string): void {
  const parts = diffSideLabelParts(label);
  target.append(target.ownerDocument.createTextNode(parts.prefix));
  if (parts.revision === null) return;
  const revision = target.ownerDocument.createElement("span");
  revision.className = "diff-side-revision";
  revision.textContent = parts.revision;
  target.append(revision);
}
