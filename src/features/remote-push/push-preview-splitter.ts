import { attachSplitter } from "../../presentation/splitter.ts";

export const PUSH_COMMITS_WIDTH_KEY = "asterlyn.push-commits-width";

const DEFAULT_COMMITS_WIDTH = 360;
const MIN_COMMITS_WIDTH = 220;
const MIN_FILES_WIDTH = 240;
const bindings = new WeakMap<HTMLElement, () => void>();

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Feature-owned divider between the commit and file panes inside Push review. */
export function bindPushPreviewSplitter(
  root: HTMLElement,
  storage?: Pick<Storage, "getItem" | "setItem">,
): (() => void) | null {
  bindings.get(root)?.();
  bindings.delete(root);

  const grid = root.querySelector<HTMLElement>(".push-preview-grid");
  const splitter = grid?.querySelector<HTMLElement>("#push-preview-splitter");
  if (!grid || !splitter) return null;

  const loadWidth = (): number => {
    const raw = storage?.getItem(PUSH_COMMITS_WIDTH_KEY);
    if (raw) {
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return DEFAULT_COMMITS_WIDTH;
  };
  const applyWidth = (width: number): void => {
    grid.style.setProperty("--push-commits-width", `${Math.round(width)}px`);
  };
  const getRange = () => {
    const total = grid.clientWidth;
    const maximum = Math.max(
      MIN_COMMITS_WIDTH,
      (total || DEFAULT_COMMITS_WIDTH + MIN_FILES_WIDTH) - MIN_FILES_WIDTH - 5,
    );
    return { minimum: MIN_COMMITS_WIDTH, maximum };
  };
  const getValue = (): number => {
    const parsed = Number.parseFloat(grid.style.getPropertyValue("--push-commits-width"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : loadWidth();
  };

  applyWidth(clamp(loadWidth(), getRange().minimum, getRange().maximum));
  const dispose = attachSplitter(splitter, {
    orientation: "vertical",
    getValue,
    getRange,
    onChange: applyWidth,
    onCommit: () => {
      try {
        storage?.setItem(PUSH_COMMITS_WIDTH_KEY, String(Math.round(getValue())));
      } catch {
        // The review remains usable when profile storage is unavailable.
      }
    },
    onReset: () => {
      applyWidth(DEFAULT_COMMITS_WIDTH);
      try {
        storage?.setItem(PUSH_COMMITS_WIDTH_KEY, String(DEFAULT_COMMITS_WIDTH));
      } catch {
        // The review remains usable when profile storage is unavailable.
      }
    },
  });
  bindings.set(root, dispose);
  return dispose;
}
