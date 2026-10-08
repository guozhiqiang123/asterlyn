export interface DiffReviewPaneHeaderItem {
  readonly id: string;
  readonly label: string;
  readonly count?: number | null;
  readonly writable?: boolean;
  readonly writableLabel?: string | null;
}

export function createDiffReviewPaneHeaders(
  panes: readonly DiffReviewPaneHeaderItem[],
  options: {
    readonly className?: string;
    readonly actionGutters?: boolean;
    readonly owner?: Document;
  } = {},
): HTMLElement {
  const owner = options.owner ?? document;
  const header = owner.createElement("header");
  header.className = `diff-review-pane-headers ${options.className ?? ""}`.trim();
  panes.forEach((pane, index) => {
    const item = owner.createElement("strong");
    item.dataset.paneId = pane.id;
    item.dataset.writable = String(pane.writable === true);
    item.setAttribute("aria-label", pane.writableLabel ? `${pane.label} · ${pane.writableLabel}` : pane.label);
    appendPaneLabel(item, pane.label);
    if (pane.writableLabel) {
      const state = owner.createElement("small");
      state.className = "diff-review-pane-state";
      state.textContent = pane.writableLabel;
      item.append(state);
    } else if (pane.count !== undefined && pane.count !== null) {
      const count = owner.createElement("small");
      count.className = "diff-review-pane-count";
      count.textContent = String(pane.count);
      item.append(count);
    }
    header.append(item);
    if (options.actionGutters && index < panes.length - 1) {
      const gutter = owner.createElement("span");
      gutter.className = "diff-review-pane-gutter";
      gutter.setAttribute("aria-hidden", "true");
      header.append(gutter);
    }
  });
  return header;
}

export function syncDiffReviewPaneHeaders(
  header: HTMLElement | null,
  panes: readonly DiffReviewPaneHeaderItem[],
): void {
  if (!header) return;
  for (const pane of panes) {
    const target = header.querySelector<HTMLElement>(`[data-pane-id="${pane.id}"]`);
    if (!target) continue;
    target.replaceChildren();
    target.dataset.writable = String(pane.writable === true);
    target.setAttribute("aria-label", pane.writableLabel ? `${pane.label} · ${pane.writableLabel}` : pane.label);
    appendPaneLabel(target, pane.label);
    if (pane.writableLabel) {
      const state = target.ownerDocument.createElement("small");
      state.className = "diff-review-pane-state";
      state.textContent = pane.writableLabel;
      target.append(state);
    } else if (pane.count !== undefined && pane.count !== null) {
      const count = target.ownerDocument.createElement("small");
      count.className = "diff-review-pane-count";
      count.textContent = String(pane.count);
      target.append(count);
    }
  }
}

export function diffReviewPaneLabelParts(label: string): {
  prefix: string;
  revision: string | null;
} {
  const match = /^(.*?)([0-9a-f]{7,40})$/iu.exec(label);
  return match
    ? { prefix: match[1] ?? "", revision: (match[2] ?? "").toLowerCase() }
    : { prefix: label, revision: null };
}

function appendPaneLabel(target: HTMLElement, label: string): void {
  const labelNode = target.ownerDocument.createElement("span");
  labelNode.className = "diff-review-pane-label";
  const parts = diffReviewPaneLabelParts(label);
  labelNode.append(target.ownerDocument.createTextNode(parts.prefix));
  if (parts.revision !== null) {
    const revision = target.ownerDocument.createElement("span");
    revision.className = "diff-side-revision";
    revision.textContent = parts.revision;
    labelNode.append(revision);
  }
  target.append(labelNode);
}

