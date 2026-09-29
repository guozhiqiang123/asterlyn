import { ChangeSet } from "@codemirror/state";
import { diff, type Chunk } from "@codemirror/merge";
import { decodeExactText } from "./text-content.ts";

export type WorkspaceReplacementDiffActionKind = "replace" | "rollback";

export interface WorkspaceReplacementDiffAction {
  readonly kind: WorkspaceReplacementDiffActionKind;
  readonly from: number;
  readonly to: number;
  readonly alternative: string;
}

export interface WorkspaceReplacementActionDocument {
  readonly content: string;
  readonly current: string;
  readonly actions: readonly WorkspaceReplacementDiffAction[];
}

/**
 * Builds the immutable side of the interactive replacement Diff.
 *
 * Pending reviewed changes project the proposed text into the action document,
 * while content already changed since the session baseline projects the exact
 * baseline text back into it. Copying a chunk from the action side to the live
 * side therefore means Replace for pending suggestions and Rollback for saved
 * or draft changes without conflating the proposal with the editable buffer.
 */
export function buildWorkspaceReplacementActionDocument(
  originalContent: string,
  proposedContent: string,
  currentContent: string,
): WorkspaceReplacementActionDocument {
  const original = decodeExactText(originalContent).text;
  const proposed = decodeExactText(proposedContent).text;
  const current = decodeExactText(currentContent).text;
  const currentChanges = diff(original, current);
  const plannedChanges = diff(original, proposed);
  const mapping = ChangeSet.of(currentChanges.map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: current.slice(change.fromB, change.toB),
  })), original.length);

  const rollback: WorkspaceReplacementDiffAction[] = currentChanges.map((change) => ({
    kind: "rollback",
    from: change.fromB,
    to: change.toB,
    alternative: original.slice(change.fromA, change.toA),
  }));
  const pending: WorkspaceReplacementDiffAction[] = [];
  for (const change of plannedChanges) {
    if (currentChanges.some((candidate) => changesOverlap(candidate, change))) continue;
    pending.push({
      kind: "replace",
      from: mapping.mapPos(change.fromA, -1),
      to: mapping.mapPos(change.toA, 1),
      alternative: proposed.slice(change.fromB, change.toB),
    });
  }

  const actions = [...rollback, ...pending]
    .sort((left, right) => left.from - right.from || left.to - right.to)
    .filter((action, index, all) => index === 0 || !rangesOverlap(all[index - 1]!, action));
  let content = current;
  for (const action of [...actions].sort((left, right) => right.from - left.from || right.to - left.to)) {
    content = content.slice(0, action.from) + action.alternative + content.slice(action.to);
  }
  return { content, current, actions };
}

export function replacementActionForChunk(
  chunk: Pick<Chunk, "fromB" | "toB">,
  actions: readonly WorkspaceReplacementDiffAction[],
): WorkspaceReplacementDiffActionKind | "mixed" | null {
  const matching = actions.filter((action) => actionOverlapsChunk(action, chunk));
  if (matching.length === 0) return null;
  const first = matching[0]!.kind;
  return matching.every((action) => action.kind === first) ? first : "mixed";
}

function changesOverlap(
  left: { fromA: number; toA: number },
  right: { fromA: number; toA: number },
): boolean {
  if (left.fromA === left.toA && right.fromA === right.toA) return left.fromA === right.fromA;
  if (left.fromA === left.toA) return right.fromA <= left.fromA && left.fromA <= right.toA;
  if (right.fromA === right.toA) return left.fromA <= right.fromA && right.fromA <= left.toA;
  return left.fromA < right.toA && right.fromA < left.toA;
}

function rangesOverlap(
  left: Pick<WorkspaceReplacementDiffAction, "from" | "to">,
  right: Pick<WorkspaceReplacementDiffAction, "from" | "to">,
): boolean {
  if (left.from === left.to || right.from === right.to) {
    return left.from <= right.to && right.from <= left.to;
  }
  return left.from < right.to && right.from < left.to;
}

function actionOverlapsChunk(
  action: Pick<WorkspaceReplacementDiffAction, "from" | "to">,
  chunk: Pick<Chunk, "fromB" | "toB">,
): boolean {
  const chunkEnd = Math.max(chunk.fromB, chunk.toB - 1);
  const actionEnd = Math.max(action.from, action.to - 1);
  return action.from <= chunkEnd && chunk.fromB <= actionEnd;
}
