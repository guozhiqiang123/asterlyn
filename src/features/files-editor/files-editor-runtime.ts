import type { EditorCopy } from "../../localization/catalog.ts";
import { CommandSurfaceController } from "./command-surface-controller.ts";
import {
  EditorSessionController,
  type EditorSessionChange,
  type EditorSessionGateway,
} from "./editor-session-controller.ts";
import {
  ProjectFilesController,
  type ProjectFilesChange,
  type ProjectFilesGateway,
} from "./project-files-controller.ts";
import {
  WorkspaceSearchController,
  type WorkspaceSearchOperations,
} from "./workspace-search-controller.ts";
import {
  WorkspaceReplacementController,
  type WorkspaceReplacementOperations,
} from "./workspace-replacement-controller.ts";
import {
  EditorChangeBaselineController,
  type EditorChangeBaselineChange,
  type EditorChangeBaselineGateway,
} from "./editor-change-baseline-controller.ts";

export interface FilesEditorRuntimeGateways {
  readonly files: ProjectFilesGateway;
  readonly editor: EditorSessionGateway;
  readonly changeBaseline: EditorChangeBaselineGateway;
  readonly workspace: WorkspaceSearchOperations & WorkspaceReplacementOperations;
}

export interface FilesEditorRuntimeNotifications {
  filesChanged(change: ProjectFilesChange): void;
  editorChanged(change: EditorSessionChange): void;
  changeBaselineChanged(change: EditorChangeBaselineChange): void;
}

/** Owns Files, Editor, Search, and Replacement controllers and their lifecycle. */
export class FilesEditorRuntime {
  readonly files: ProjectFilesController;
  readonly editor: EditorSessionController;
  readonly changeBaseline: EditorChangeBaselineController;
  readonly search: WorkspaceSearchController;
  readonly replacement: WorkspaceReplacementController;
  readonly commands: CommandSurfaceController;

  private readonly releases: readonly (() => void)[];
  private disposed = false;

  constructor(
    gateways: FilesEditorRuntimeGateways,
    messages: EditorCopy,
    notifications: FilesEditorRuntimeNotifications,
  ) {
    this.files = new ProjectFilesController(gateways.files, messages);
    this.editor = new EditorSessionController(gateways.editor, messages);
    this.changeBaseline = new EditorChangeBaselineController(gateways.changeBaseline);
    this.search = new WorkspaceSearchController(gateways.workspace);
    this.replacement = new WorkspaceReplacementController(gateways.workspace);
    this.commands = new CommandSurfaceController();
    this.releases = [
      this.files.subscribe((change) => notifications.filesChanged(change)),
      this.editor.subscribe((change) => notifications.editorChanged(change)),
      this.changeBaseline.subscribe((change) => notifications.changeBaselineChanged(change)),
    ];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.releases) release();
    this.search.dispose();
    this.replacement.dispose();
    this.files.dispose();
    this.editor.dispose();
    this.changeBaseline.dispose();
  }
}
