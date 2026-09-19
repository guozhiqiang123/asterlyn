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

export interface FilesEditorRuntimeGateways {
  readonly files: ProjectFilesGateway;
  readonly editor: EditorSessionGateway;
}

export interface FilesEditorRuntimeNotifications {
  filesChanged(change: ProjectFilesChange): void;
  editorChanged(change: EditorSessionChange): void;
}

/** Owns Files and Editor's core controllers, subscriptions, and disposal. */
export class FilesEditorRuntime {
  readonly files: ProjectFilesController;
  readonly editor: EditorSessionController;

  private readonly releases: readonly (() => void)[];
  private disposed = false;

  constructor(
    gateways: FilesEditorRuntimeGateways,
    messages: EditorCopy,
    notifications: FilesEditorRuntimeNotifications,
  ) {
    this.files = new ProjectFilesController(gateways.files, messages);
    this.editor = new EditorSessionController(gateways.editor, messages);
    this.releases = [
      this.files.subscribe((change) => notifications.filesChanged(change)),
      this.editor.subscribe((change) => notifications.editorChanged(change)),
    ];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.releases) release();
    this.files.dispose();
    this.editor.dispose();
  }
}
