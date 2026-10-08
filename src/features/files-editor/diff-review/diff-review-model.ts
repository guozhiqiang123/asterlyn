export type DiffReviewPaneId = "before" | "after" | "ours" | "result" | "theirs";

export type DiffReviewBlockKind = "added" | "removed" | "modified" | "conflict" | "identical";

export type DiffReviewBlockStatus =
  | "pending"
  | "accepted"
  | "ignored"
  | "reverted"
  | "manual"
  | "readonly";

export type DiffReviewActionId =
  | "revert"
  | "apply-ours"
  | "ignore-ours"
  | "apply-theirs"
  | "ignore-theirs";

export interface DiffReviewRange {
  readonly from: number;
  readonly to: number;
}

export interface DiffReviewAction {
  readonly id: DiffReviewActionId;
  readonly side?: "ours" | "theirs";
  readonly selected?: boolean;
  readonly disabled?: boolean;
}

export interface DiffReviewBlock {
  readonly id: string;
  readonly kind: DiffReviewBlockKind;
  readonly ranges: Readonly<Partial<Record<DiffReviewPaneId, DiffReviewRange | null>>>;
  readonly status: DiffReviewBlockStatus;
  readonly actions: readonly DiffReviewAction[];
}

export interface DiffReviewPane {
  readonly id: DiffReviewPaneId;
  readonly role: string;
  readonly identity?: string | null;
  readonly writable: boolean;
}

export interface DiffReviewCapabilities {
  readonly navigateBlocks: boolean;
  readonly navigateFiles: boolean;
  readonly openSource: boolean;
  readonly toggleUnchanged: boolean;
  readonly toggleLayout: boolean;
  readonly toggleWhitespace: boolean;
  readonly applyNonConflicting: boolean;
  readonly cancel: boolean;
  readonly finish: boolean;
}

export interface DiffReviewSummary {
  readonly total: number;
  readonly conflicts: number;
  readonly nonConflicting: number;
  readonly identical: number;
  readonly pending: number;
  readonly reviewed: number;
  readonly manual: number;
}

export interface DiffReviewSnapshot {
  readonly panes: readonly DiffReviewPane[];
  readonly blocks: readonly DiffReviewBlock[];
  readonly summary: DiffReviewSummary;
  readonly capabilities: DiffReviewCapabilities;
  readonly activeBlockId?: string | null;
}

export const READ_ONLY_DIFF_CAPABILITIES: DiffReviewCapabilities = Object.freeze({
  navigateBlocks: true,
  navigateFiles: true,
  openSource: true,
  toggleUnchanged: true,
  toggleLayout: true,
  toggleWhitespace: true,
  applyNonConflicting: false,
  cancel: false,
  finish: false,
});

export const EDITABLE_DIFF_CAPABILITIES: DiffReviewCapabilities = Object.freeze({
  ...READ_ONLY_DIFF_CAPABILITIES,
  finish: true,
});

export const CONFLICT_DIFF_CAPABILITIES: DiffReviewCapabilities = Object.freeze({
  navigateBlocks: true,
  navigateFiles: false,
  openSource: false,
  toggleUnchanged: true,
  toggleLayout: false,
  toggleWhitespace: true,
  applyNonConflicting: true,
  cancel: true,
  finish: true,
});

export function summarizeDiffReviewBlocks(
  blocks: readonly DiffReviewBlock[],
): DiffReviewSummary {
  let conflicts = 0;
  let identical = 0;
  let pending = 0;
  let reviewed = 0;
  let manual = 0;
  for (const block of blocks) {
    if (block.kind === "conflict") conflicts += 1;
    if (block.kind === "identical") identical += 1;
    if (block.status === "pending") pending += 1;
    else if (block.status === "manual") manual += 1;
    else if (block.status !== "readonly") reviewed += 1;
  }
  return {
    total: blocks.length,
    conflicts,
    nonConflicting: blocks.length - conflicts - identical,
    identical,
    pending,
    reviewed,
    manual,
  };
}

