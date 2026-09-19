import {
  GitHistoryDetailsController,
  type HistoryControllerMessages,
  type HistoryDetailsChange,
  type HistoryDetailsGateway,
} from "./history-details-controller.ts";
import {
  HistoryComparisonController,
  type HistoryComparisonChange,
  type HistoryComparisonGateway,
} from "./history-comparison-controller.ts";
import {
  HistoricalFileController,
  type HistoricalFileGateway,
} from "./historical-file-controller.ts";
import {
  HistoricalFileComparisonController,
  type HistoricalFileComparisonGateway,
} from "./historical-file-comparison-controller.ts";

export interface GitHistoryReadGateways {
  readonly details: HistoryDetailsGateway;
  readonly comparison: HistoryComparisonGateway;
  readonly historicalFile: HistoricalFileGateway;
  readonly historicalFileComparison: HistoricalFileComparisonGateway;
}

export interface GitHistoryReadNotifications {
  detailsChanged(change: HistoryDetailsChange): void;
  comparisonChanged(change: HistoryComparisonChange): void;
  historicalFileChanged(): void;
  historicalFileComparisonChanged(): void;
}

export interface GitHistoryReadOptions {
  readonly rowLimit: number;
  readonly messages: HistoryControllerMessages;
}

/**
 * Owns the construction, subscriptions, and disposal of Git History's read-only
 * controllers. Window composition supplies gateways and notification ports; it
 * does not manage the controllers' individual lifecycles.
 */
export class GitHistoryReadRuntime {
  readonly details: GitHistoryDetailsController;
  readonly comparison: HistoryComparisonController;
  readonly historicalFile: HistoricalFileController;
  readonly historicalFileComparison: HistoricalFileComparisonController;

  private readonly releases: Array<() => void>;
  private disposed = false;

  constructor(
    gateways: GitHistoryReadGateways,
    options: GitHistoryReadOptions,
    notifications: GitHistoryReadNotifications,
  ) {
    this.details = new GitHistoryDetailsController(gateways.details, options);
    this.comparison = new HistoryComparisonController(gateways.comparison);
    this.historicalFile = new HistoricalFileController(gateways.historicalFile);
    this.historicalFileComparison = new HistoricalFileComparisonController(
      gateways.historicalFileComparison,
    );
    this.releases = [
      this.details.subscribe((change) => notifications.detailsChanged(change)),
      this.comparison.subscribe((change) => notifications.comparisonChanged(change)),
      this.historicalFile.subscribe(() => notifications.historicalFileChanged()),
      this.historicalFileComparison.subscribe(() =>
        notifications.historicalFileComparisonChanged()
      ),
    ];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.releases) release();
    this.details.dispose();
    this.comparison.dispose();
    this.historicalFile.dispose();
    this.historicalFileComparison.dispose();
  }
}
