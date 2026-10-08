export const CONFLICT_ACTION_GUTTER_WIDTH = 58;
export const CONFLICT_PANE_MIN_PERCENTAGE = 18;

export interface ConflictPanePercentages {
  readonly ours: number;
  readonly result: number;
}

export interface ConflictPaneLayout extends ConflictPanePercentages {
  readonly contentWidth: number;
  readonly oursWidth: number;
  readonly resultWidth: number;
  readonly theirsWidth: number;
}

export function normalizeConflictPercentages(
  oursValue: number,
  resultValue: number,
): ConflictPanePercentages {
  const minimum = CONFLICT_PANE_MIN_PERCENTAGE;
  const ours = Math.max(
    minimum,
    Math.min(100 - minimum * 2, Number.isFinite(oursValue) ? oursValue : 27),
  );
  const result = Math.max(
    minimum,
    Math.min(100 - ours - minimum, Number.isFinite(resultValue) ? resultValue : 46),
  );
  return { ours, result };
}

export function conflictPaneLayout(
  containerWidth: number,
  oursValue: number,
  resultValue: number,
): ConflictPaneLayout {
  const width = Number.isFinite(containerWidth) ? Math.max(1, containerWidth) : 1;
  const contentWidth = Math.max(1, width - CONFLICT_ACTION_GUTTER_WIDTH * 2);
  const { ours, result } = normalizeConflictPercentages(oursValue, resultValue);
  const oursWidth = contentWidth * ours / 100;
  const resultWidth = contentWidth * result / 100;
  return {
    ours,
    result,
    contentWidth,
    oursWidth,
    resultWidth,
    theirsWidth: contentWidth - oursWidth - resultWidth,
  };
}

export function resizeConflictOursPercentage(
  oursValue: number,
  resultValue: number,
  nextOursValue: number,
): ConflictPanePercentages {
  const current = normalizeConflictPercentages(oursValue, resultValue);
  const leadingPair = current.ours + current.result;
  const candidate = Number.isFinite(nextOursValue) ? nextOursValue : current.ours;
  const ours = Math.max(
    CONFLICT_PANE_MIN_PERCENTAGE,
    Math.min(leadingPair - CONFLICT_PANE_MIN_PERCENTAGE, candidate),
  );
  return { ours, result: leadingPair - ours };
}
