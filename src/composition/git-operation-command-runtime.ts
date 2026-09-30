import type {
  CommandAvailability,
  CommandDescriptor,
  CommandFocusScope,
  CommandRegistry,
} from "../application/commands/command-service.ts";
import { GIT_OPERATION_COMMANDS } from "../application/commands/git-operation-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";

const SCOPES: readonly CommandFocusScope[] = ["workbench", "input", "editor", "diff", "history"];

export interface GitOperationCommandRuntimeOptions {
  readonly catalog: () => LocaleCatalog;
  readonly gitOperationAvailable: () => boolean;
  readonly gitRecoveryAvailable: () => boolean;
  readonly openGitOperation: () => void;
  readonly openGitRecoveries: () => void | Promise<void>;
}

export function registerGitOperationCommands(
  registry: CommandRegistry,
  options: GitOperationCommandRuntimeOptions,
): () => void {
  const available = (enabled: boolean, reason: string): CommandAvailability =>
    enabled ? { enabled: true } : { enabled: false, reason };
  const descriptors: CommandDescriptor[] = [
    {
      id: GIT_OPERATION_COMMANDS.open,
      category: "workspace",
      userBindingScopes: SCOPES,
      title: () => options.catalog().shell.gitOperations,
      detail: () => options.catalog().gitOperations.exactReviewNote,
      keywords: () => "git merge cherry-pick rebase squash reviewed operation",
      availability: () => available(options.gitOperationAvailable(), options.catalog().settings.keybindings.gitRequired),
      execute: () => options.openGitOperation(),
    },
    {
      id: GIT_OPERATION_COMMANDS.openRecoveries,
      category: "workspace",
      userBindingScopes: SCOPES,
      title: () => options.catalog().shell.recoverChanges,
      detail: () => options.catalog().recovery.noneAvailable,
      keywords: () => "git recovery restore undo local changes worktree",
      availability: () => available(options.gitRecoveryAvailable(), options.catalog().settings.keybindings.workspaceRequired),
      execute: () => options.openGitRecoveries(),
    },
  ];
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => { for (const release of releases.reverse()) release(); };
}
