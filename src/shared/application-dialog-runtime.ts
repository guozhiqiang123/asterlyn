import type { CommonCopy } from "../localization/catalog.ts";
import {
  ApplicationConfirmationDialog,
  type ApplicationConfirmationRequest,
} from "./application-confirmation-dialog.ts";
import { DialogGeometryController } from "./dialog-geometry.ts";

/** Window-scoped composition for application-owned dialog presentation behavior. */
export class ApplicationDialogRuntime {
  private readonly confirmation: ApplicationConfirmationDialog;
  private readonly geometry: DialogGeometryController;

  constructor(root: HTMLElement, copy: () => CommonCopy) {
    this.geometry = new DialogGeometryController(
      document,
      window,
      window.localStorage,
      () => ({ move: copy().moveDialog, resize: copy().resizeDialog }),
    );
    this.geometry.connect();
    this.confirmation = new ApplicationConfirmationDialog(root);
  }

  confirm(request: ApplicationConfirmationRequest): Promise<boolean> {
    return this.confirmation.confirm(request);
  }

  dispose(): void {
    this.confirmation.dispose();
    this.geometry.dispose();
  }
}
