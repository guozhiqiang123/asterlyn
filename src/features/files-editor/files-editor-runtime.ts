import type { EditorCopy } from "../../localization/catalog.ts";
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

export interface FilesEditorRuntimeGateways {
  readonly files: ProjectFilesGateway;
  readonly editor: EditorSessionGateway;
  readonly workspace: WorkspaceSearchOperations & WorkspaceReplacementOperations;
}

export interface FilesEditorRuntimeNotifications {
  filesChanged(change: ProjectFilesChange): void;
  editorChanged(change: EditorSessionChange): void;
}

/** Owns Files, Editor, Search, and Replacement controllers and their lifecycle. */
export class FilesEditorRuntime {
  readonly files: ProjectFilesController;
  readonly editor: EditorSessionController;
  readonly search: WorkspaceSearchController;
  readonly replacement: WorkspaceReplacementController;

  private readonly releases: readonly (() => void)[];
  private disposed = false;

  constructor(
    gateways: FilesEditorRuntimeGateways,
    messages: EditorCopy,
    notifications: FilesEditorRuntimeNotifications,
  ) {
    this.files = new ProjectFilesController(gateways.files, messages);
    this.editor = new EditorSessionController(gateways.editor, messages);
    this.search = new WorkspaceSearchController(gateways.workspace);
    this.replacement = new WorkspaceReplacementController(gateways.workspace);
    this.releases = [
      this.files.subscribe((change) => notifications.filesChanged(change)),
      this.editor.subscribe((change) => notifications.editorChanged(change)),
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
  }
}
