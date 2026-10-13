import type { TagMutationKind } from "../../models.ts";

export function tagMutationCompletionIsProminent(kind: TagMutationKind): boolean {
  return kind === "push";
}
