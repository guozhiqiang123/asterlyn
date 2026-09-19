import type { BranchSummary } from "../../models";
import { historyRefKey } from "../../history-query.ts";

export {
  commitKey,
  historyPathKey,
  historyRefKey,
  parentCommitKey,
} from "../../history-query.ts";

export function branchKey(branch: Pick<BranchSummary, "repositoryId" | "fullName">): string {
  return historyRefKey(branch);
}
