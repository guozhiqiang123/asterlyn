import type { EditorState } from "@codemirror/state";
import {
  foldNodeProp,
  foldService,
  LanguageSupport,
  LRLanguage,
  syntaxTree,
} from "@codemirror/language";
import type { Tree } from "@lezer/common";

export const LEGACY_STRUCTURAL_FOLD_MAX_CODE_UNITS = 1024 * 1024;

interface FoldRange {
  from: number;
  to: number;
}

interface BraceFoldCache {
  tree: Tree;
  ranges: ReadonlyMap<number, FoldRange>;
}

const braceFoldCache = new WeakMap<EditorState, BraceFoldCache>();
const ignoredBraceNode = /comment|string|regexp/iu;

/**
 * Adds bounded syntax-only folding where the language catalog exposes only a
 * legacy stream tokenizer. This remains an editor adapter and does not imply
 * semantic language intelligence.
 */
export function withEditorFolding(
  languageName: string,
  support: LanguageSupport,
): LanguageSupport {
  if (languageName === "Kotlin" || languageName === "Groovy") {
    return new LanguageSupport(support.language, [
      support.support,
      foldService.of(legacyBraceFold),
    ]);
  }

  if (languageName === "XML" && support.language instanceof LRLanguage) {
    const language = support.language.configure({
      props: [
        foldNodeProp.add({
          Element: () => null,
        }),
      ],
    });
    return new LanguageSupport(language, [
      support.support,
      foldService.of(xmlFirstLineFold),
    ]);
  }

  return support;
}

function legacyBraceFold(
  state: EditorState,
  lineStart: number,
): FoldRange | null {
  if (state.doc.length > LEGACY_STRUCTURAL_FOLD_MAX_CODE_UNITS) return null;
  const tree = syntaxTree(state);
  const cached = braceFoldCache.get(state);
  if (cached?.tree === tree) return cached.ranges.get(lineStart) ?? null;

  const ranges = collectBraceFolds(state, tree);
  braceFoldCache.set(state, { tree, ranges });
  return ranges.get(lineStart) ?? null;
}

function collectBraceFolds(
  state: EditorState,
  tree: Tree,
): ReadonlyMap<number, FoldRange> {
  const ignored: FoldRange[] = [];
  tree.iterate({
    enter(node) {
      if (!ignoredBraceNode.test(node.name) || node.from === node.to) return;
      ignored.push({ from: node.from, to: node.to });
      return false;
    },
  });

  const parsedLength = Math.min(tree.length, state.doc.length);
  const text = state.sliceDoc(0, parsedLength);
  const stack: Array<{ position: number; lineStart: number; lineEnd: number }> = [];
  const candidates: Array<{ lineStart: number; position: number; range: FoldRange }> = [];
  let ignoredIndex = 0;

  for (let position = 0; position < text.length; position += 1) {
    while (ignoredIndex < ignored.length && ignored[ignoredIndex]!.to <= position) {
      ignoredIndex += 1;
    }
    const ignoredRange = ignored[ignoredIndex];
    if (
      ignoredRange &&
      ignoredRange.from <= position &&
      position < ignoredRange.to
    ) {
      position = ignoredRange.to - 1;
      continue;
    }

    if (text[position] === "{") {
      const line = state.doc.lineAt(position);
      stack.push({ position, lineStart: line.from, lineEnd: line.to });
    } else if (text[position] === "}" && stack.length > 0) {
      const opening = stack.pop()!;
      if (position > opening.lineEnd) {
        candidates.push({
          lineStart: opening.lineStart,
          position: opening.position,
          range: { from: opening.position + 1, to: position },
        });
      }
    }
  }

  candidates.sort((left, right) => left.position - right.position);
  const ranges = new Map<number, FoldRange>();
  for (const candidate of candidates) {
    if (!ranges.has(candidate.lineStart)) {
      ranges.set(candidate.lineStart, candidate.range);
    }
  }
  return ranges;
}

function xmlFirstLineFold(
  state: EditorState,
  lineStart: number,
  lineEnd: number,
): FoldRange | null {
  const tree = syntaxTree(state);
  if (tree.length < lineEnd) return null;
  let range: FoldRange | null = null;
  tree.iterate({
    from: lineStart,
    to: lineEnd,
    enter(reference) {
      if (range || reference.name !== "Element") return;
      if (reference.from < lineStart || reference.from > lineEnd) return;
      const first = reference.node.firstChild;
      const last = reference.node.lastChild;
      if (!first || first.name !== "OpenTag" || !last || last.name !== "CloseTag") {
        return false;
      }
      if (last.from > lineEnd) range = { from: lineEnd, to: last.from };
      return false;
    },
  });
  return range;
}
