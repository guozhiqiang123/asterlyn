import type { RepositorySnapshot, TrackedChangeScan } from "../models";

export function mergeTrackedChanges(
  snapshot: RepositorySnapshot,
  scan: TrackedChangeScan,
): RepositorySnapshot {
  if (snapshot.root !== scan.root) return snapshot;
  const trackedPaths = new Set(scan.changes.map((change) => change.path));
  const untracked = snapshot.changes.filter(
    (change) =>
      change.worktreeStatus === "untracked" && !trackedPaths.has(change.path),
  );
  return {
    ...snapshot,
    changes: [...scan.changes, ...untracked].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
}
