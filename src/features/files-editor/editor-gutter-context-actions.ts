import type {
  ContextMenuAvailability,
  ContextMenuSession,
} from "../../shared/context-menu/context-menu-model.ts";
import type { GitBlameCopy } from "../../workbench/editor-gutter.ts";

export const GIT_BLAME_TOGGLE_ACTION = "editor.git-blame.toggle";

export interface GitBlameContextState {
  readonly active: boolean;
  readonly loading: boolean;
  readonly enabled: boolean;
  readonly unavailableReason: string | null;
  readonly copy: GitBlameCopy;
  isCurrent(): boolean;
  toggle(): void | Promise<void>;
  blocked(reason: string): void;
  restoreFocus(): void;
}

export function gitBlameContextSession(
  ownerId: string,
  state: GitBlameContextState,
): ContextMenuSession {
  const availability = gitBlameAvailability(state);
  return {
    ownerId,
    model: {
      ariaLabel: state.copy.gutterActions,
      items: [{
        kind: "check",
        id: GIT_BLAME_TOGGLE_ACTION,
        actionId: GIT_BLAME_TOGGLE_ACTION,
        label: state.loading
          ? state.copy.loadingGitBlame
          : state.active
            ? state.copy.hideGitBlame
            : state.copy.annotateGitBlame,
        checked: state.active,
        availability,
      }],
    },
    isCurrent: () => state.isCurrent(),
    invoke: (actionId) => {
      if (actionId !== GIT_BLAME_TOGGLE_ACTION || !state.isCurrent()) return;
      return state.toggle();
    },
    blocked: (reason) => state.blocked(reason),
    restoreFocus: () => state.restoreFocus(),
  };
}

function gitBlameAvailability(state: GitBlameContextState): ContextMenuAvailability {
  if (state.loading) return { kind: "busy", label: state.copy.loadingGitBlame };
  if (state.enabled) return { kind: "enabled" };
  return {
    kind: "blocked",
    reason: state.unavailableReason ?? state.copy.gitBlameRequiresTrackedFile,
  };
}
