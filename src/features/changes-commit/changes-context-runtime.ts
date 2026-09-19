import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { ChangesCopy } from "../../localization/catalog.ts";
import type { RepositorySnapshot } from "../../models.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import {
  ChangesContextActions,
  type ChangesContextRuntime,
} from "./changes-context-actions.ts";
import { ChangesContextBinding } from "./changes-navigation-binding.ts";

export interface ChangesContextSource {
  readonly snapshot: RepositorySnapshot | null;
  readonly workspaceGeneration: number;
  readonly repositoryId: string;
  readonly repositoryRevision: number;
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

  constructor(options: ChangesContextRuntimeOptions) {
    const actions = new ChangesContextActions(
      options.host,
      options.clipboard,
      options.actions,
      options.copy,
    );
    this.binding = new ChangesContextBinding(
      options.root,
      options.source,
      (request) => actions.open(request),
    );
  }

  dispose(): void {
    this.binding.dispose();
  }
}
