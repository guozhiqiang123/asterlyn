import type { SourceDiffRow } from "../../diff-presentation.ts";
import type { ConflictResolutionBlockSnapshot, ConflictResolutionDecision } from "../../conflict-resolution-model.ts";
import {
  CONFLICT_DIFF_CAPABILITIES,
  EDITABLE_DIFF_CAPABILITIES,
  READ_ONLY_DIFF_CAPABILITIES,
  summarizeDiffReviewBlocks,
  type DiffReviewAction,
  type DiffReviewBlock,
  type DiffReviewBlockKind,
  type DiffReviewPane,
  type DiffReviewSnapshot,
} from "./diff-review-model.ts";

export interface TwoWayDiffChunk {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
}

export function projectStaticSplitDiff(
  rows: readonly SourceDiffRow[],
): DiffReviewSnapshot {
  const offsets = splitRowOffsets(rows);
  const blocks: DiffReviewBlock[] = [];
  let start = -1;
  for (let index = 0; index <= rows.length; index += 1) {
    const row = rows[index];
    const changed = row && row.kind !== "context" && row.kind !== "omitted" && row.kind !== "notice";
    if (changed && start < 0) start = index;
    if (changed || start < 0) continue;
    const end = index - 1;
    const group = rows.slice(start, end + 1);
    blocks.push({
      id: `patch:${start}:${end}`,
      kind: groupKind(group),
      ranges: {
        before: { from: offsets.before[start]!, to: offsets.before[end + 1]! },
        after: { from: offsets.after[start]!, to: offsets.after[end + 1]! },
      },
      status: "readonly",
      actions: [],
    });
    start = -1;
  }
  return snapshot(twoWayPanes(false), blocks, READ_ONLY_DIFF_CAPABILITIES);
}

export function projectTwoWayDiff(
  chunks: readonly TwoWayDiffChunk[],
  writable: boolean,
): DiffReviewSnapshot {
  const rangeOccurrences = new Map<string, number>();
  const blocks = chunks.map((chunk): DiffReviewBlock => {
    const anchor = `${chunk.fromA}:${chunk.toA}`;
    const occurrence = rangeOccurrences.get(anchor) ?? 0;
    rangeOccurrences.set(anchor, occurrence + 1);
    return {
      id: `two-way:${anchor}:${occurrence}`,
      kind: twoWayKind(chunk),
      ranges: {
        before: { from: chunk.fromA, to: chunk.toA },
        after: { from: chunk.fromB, to: chunk.toB },
      },
      status: writable ? "pending" : "readonly",
      actions: writable ? [{ id: "revert" }] : [],
    };
  });
  return snapshot(
    twoWayPanes(writable),
    blocks,
    writable ? EDITABLE_DIFF_CAPABILITIES : READ_ONLY_DIFF_CAPABILITIES,
  );
}

export function projectConflictDiff(
  source: readonly ConflictResolutionBlockSnapshot[],
): DiffReviewSnapshot {
  const blocks = source.map((block): DiffReviewBlock => ({
    id: `conflict:${block.id}`,
    kind: conflictKind(block),
    ranges: {
      ours: block.ours,
      result: block.result,
      theirs: block.theirs,
    },
    status: conflictStatus(block),
    actions: conflictActions(block),
    authoritativeConflict: block.markerBacked === true,
  }));
  const panes: readonly DiffReviewPane[] = [
    { id: "ours", role: "Ours", writable: false },
    { id: "result", role: "Result", writable: true },
    { id: "theirs", role: "Theirs", writable: false },
  ];
  return snapshot(panes, blocks, CONFLICT_DIFF_CAPABILITIES);
}

export function conflictActionGroupVisible(
  state: ConflictResolutionDecision | "mixed" | null | undefined,
): boolean {
  return state === "pending" || state === "mixed";
}

function snapshot(
  panes: readonly DiffReviewPane[],
  blocks: readonly DiffReviewBlock[],
  capabilities: DiffReviewSnapshot["capabilities"],
): DiffReviewSnapshot {
  return { panes, blocks, capabilities, summary: summarizeDiffReviewBlocks(blocks) };
}

function twoWayPanes(writable: boolean): readonly DiffReviewPane[] {
  return [
    { id: "before", role: "Before", writable: false },
    { id: "after", role: "After", writable },
  ];
}

function twoWayKind(chunk: TwoWayDiffChunk): DiffReviewBlockKind {
  if (chunk.fromA === chunk.toA) return "added";
  if (chunk.fromB === chunk.toB) return "removed";
  return "modified";
}

function groupKind(rows: readonly SourceDiffRow[]): DiffReviewBlockKind {
  if (rows.every((row) => row.kind === "added")) return "added";
  if (rows.every((row) => row.kind === "removed")) return "removed";
  return "modified";
}

function splitRowOffsets(rows: readonly SourceDiffRow[]): {
  before: readonly number[];
  after: readonly number[];
} {
  const before = [0];
  const after = [0];
  for (const row of rows) {
    before.push(before.at(-1)! + row.old.text.length + 1);
    after.push(after.at(-1)! + row.new.text.length + 1);
  }
  return { before, after };
}

function conflictKind(block: ConflictResolutionBlockSnapshot): DiffReviewBlockKind {
  if (block.oursChanged && block.theirsChanged) {
    return block.sameSideContent ? "identical" : "conflict";
  }
  if (block.base.from === block.base.to) return "added";
  if ((block.oursChanged && block.ours.from === block.ours.to) ||
      (block.theirsChanged && block.theirs.from === block.theirs.to)) return "removed";
  return "modified";
}

function conflictStatus(block: ConflictResolutionBlockSnapshot): DiffReviewBlock["status"] {
  if (block.manuallyEdited) return "manual";
  const decisions = [
    block.oursChanged ? block.oursDecision : null,
    block.theirsChanged ? block.theirsDecision : null,
  ].filter((decision): decision is "pending" | "accepted" | "ignored" => decision !== null);
  if (block.automaticallyResolved && decisions.every((decision) => decision === "pending")) {
    return "accepted";
  }
  if (decisions.some((decision) => decision === "pending")) return "pending";
  return decisions.some((decision) => decision === "accepted") ? "accepted" : "ignored";
}

function conflictActions(block: ConflictResolutionBlockSnapshot): readonly DiffReviewAction[] {
  const actions: DiffReviewAction[] = [];
  if (block.oursChanged) {
    actions.push(
      { id: "apply-ours", side: "ours", selected: block.oursDecision === "accepted" },
      { id: "ignore-ours", side: "ours", selected: block.oursDecision === "ignored" },
    );
  }
  if (block.theirsChanged) {
    actions.push(
      { id: "apply-theirs", side: "theirs", selected: block.theirsDecision === "accepted" },
      { id: "ignore-theirs", side: "theirs", selected: block.theirsDecision === "ignored" },
    );
  }
  return actions;
}
