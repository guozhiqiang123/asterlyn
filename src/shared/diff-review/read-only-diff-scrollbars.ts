import type { EditorView } from "@codemirror/view";
import { linkHorizontalScrollGroup } from "../../presentation/linked-scroll.ts";

/** Owns the grid-aligned horizontal scrollbar proxies used by a read-only split Diff. */
export class ReadOnlyDiffScrollbars {
  private readonly container: HTMLDivElement;
  private readonly panes: readonly [HTMLDivElement, HTMLDivElement];
  private readonly contents: readonly [HTMLDivElement, HTMLDivElement];
  private readonly resizeObserver: ResizeObserver;
  private readonly releaseScrollGroup: () => void;

  constructor(
    parent: HTMLElement,
    private readonly before: EditorView,
    private readonly after: EditorView,
  ) {
    const owner = parent.ownerDocument;
    const beforePane = createPane(owner, "diff-readonly-scrollbar-before");
    const afterPane = createPane(owner, "diff-readonly-scrollbar-after");
    const divider = owner.createElement("div");
    divider.className = "diff-readonly-scrollbar-divider";
    this.container = owner.createElement("div");
    this.container.className = "diff-readonly-scrollbars";
    this.container.setAttribute("aria-hidden", "true");
    this.container.append(beforePane.pane, divider, afterPane.pane);
    parent.append(this.container);
    this.panes = [beforePane.pane, afterPane.pane];
    this.contents = [beforePane.content, afterPane.content];
    this.releaseScrollGroup = linkHorizontalScrollGroup([
      beforePane.pane,
      afterPane.pane,
      before.scrollDOM,
      after.scrollDOM,
    ]);
    this.resizeObserver = new ResizeObserver(() => this.update());
    for (const target of [parent, before.scrollDOM, after.scrollDOM]) {
      this.resizeObserver.observe(target);
    }
    this.update();
  }

  update(): void {
    if (!this.before.scrollDOM.isConnected || !this.after.scrollDOM.isConnected) return;
    const sources = [this.before.scrollDOM, this.after.scrollDOM] as const;
    const visible = sources.some((source) => source.scrollWidth > source.clientWidth);
    this.container.hidden = !visible;
    if (!visible) return;

    for (const [index, source] of sources.entries()) {
      const pane = this.panes[index]!;
      const maximum = Math.max(0, source.scrollWidth - source.clientWidth);
      this.contents[index]!.style.width = `${pane.clientWidth + maximum}px`;
    }
  }

  destroy(): void {
    this.releaseScrollGroup();
    this.resizeObserver.disconnect();
    this.container.remove();
  }
}

function createPane(
  owner: Document,
  suffix: string,
): { pane: HTMLDivElement; content: HTMLDivElement } {
  const pane = owner.createElement("div");
  pane.className = `diff-readonly-scrollbar-pane ${suffix}`;
  const content = owner.createElement("div");
  content.className = "diff-readonly-scrollbar-content";
  pane.append(content);
  return { pane, content };
}
