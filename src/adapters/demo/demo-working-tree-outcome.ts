import type { RepositorySnapshot, WorkingTreeMutationOutcome } from "../../models.ts";
import { demoTrackedSnapshot } from "../../demo.ts";

export function demoWorkingTreeOutcome(snapshot: RepositorySnapshot): WorkingTreeMutationOutcome {
  return {
    tracked: { root: snapshot.root, changes: demoTrackedSnapshot(snapshot).changes },
    invalidatedSlices: ["workingTree"],
  };
}
