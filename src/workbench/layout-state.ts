export type LeftTool = "files" | "changes" | null;
export type BottomTool = "branches" | null;

export interface WorkbenchLayout {
  version: 1;
  leftTool: LeftTool;
  bottomTool: BottomTool;
  leftWidth: number;
  bottomHeight: number;
  branchTreeWidth: number;
  branchDetailsWidth: number;
  commitSummaryHeight: number;
  changesCommitHeight: number;
  diffBeforePercent: number;
}

export type WorkbenchLayoutAction =
  | { type: "toggle-left-tool"; tool: Exclude<LeftTool, null> }
  | { type: "toggle-bottom-tool"; tool: Exclude<BottomTool, null> }
  | {
      type: "resize";
      dimension:
        | "leftWidth"
        | "bottomHeight"
        | "branchTreeWidth"
        | "branchDetailsWidth"
        | "commitSummaryHeight"
        | "changesCommitHeight"
        | "diffBeforePercent";
      value: number;
    }
  | { type: "reset" };

export interface WorkbenchViewport {
  width: number;
  height: number;
}

export const WORKBENCH_LAYOUT_KEY = "asterlyn.workbenchLayout.v1";
export const WORKBENCH_LAYOUT_DEFAULTS: WorkbenchLayout = Object.freeze({
  version: 1,
  leftTool: "files",
  bottomTool: "branches",
  leftWidth: 300,
  bottomHeight: 340,
  branchTreeWidth: 270,
  branchDetailsWidth: 320,
  commitSummaryHeight: 145,
  changesCommitHeight: 230,
  diffBeforePercent: 50,
});

export const WORKBENCH_LIMITS = Object.freeze({
  leftMin: 220,
  editorMin: 380,
  bottomMin: 220,
  editorHeightMin: 210,
  branchTreeMin: 190,
  branchCommitMin: 320,
  branchDetailsMin: 230,
  commitFilesMin: 80,
  commitSummaryMin: 90,
  changesFilesMin: 110,
  changesCommitMin: 145,
  bottomHeaderSize: 30,
  separatorSize: 5,
  diffPercentMin: 25,
  diffPercentMax: 75,
});

interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function reduceWorkbenchLayout(
  layout: WorkbenchLayout,
  action: WorkbenchLayoutAction,
): WorkbenchLayout {
  switch (action.type) {
    case "toggle-left-tool":
      return {
        ...layout,
        leftTool: layout.leftTool === action.tool ? null : action.tool,
      };
    case "toggle-bottom-tool":
      return {
        ...layout,
        bottomTool: layout.bottomTool === action.tool ? null : action.tool,
      };
    case "resize":
      return Number.isFinite(action.value)
        ? { ...layout, [action.dimension]: action.value }
        : layout;
    case "reset":
      return { ...WORKBENCH_LAYOUT_DEFAULTS };
  }
}

