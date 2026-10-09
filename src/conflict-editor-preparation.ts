import type { Change } from "@codemirror/merge";
import {
  analyzeConflictResolution,
  type ConflictResolutionAnalysis,
} from "./conflict-resolution-model.ts";
import { lineAwareDiff } from "./shared/diff-review/line-aware-diff.ts";

export interface ConflictEditorPreparationInput {
  readonly base: string;
  readonly ours: string;
  readonly result: string;
  readonly theirs: string;
}

export interface ConflictEditorPreparation {
  readonly analysis: ConflictResolutionAnalysis;
  readonly oursToResult: readonly Change[];
  readonly theirsToResult: readonly Change[];
}

/** Pure preparation entry point shared by the worker and the no-Worker fallback. */
export function prepareConflictEditor(
  input: ConflictEditorPreparationInput,
): ConflictEditorPreparation {
  return {
    analysis: analyzeConflictResolution(input.base, input.ours, input.result, input.theirs),
    oursToResult: lineAwareDiff(input.ours, input.result),
    theirsToResult: lineAwareDiff(input.theirs, input.result),
  };
}
