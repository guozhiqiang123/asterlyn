import type { EditorCopy } from "../../localization/catalog.ts";
import type { CommitFileChange, RepositorySnapshot } from "../../models.ts";
import { identifyDiffSides, type DiffSideLabels } from "../../diff-presentation.ts";
import type {
  EditorDocument,
  HistoricalFileComparisonDocument,
} from "../../editor-document.ts";
import type {
  DiffGitBlameSources,
  GitBlameAvailability,
} from "./editor-gutter.ts";

type DiffDocument = Extract<EditorDocument, {
  kind: "working-diff" | "commit-diff" | "commit-comparison-diff";
}>;

export function editorDiffSideLabels(
  document: DiffDocument,
  copy: EditorCopy,
  context: { headOid: string | null; parentOid: string | null },
): DiffSideLabels {
  if (document.kind === "working-diff") {
    const before = context.headOid ? `HEAD ${shortRevision(context.headOid)}` : "HEAD";
    const after = document.selection.staged ? copy.index : copy.workingTree;
    return identifyDiffSides(copy.before, copy.after, before, after);
  }
  if (document.kind === "commit-comparison-diff") {
    return identifyDiffSides(
      copy.before,
      copy.after,
      shortRevision(document.beforeOid),
      shortRevision(document.afterOid),
    );
  }
  return identifyDiffSides(
    copy.before,
    copy.after,
    context.parentOid ? shortRevision(context.parentOid) : copy.emptyTree,
    shortRevision(document.oid),
  );
}

export function historicalDiffSideLabels(
  document: HistoricalFileComparisonDocument,
  currentLabel: string,
  copy: EditorCopy,
): DiffSideLabels {
  return identifyDiffSides(
    copy.before,
    copy.after,
    shortRevision(document.commitOid),
    currentLabel,
  );
}

export function commitDiffBlameSources(
  snapshot: RepositorySnapshot | null,
  repositoryRoot: string | null,
  repositoryId: string | null,
  oid: string | null,
  file: CommitFileChange,
  copy: EditorCopy,
): DiffGitBlameSources {
  if (!repositoryRoot || !repositoryId || !oid ||
    !repositoryAvailable(snapshot, repositoryRoot, repositoryId)) {
    return unavailableDiffBlame(copy.gitBlameRequiresGit, copy.gitBlameRequiresSplit);
  }
  return changedFileBlameSources(
    repositoryRoot,
    repositoryId,
    oid,
    oid,
    true,
    file,
    copy,
  );
}

export function comparisonDiffBlameSources(
  snapshot: RepositorySnapshot | null,
  document: Extract<EditorDocument, { kind: "commit-comparison-diff" }>,
  file: CommitFileChange,
  copy: EditorCopy,
): DiffGitBlameSources {
  if (!repositoryAvailable(snapshot, document.repositoryRoot, document.repositoryId)) {
    return unavailableDiffBlame(copy.gitBlameRequiresGit, copy.gitBlameRequiresSplit);
  }
  return changedFileBlameSources(
    document.repositoryRoot,
    document.repositoryId,
    document.beforeOid,
    document.afterOid,
    false,
    file,
    copy,
  );
}

export function unavailableDiffBlame(
  reason: string,
  unifiedReason: string,
): DiffGitBlameSources {
  return {
    old: unavailableBlame(reason),
    new: unavailableBlame(reason),
    unifiedReason,
  };
}

export function unavailableBlame(reason: string): GitBlameAvailability {
  return { source: null, unavailableReason: reason };
}

function changedFileBlameSources(
  repositoryRoot: string,
  repositoryId: string,
  beforeOid: string,
  afterOid: string,
  beforeUsesParent: boolean,
  file: CommitFileChange,
  copy: EditorCopy,
): DiffGitBlameSources {
  return {
    old: file.status === "added"
      ? unavailableBlame(copy.gitBlameFileUnavailable)
      : {
          source: {
            repositoryRoot,
            repositoryId,
            path: file.originalPath ?? file.path,
            commitOid: beforeOid,
            parent: beforeUsesParent,
          },
          unavailableReason: null,
        },
    new: file.status === "deleted"
      ? unavailableBlame(copy.gitBlameFileUnavailable)
      : {
          source: {
            repositoryRoot,
            repositoryId,
            path: file.path,
            commitOid: afterOid,
            parent: false,
          },
          unavailableReason: null,
        },
    unifiedReason: copy.gitBlameRequiresSplit,
  };
}

function repositoryAvailable(
  snapshot: RepositorySnapshot | null,
  repositoryRoot: string,
  repositoryId: string,
): boolean {
  return snapshot?.root === repositoryRoot &&
    snapshot.repositoryRoots.some((root) => root.id === repositoryId);
}

function shortRevision(oid: string): string {
  return oid.slice(0, 8).toLowerCase();
}
