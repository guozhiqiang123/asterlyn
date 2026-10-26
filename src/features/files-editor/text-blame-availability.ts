import type { RepositorySnapshot } from "../../models.ts";
import type { EditorCopy } from "../../localization/catalog.ts";
import { isTextTabDirty, type TextTabState } from "./editor-session.ts";
import { unavailableBlame } from "./diff-context.ts";
import type { GitBlameAvailability } from "./editor-gutter.ts";

export function projectTextBlameAvailability(tab: TextTabState, snapshot: RepositorySnapshot | null, copy: EditorCopy): GitBlameAvailability {
    const document = tab.document;
    if (
      !snapshot ||
      snapshot.root !== document.repositoryRoot ||
      !snapshot.repositoryRoots.some((root) => root.id === document.repositoryId)
    ) {
      return unavailableBlame(copy.gitBlameRequiresGit);
    }
    if (isTextTabDirty(tab) || tab.saveRequest !== null) {
      return unavailableBlame(
        copy.gitBlameRequiresSavedFile,
      );
    }
    const untracked = document.ignored === true || snapshot.changes.some((change) =>
        (change.repositoryId || ".") === document.repositoryId &&
        change.path === document.path && (
          change.indexStatus === "untracked" || change.worktreeStatus === "untracked"
        )
      );
    if (untracked) {
      return unavailableBlame(
        copy.gitBlameRequiresTrackedFile,
      );
    }
    return {
      source: {
        repositoryRoot: document.repositoryRoot,
        repositoryId: document.repositoryId,
        path: document.path,
        commitOid: null,
        parent: false,
      },
      unavailableReason: null,
    };
}
