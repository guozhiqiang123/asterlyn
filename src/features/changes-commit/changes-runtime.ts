import type { ChangesCopy } from "../../localization/catalog.ts";
import type { ChangeFileView } from "../../workbench/change-presentation.ts";
import {
  ChangesCommitController,
  type ChangesCommitChange,
  type ChangesCommitGateway,
} from "./changes-commit-controller.ts";

export interface ChangesRuntimeOptions {
  readonly gateway: ChangesCommitGateway;
  readonly initialFileView: ChangeFileView;
  readonly messages: Pick<ChangesCopy, "patchTruncated" | "unexpectedError">;
  changed(change: ChangesCommitChange): void;
}

/** Owns the Changes controller subscription and lifecycle. */
export class ChangesRuntime {
  readonly controller: ChangesCommitController;

  private readonly release: () => void;
  private disposed = false;

  constructor(options: ChangesRuntimeOptions) {
    this.controller = new ChangesCommitController(
      options.gateway,
      options.initialFileView,
      options.messages,
    );
    this.release = this.controller.subscribe((change) => options.changed(change));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.controller.dispose();
  }
}
