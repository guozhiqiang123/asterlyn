import type { LocaleCatalog } from "../localization/catalog.ts";
import type { GitWorktreeRecovery } from "../models.ts";
import type { ApplicationConfirmationRequest } from "./application-confirmation-dialog.ts";

export function discardConflictConfirmation(catalog: LocaleCatalog): ApplicationConfirmationRequest {
  return {
    title: catalog.common.confirmation,
    message: catalog.gitOperations.discardConflict,
    confirmLabel: catalog.common.discard,
    cancelLabel: catalog.gitOperations.cancel,
    destructive: true,
  };
}

export function undoWorktreeConfirmation(
  catalog: LocaleCatalog,
  recovery: GitWorktreeRecovery,
): ApplicationConfirmationRequest {
  return {
    title: catalog.common.confirmation,
    message: catalog.recovery.confirmUndo(recovery.operation, recovery.paths.join("\n")),
    confirmLabel: catalog.recovery.undoOperation,
    cancelLabel: catalog.common.cancel,
    destructive: true,
  };
}

export function saveFileBeforeCloseConfirmation(
  catalog: LocaleCatalog,
  path: string,
): ApplicationConfirmationRequest {
  return {
    title: catalog.common.confirmation,
    message: `${catalog.editor.confirmCloseFile(path)}\n\n${catalog.editor.cancelKeepsTab}`,
    confirmLabel: catalog.common.save,
    cancelLabel: catalog.common.cancel,
  };
}

export function saveFilesBeforeActionConfirmation(
  catalog: LocaleCatalog,
  count: number,
  action: string,
): ApplicationConfirmationRequest {
  return {
    title: catalog.common.confirmation,
    message: `${catalog.common.confirmSaveBefore(count, action)}\n\n${catalog.common.cancelKeepsWorkspace}`,
    confirmLabel: catalog.common.save,
    cancelLabel: catalog.common.cancel,
  };
}
