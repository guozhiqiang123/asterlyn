import type { ActivityTool } from "./activity-order.ts";
import type { WorkbenchLayout } from "./layout-state.ts";

/** Positive is available, zero disabled, negative hidden. */
export type ActivityAvailability = -1 | 0 | 1;

/** Host-owned activity policy. Plugins never receive layout or DOM authority. */
export function activityToolAvailability(
  tool: ActivityTool,
  workspaceOpen: boolean,
  gitAvailable: boolean,
  tasksAvailable: boolean,
): ActivityAvailability {
  if (tool === "tasks") {
    return workspaceOpen && tasksAvailable ? 1 : -1;
  }
  if (!workspaceOpen) return 0;
  if (tool === "files" || tool === "search" || tool === "terminal") return 1;
  return gitAvailable ? 1 : 0;
}

/** Closes only hidden optional surfaces; disabled core surfaces retain existing layout semantics. */
export function reconcileActivityLayout(
  layout: WorkbenchLayout,
  tasksAvailable: boolean,
): WorkbenchLayout {
  return layout.bottomTool === "tasks" && !tasksAvailable
    ? { ...layout, bottomTool: null }
    : layout;
}
