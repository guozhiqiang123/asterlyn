import { invertedEffects, isolateHistory } from "@codemirror/commands";
import { StateEffect, type Extension, type Transaction, type TransactionSpec } from "@codemirror/state";
import type { TextChange } from "./features/files-editor/text-content.ts";
import type { ConflictResolutionHistoryState } from "./conflict-resolution-model.ts";

interface ConflictResolutionTransition {
  readonly target: ConflictResolutionHistoryState;
  readonly inverse: ConflictResolutionHistoryState;
}

const setConflictResolution = StateEffect.define<ConflictResolutionTransition>();

export const conflictResolutionHistoryExtension: Extension = invertedEffects.of((transaction) =>
  transaction.effects.flatMap((effect) => effect.is(setConflictResolution)
    ? [setConflictResolution.of({ target: effect.value.inverse, inverse: effect.value.target })]
    : []),
);

export function conflictResolutionTransaction(
  before: ConflictResolutionHistoryState,
  after: ConflictResolutionHistoryState,
  changes: readonly TextChange[],
  userEvent: string,
): TransactionSpec {
  return {
    changes,
    effects: setConflictResolution.of({ target: after, inverse: before }),
    annotations: isolateHistory.of("full"),
    userEvent,
  };
}

export function conflictResolutionHistoryState(
  transactions: readonly Transaction[],
): ConflictResolutionHistoryState | null {
  for (const transaction of transactions) {
    for (const effect of transaction.effects) {
      if (effect.is(setConflictResolution)) return effect.value.target;
    }
  }
  return null;
}
