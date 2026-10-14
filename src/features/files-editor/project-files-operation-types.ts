export interface ProjectFilesOperationMessages {
  readonly invalidName: string;
  readonly unsafeSource: string;
  readonly sourceChanged: string;
  readonly destinationExists: string;
  readonly operationFailed: string;
  readonly clipboardEmpty: string;
  readonly copied: string;
  readonly cut: string;
  readonly created: string;
  readonly stagedCreated: string;
  readonly leftCreatedUntracked: string;
  readonly stageCreatedFailed: string;
  readonly renamed: string;
  readonly pasted: string;
  readonly recoveryTitle: string;
  readonly recoveryDetail: string;
  readonly recoveryClose: string;
  readonly recoveryRollback: string;
  readonly recoveryFinalize: string;
  readonly recoveryAcknowledge: string;
  readonly recoveryWorking: string;
  readonly recoveryResolved: string;
  readonly recoveryFailed: string;
  readonly recoveryDirty: string;
  recoveryCount(count: number): string;
  recoveryPhase(phase: string): string;
  recoveryState(state: "missing" | "matchesReviewed" | "changedOrUnknown"): string;
}
