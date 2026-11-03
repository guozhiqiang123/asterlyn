import type {CommitFileChange} from "../../models.ts";
export function sameCommitFileChanges(
  left: readonly CommitFileChange[],
  right: readonly CommitFileChange[],
): boolean {
  return left.length === right.length && left.every((file, index) => {
    const candidate = right[index];
    return Boolean(
      candidate &&
      file.path === candidate.path &&
      file.originalPath === candidate.originalPath &&
      file.status === candidate.status,
    );
  });
}
