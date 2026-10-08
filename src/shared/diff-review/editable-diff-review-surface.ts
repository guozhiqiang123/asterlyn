import type { Chunk } from "@codemirror/merge";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { DiffReviewCollapseCoordinator } from "./diff-review-collapse.ts";
import { DiffReviewOverlay } from "./diff-review-overlay.ts";
import { projectTwoWayDiff } from "./diff-review-projection.ts";

export type EditableDiffReviewSide = "before" | "after";

/** Owns the shared folding and connector projection for an editable two-pane Diff. */
export class EditableDiffReviewSurface {
  private readonly collapse: DiffReviewCollapseCoordinator<EditableDiffReviewSide> | null;
  private overlay: DiffReviewOverlay | null = null;

  constructor(before: string, after: string, expandedUnchanged: boolean) {
    this.collapse = expandedUnchanged
      ? null
      : new DiffReviewCollapseCoordinator(before, { before, after });
  }

  extension(side: EditableDiffReviewSide): Extension {
    return this.collapse?.extension(side) ?? [];
  }

  mount(parent: HTMLElement, before: EditorView, after: EditorView): void {
    this.collapse?.register(before);
    this.collapse?.register(after);
    this.overlay = new DiffReviewOverlay(parent, { before, after }, [{ from: "before", to: "after" }]);
  }

  refresh(chunks: readonly Chunk[]): void {
    this.overlay?.setSnapshot(projectTwoWayDiff(chunks, true));
  }

  destroy(): void {
    this.collapse?.destroy();
    this.overlay?.destroy();
    this.overlay = null;
  }
}
