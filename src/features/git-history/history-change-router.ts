import type { HistoryDetailsChange } from "./history-details-controller.ts";

export interface HistoryChangeRoutePort {
  readonly selectedCommit: string | null;
  readonly selectedFile: string | null;
  readonly historyMounted: boolean;
  readonly detailMounted: boolean;
  clearRangeSelection(): void;
  clearCommitInspection(): void;
  updateFileSelection(path: string): void;
  renderHistoryRows(): void;
  renderHistoryStatus(): void;
  updateCommitSelection(key: string): void;
  renderDetail(): void;
  loadVisibleDetails(): void;
  revalidateContextMenu(): void;
  warning(message: string): void;
  error(error: unknown): void;
}

export function routeHistoryDetailsChange(
  change: HistoryDetailsChange,
  port: HistoryChangeRoutePort,
): void {
  if (change.selectionChanged) {
    if (change.reason !== "selection") port.clearRangeSelection();
    port.clearCommitInspection();
  }
  if (change.reason === "file-selection") {
    if (port.selectedFile) port.updateFileSelection(port.selectedFile);
    return;
  }
  if (change.historyChanged && port.historyMounted) port.renderHistoryRows();
  else if (change.statusChanged && port.historyMounted) port.renderHistoryStatus();
  else if (change.selectionChanged && port.selectedCommit) {
    port.updateCommitSelection(port.selectedCommit);
  }
  if ((change.selectionChanged || change.detailsChanged) && port.detailMounted) {
    port.renderDetail();
  }
  if (["snapshot", "query-complete", "refresh-complete"].includes(change.reason)) {
    port.loadVisibleDetails();
  }
  if (change.historyChanged || change.selectionChanged || change.detailsChanged) {
    port.revalidateContextMenu();
  }
  if (change.warning) port.warning(change.warning);
  if (change.error) port.error(change.error);
}
