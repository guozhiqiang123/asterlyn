import { attachSplitter } from "../presentation/splitter.ts";
import { WORKBENCH_LAYOUT_DEFAULTS, WORKBENCH_LIMITS, type WorkbenchLayout } from "./layout-state.ts";
import type { ShellController } from "./shell-controller.ts";

export type WorkbenchResizeDimension = keyof Pick<
  WorkbenchLayout,
  | "leftWidth"
  | "bottomHeight"
  | "branchTreeWidth"
  | "branchDetailsWidth"
  | "stashListWidth"
  | "replacementListWidth"
  | "commitSummaryHeight"
  | "changesCommitHeight"
  | "diffBeforePercent"
>;

export class WorkbenchLayoutRuntime {
  private disposers: Array<() => void> = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly shell: ShellController,
    private readonly requestEditorMeasure: () => void,
  ) {}

  bind(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [
      attachSplitter(this.query("#left-splitter"), {
        orientation: "vertical",
        getValue: () => this.layout.leftWidth,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.sidePaneMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.sidePaneMin,
            this.query("#workbench").clientWidth - WORKBENCH_LIMITS.editorMin - WORKBENCH_LIMITS.separatorSize,
          ),
        }),
        onChange: (value) => this.resize("leftWidth", value),
        onDragStateChange: (dragging) => this.query("#workbench").classList.toggle("resizing-left-tool", dragging),
        onCommit: () => this.persist(),
        onReset: () => this.resize("leftWidth", WORKBENCH_LAYOUT_DEFAULTS.leftWidth),
      }),
      attachSplitter(this.query("#bottom-splitter"), {
        orientation: "horizontal",
        direction: -1,
        getValue: () => this.layout.bottomHeight,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.bottomMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.bottomMin,
            this.query("#workbench").clientHeight - WORKBENCH_LIMITS.editorHeightMin - WORKBENCH_LIMITS.separatorSize,
          ),
        }),
        onChange: (value) => this.resize("bottomHeight", value),
        onCommit: () => this.persist(),
        onReset: () => this.resize("bottomHeight", WORKBENCH_LAYOUT_DEFAULTS.bottomHeight),
      }),
      attachSplitter(this.query("#branch-tree-splitter"), {
        orientation: "vertical",
        getValue: () => this.layout.branchTreeWidth,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.sidePaneMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.sidePaneMin,
            this.query("#git-tool-grid").clientWidth - WORKBENCH_LIMITS.branchCommitMin -
              WORKBENCH_LIMITS.branchDetailsMin - WORKBENCH_LIMITS.separatorSize * 2,
          ),
        }),
        onChange: (value) => this.resize("branchTreeWidth", value),
        onDragStateChange: (dragging) => this.query("#git-tool-grid").classList.toggle("resizing-columns", dragging),
        onCommit: () => this.persist(),
        onReset: () => this.resize("branchTreeWidth", WORKBENCH_LAYOUT_DEFAULTS.branchTreeWidth),
      }),
      attachSplitter(this.query("#branch-details-splitter"), {
        orientation: "vertical",
        direction: -1,
        getValue: () => this.layout.branchDetailsWidth,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.branchDetailsMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.branchDetailsMin,
            this.query("#git-tool-grid").clientWidth - this.layout.branchTreeWidth -
              WORKBENCH_LIMITS.branchCommitMin - WORKBENCH_LIMITS.separatorSize * 2,
          ),
        }),
        onChange: (value) => this.resize("branchDetailsWidth", value),
        onDragStateChange: (dragging) => this.query("#git-tool-grid").classList.toggle("resizing-columns", dragging),
        onCommit: () => this.persist(),
        onReset: () => this.resize("branchDetailsWidth", WORKBENCH_LAYOUT_DEFAULTS.branchDetailsWidth),
      }),
      attachSplitter(this.query("#stash-list-splitter"), {
        orientation: "vertical",
        getValue: () => this.layout.stashListWidth,
        getRange: () => ({
          minimum: WORKBENCH_LIMITS.sidePaneMin,
          maximum: Math.max(
            WORKBENCH_LIMITS.sidePaneMin,
            this.query("#stash-tool-grid").clientWidth - WORKBENCH_LIMITS.stashFilesMin - WORKBENCH_LIMITS.separatorSize,
          ),
        }),
        onChange: (value) => this.resize("stashListWidth", value),
        onCommit: () => this.persist(),
        onReset: () => this.resize("stashListWidth", WORKBENCH_LAYOUT_DEFAULTS.stashListWidth),
      }),
    ];
  }

  resize(dimension: WorkbenchResizeDimension, value: number): void {
    this.shell.reduceLayout({ type: "resize", dimension, value });
    const property = {
      leftWidth: "--left-tool-width",
      bottomHeight: "--bottom-tool-height",
      branchTreeWidth: "--branch-tree-width",
      branchDetailsWidth: "--branch-details-width",
      stashListWidth: "--stash-list-width",
      replacementListWidth: "--replacement-list-width",
      commitSummaryHeight: "--commit-summary-height",
      changesCommitHeight: "--changes-commit-height",
      diffBeforePercent: null,
    }[dimension];
    if (property) this.query("#workbench").style.setProperty(property, `${this.layout[dimension]}px`);
    if (dimension === "leftWidth" || dimension === "bottomHeight" || dimension === "replacementListWidth") {
      this.requestEditorMeasure();
    }
  }

  persist(): void { this.shell.persistLayout(); }

  apply(persist: boolean): void {
    const workbench = this.query("#workbench");
    this.shell.clampLayout(workbench.clientWidth, workbench.clientHeight);
    const sizes: Array<[string, number]> = [
      ["--left-tool-width", this.layout.leftWidth],
      ["--bottom-tool-height", this.layout.bottomHeight],
      ["--branch-tree-width", this.layout.branchTreeWidth],
      ["--branch-details-width", this.layout.branchDetailsWidth],
      ["--stash-list-width", this.layout.stashListWidth],
      ["--replacement-list-width", this.layout.replacementListWidth],
      ["--commit-summary-height", this.layout.commitSummaryHeight],
      ["--changes-commit-height", this.layout.changesCommitHeight],
    ];
    for (const [property, value] of sizes) workbench.style.setProperty(property, `${value}px`);
    workbench.style.setProperty("--workbench-editor-row-min-height", `${WORKBENCH_LIMITS.editorHeightMin}px`);
    const leftOpen = this.layout.leftTool !== null;
    const bottomOpen = this.layout.bottomTool !== null;
    workbench.classList.toggle("left-tool-open", leftOpen);
    workbench.classList.toggle("bottom-tool-open", bottomOpen);
    this.query("#left-tool").toggleAttribute("hidden", !leftOpen);
    this.query("#left-splitter").toggleAttribute("hidden", !leftOpen);
    this.query("#bottom-tool").toggleAttribute("hidden", !bottomOpen);
    this.query("#bottom-splitter").toggleAttribute("hidden", !bottomOpen);
    if (persist) this.persist();
    this.requestEditorMeasure();
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }

  private get layout(): WorkbenchLayout { return this.shell.state.layout; }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workbench element: ${selector}`);
    return element;
  }
}
