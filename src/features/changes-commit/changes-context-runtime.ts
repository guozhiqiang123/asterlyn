import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { ChangesCopy } from "../../localization/catalog.ts";
import type { RepositorySnapshot } from "../../models.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import {
  ChangesContextActions,
  type ChangesContextCommandAction,
  type ChangesContextRuntime,
} from "./changes-context-actions.ts";
import {
  ChangesContextBinding,
  resolveChangesContextTarget,
  resolveChangesGroupContextTarget,
  type ChangesContextTarget,
} from "./changes-navigation-binding.ts";

export interface ChangesContextSource {
  readonly snapshot: RepositorySnapshot | null;
  readonly workspaceGeneration: number;
  readonly repositoryId: string;
  readonly repositoryRevision: number;
  readonly selectedPath: string | null;
}

export interface ChangesCommandAvailability {
  readonly enabled: boolean;
  readonly reason?: string;
}

export interface ChangesContextRuntimeOptions {
  readonly root: HTMLElement;
  readonly host: ContextMenuPort;
  readonly clipboard: TextClipboardPort;
  readonly source: () => ChangesContextSource;
  readonly actions: ChangesContextRuntime;
  readonly copy: () => ChangesCopy;
}

/** Owns the Changes tree's delegated context-menu boundary and action provider. */
export class ChangesContextSurfaceRuntime {
  private readonly binding: ChangesContextBinding;
  private readonly actions: ChangesContextActions;
  private readonly source: () => ChangesContextSource;
  private readonly copy: () => ChangesCopy;

  constructor(options: ChangesContextRuntimeOptions) {
    this.source = options.source;
    this.copy = options.copy;
    this.actions = new ChangesContextActions(
      options.host,
      options.clipboard,
      options.actions,
      options.copy,
    );
    this.binding = new ChangesContextBinding(
      options.root,
      options.source,
      (request) => this.actions.open(request),
    );
  }

  commandAvailability(action: ChangesContextCommandAction): ChangesCommandAvailability {
    const target = this.commandTarget(action);
    if (!target) {
      return {
        enabled: false,
        reason: action === "stage-all" || action === "trash-all"
          ? this.copy().noLocalChanges
          : this.copy().selectFile,
      };
    }
    const availability = this.actions.commandAvailability(action, target);
    return availability.kind === "enabled"
      ? { enabled: true }
      : {
          enabled: false,
          reason: availability.kind === "busy" ? availability.label : availability.reason,
        };
  }

  async executeCommand(action: ChangesContextCommandAction): Promise<void> {
    const target = this.commandTarget(action);
    if (!target) return;
    await this.actions.executeCommand(action, target);
  }

  dispose(): void {
    this.binding.dispose();
  }

  private commandTarget(action: ChangesContextCommandAction): ChangesContextTarget | null {
    const source = this.source();
    if (action === "stage-all" || action === "trash-all") {
      return resolveChangesGroupContextTarget(
        source.snapshot,
        source.workspaceGeneration,
        "unversioned",
        source.repositoryId,
        source.repositoryRevision,
      );
    }
    return source.selectedPath
      ? resolveChangesContextTarget(
          source.snapshot,
          source.workspaceGeneration,
          source.selectedPath,
          source.repositoryId,
          source.repositoryRevision,
        )
      : null;
  }
}