export function clampWorkbenchLayout(
  layout: WorkbenchLayout,
  viewport: WorkbenchViewport,
): WorkbenchLayout {
  const width = finiteOr(viewport.width, 0);
  const height = finiteOr(viewport.height, 0);
  const maximumLeft = Math.max(
    WORKBENCH_LIMITS.leftMin,
    width - WORKBENCH_LIMITS.editorMin - WORKBENCH_LIMITS.separatorSize,
  );
  const maximumBottom = Math.max(
    WORKBENCH_LIMITS.bottomMin,
    height - WORKBENCH_LIMITS.editorHeightMin - WORKBENCH_LIMITS.separatorSize,
  );
  const bottomHeight = clamp(
    finiteOr(layout.bottomHeight, WORKBENCH_LAYOUT_DEFAULTS.bottomHeight),
    WORKBENCH_LIMITS.bottomMin,
    maximumBottom,
  );
  const availableBranchWidth = Math.max(
    WORKBENCH_LIMITS.branchTreeMin +
      WORKBENCH_LIMITS.branchCommitMin +
      WORKBENCH_LIMITS.branchDetailsMin +
      WORKBENCH_LIMITS.separatorSize * 2,
    width,
  );
  const maximumTree = Math.max(
    WORKBENCH_LIMITS.branchTreeMin,
    availableBranchWidth -
      WORKBENCH_LIMITS.branchCommitMin -
      WORKBENCH_LIMITS.branchDetailsMin -
      WORKBENCH_LIMITS.separatorSize * 2,
  );
  const branchTreeWidth = clamp(
    finiteOr(layout.branchTreeWidth, WORKBENCH_LAYOUT_DEFAULTS.branchTreeWidth),
    WORKBENCH_LIMITS.branchTreeMin,
    maximumTree,
  );
  const maximumDetails = Math.max(
    WORKBENCH_LIMITS.branchDetailsMin,
    availableBranchWidth -
      branchTreeWidth -
      WORKBENCH_LIMITS.branchCommitMin -
      WORKBENCH_LIMITS.separatorSize * 2,
  );

  return {
    version: 1,
    leftTool: isLeftTool(layout.leftTool) ? layout.leftTool : null,
    bottomTool: isBottomTool(layout.bottomTool) ? layout.bottomTool : null,
    leftWidth: clamp(
      finiteOr(layout.leftWidth, WORKBENCH_LAYOUT_DEFAULTS.leftWidth),
      WORKBENCH_LIMITS.leftMin,
      maximumLeft,
    ),
    bottomHeight,
    branchTreeWidth,
    branchDetailsWidth: clamp(
      finiteOr(
        layout.branchDetailsWidth,
        WORKBENCH_LAYOUT_DEFAULTS.branchDetailsWidth,
      ),
      WORKBENCH_LIMITS.branchDetailsMin,
      maximumDetails,
    ),
    commitSummaryHeight: clamp(
      finiteOr(
        layout.commitSummaryHeight,
        WORKBENCH_LAYOUT_DEFAULTS.commitSummaryHeight,
      ),
      WORKBENCH_LIMITS.commitSummaryMin,
      Math.max(
        WORKBENCH_LIMITS.commitSummaryMin,
        bottomHeight -
          WORKBENCH_LIMITS.bottomHeaderSize -
          WORKBENCH_LIMITS.commitFilesMin -
          WORKBENCH_LIMITS.separatorSize,
      ),
    ),
    changesCommitHeight: clamp(
      finiteOr(
        layout.changesCommitHeight,
        WORKBENCH_LAYOUT_DEFAULTS.changesCommitHeight,
      ),
      WORKBENCH_LIMITS.changesCommitMin,
      Math.max(
        WORKBENCH_LIMITS.changesCommitMin,
        height - WORKBENCH_LIMITS.changesFilesMin - WORKBENCH_LIMITS.separatorSize,
      ),
    ),
    diffBeforePercent: clamp(
      finiteOr(
        layout.diffBeforePercent,
        WORKBENCH_LAYOUT_DEFAULTS.diffBeforePercent,
      ),
      WORKBENCH_LIMITS.diffPercentMin,
      WORKBENCH_LIMITS.diffPercentMax,
    ),
  };
}

export function loadWorkbenchLayout(storage: LayoutStorage): WorkbenchLayout {
  try {
    const encoded = storage.getItem(WORKBENCH_LAYOUT_KEY);
    if (!encoded) return { ...WORKBENCH_LAYOUT_DEFAULTS };
    const candidate = JSON.parse(encoded) as Partial<WorkbenchLayout> | null;
    if (!candidate || candidate.version !== 1) {
      return { ...WORKBENCH_LAYOUT_DEFAULTS };
    }
    return {
      ...WORKBENCH_LAYOUT_DEFAULTS,
      ...candidate,
      version: 1,
      leftTool: isLeftTool(candidate.leftTool)
        ? candidate.leftTool
        : WORKBENCH_LAYOUT_DEFAULTS.leftTool,
      bottomTool: isBottomTool(candidate.bottomTool)
        ? candidate.bottomTool
        : WORKBENCH_LAYOUT_DEFAULTS.bottomTool,
    };
  } catch {
    return { ...WORKBENCH_LAYOUT_DEFAULTS };
  }
}

export function saveWorkbenchLayout(
  storage: LayoutStorage,
  layout: WorkbenchLayout,
): void {
  try {
    storage.setItem(WORKBENCH_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Layout persistence is optional. Storage denial must not break the workbench.
  }
}

function isLeftTool(value: unknown): value is LeftTool {
  return value === null || value === "files" || value === "changes";
}

function isBottomTool(value: unknown): value is BottomTool {
  return value === null || value === "branches";
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
