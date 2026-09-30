import type { CommandAvailability } from "../../application/commands/command-service.ts";
import type { RemoteCommandAction } from "../../application/commands/remote-command-ids.ts";
import type { RemoteCopy } from "../../localization/catalog.ts";
import type { RepositorySnapshot } from "../../models.ts";
import { buildCommitFileTree, commitFileDirectoryPaths } from "../../presentation/git-presentation.ts";
import type { RemoteManagementController } from "./remote-management-controller.ts";
import type { RemotePushController } from "./remote-push-controller.ts";

export interface RemoteCommandPorts {
  readonly snapshot: () => RepositorySnapshot | null;
  readonly busy: () => boolean;
  readonly copy: () => RemoteCopy;
  readonly actionBlockedReason: (kind: "pull" | "push") => string | null;
  readonly openAction: (kind: "pull" | "push") => void | Promise<void>;
  readonly cancelOperation: () => void | Promise<void>;
  readonly selectedProjectFileAvailable: () => boolean;
  readonly openSelectedProjectFile: () => void | Promise<void>;
}

export class RemoteCommandAdapter {
  private readonly push: RemotePushController;
  private readonly management: RemoteManagementController | null;
  private readonly ports: RemoteCommandPorts;

  constructor(
    push: RemotePushController,
    management: RemoteManagementController | null,
    ports: RemoteCommandPorts,
  ) {
    this.push = push;
    this.management = management;
    this.ports = ports;
  }

  commandAvailability(action: RemoteCommandAction): CommandAvailability {
    const copy = this.ports.copy();
    if (action === "open-update" || action === "open-push") {
      const reason = this.ports.actionBlockedReason(action === "open-update" ? "pull" : "push");
      return reason ? { enabled: false, reason } : { enabled: true };
    }
    if (action === "manage") {
      if (!this.ports.snapshot() || !this.management) return { enabled: false, reason: copy.selectionUnavailable };
      if (this.ports.busy()) return { enabled: false, reason: copy.unavailable(copy.workbenchBusy) };
      if (this.push.state.operation) return { enabled: false, reason: copy.unavailable(copy.operationInProgress(copy.actionNames[this.push.state.operation.kind])) };
      return { enabled: true };
    }
    if (action === "cancel-operation") {
      const operation = this.push.state.operation;
      return operation && !operation.background && !operation.cancelling
        ? { enabled: true }
        : { enabled: false, reason: copy.cancelRemoteOperation };
    }
    if (this.push.state.dialog !== "push" || !this.push.state.pushPreview) {
      return { enabled: false, reason: copy.pushPreviewUnavailable };
    }
    if (action === "load-more") {
      return this.push.state.pushPreview.hasMore && !this.push.state.pushPreviewLoadingMore
        ? { enabled: true }
        : { enabled: false, reason: copy.showMore };
    }
    if (action === "toggle-file-view") return { enabled: true };
    if (action === "expand-folders" || action === "collapse-folders") {
      return this.push.state.pushFileView === "tree" && this.push.pushReviewFiles().length > 0
        ? { enabled: true }
        : { enabled: false, reason: copy.pushedFileToolbar };
    }
    const selected = this.push.state.pushSelectedFile;
    if (!selected || !this.push.pushReviewFiles().some((file) => file.path === selected)) {
      return { enabled: false, reason: copy.selectedOutgoingFileMissing };
    }
    if (action === "open-current-file" && !this.ports.selectedProjectFileAvailable()) {
      return { enabled: false, reason: copy.selectedOutgoingFileMissing };
    }
    return action === "open-file-diff" && this.push.state.pushFileActionLoading
      ? { enabled: false, reason: copy.loadingPushedDiff }
      : { enabled: true };
  }

  async executeCommand(action: RemoteCommandAction): Promise<void> {
    if (!this.commandAvailability(action).enabled) return;
    switch (action) {
      case "open-update": return void await this.ports.openAction("pull");
      case "open-push": return void await this.ports.openAction("push");
      case "cancel-operation": return void await this.ports.cancelOperation();
      case "manage": return void this.management?.open();
      case "open-file-diff": return void await this.push.openSelectedPushFileDiff();
      case "open-current-file": return void await this.ports.openSelectedProjectFile();
      case "toggle-file-view": return this.push.togglePushFileView();
      case "expand-folders": return this.push.expandPushDirectories();
      case "collapse-folders":
        return this.push.collapsePushDirectories([
          ".", ...commitFileDirectoryPaths(buildCommitFileTree(this.push.pushReviewFiles())),
        ]);
      case "load-more": return void await this.push.loadMorePushPreview();
    }
  }
}
