import { editorDocumentKey, type EditorDocument } from "../../editor-document.ts";

export type DiffDocument = Extract<EditorDocument, {
  kind: "working-diff" | "commit-diff" | "commit-comparison-diff";
}>;
export type DiffContextExpansionAction = "none" | "render" | "reload";

export function isDiffDocument(document: EditorDocument): document is DiffDocument {
  return document.kind === "working-diff" || document.kind === "commit-diff" ||
    document.kind === "commit-comparison-diff";
}

export class DiffContextExpansionState {
  private fullyExpandedKey: string | null = null;
  private partial: { documentKey: string; sections: Set<string> } | null = null;

  isFullyExpanded(document: EditorDocument): boolean {
    return isDiffDocument(document) && this.fullyExpandedKey === editorDocumentKey(document);
  }

  requestsExpandedPatch(document: EditorDocument): boolean {
    return this.isFullyExpanded(document) || (
      isDiffDocument(document) && this.partial?.documentKey === editorDocumentKey(document)
    );
  }

  sections(document: EditorDocument): readonly string[] {
    if (!isDiffDocument(document) || this.partial?.documentKey !== editorDocumentKey(document)) return [];
    return [...this.partial.sections].sort();
  }

  projectionKey(document: EditorDocument): string {
    if (this.isFullyExpanded(document)) return "all";
    const sections = this.sections(document);
    return sections.length > 0 ? `partial:${sections.join(",")}` : "compact";
  }

  toggle(document: DiffDocument): DiffContextExpansionAction {
    const key = editorDocumentKey(document);
    if (this.fullyExpandedKey === key) {
      this.fullyExpandedKey = null;
      if (this.partial?.documentKey === key) this.partial = null;
      return "reload";
    }
    this.fullyExpandedKey = key;
    if (this.partial?.documentKey !== key) return "reload";
    this.partial = null;
    return "render";
  }

  expand(document: DiffDocument, section: string): DiffContextExpansionAction {
    if (this.isFullyExpanded(document)) return "none";
    const key = editorDocumentKey(document);
    if (this.partial?.documentKey === key) {
      if (this.partial.sections.has(section)) return "none";
      this.partial.sections.add(section);
      return "render";
    }
    this.partial = { documentKey: key, sections: new Set([section]) };
    return "reload";
  }
}
