import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { EffectiveTheme } from "./presentation/presentation-environment.ts";

export const ASTERLYN_SYNTAX_COLORS = {
  comment: "#8c919b",
  keyword: "#cf8e6d",
  string: "#6aab73",
  literal: "#2aacb8",
  type: "#56a8f5",
  property: "#c77dbb",
  tag: "#e8bf6a",
  punctuation: "#bcbec4",
  link: "#42c3d4",
  meta: "#bbb529",
  invalid: "#ff6666",
} as const;

export const ASTERLYN_LIGHT_SYNTAX_COLORS = {
  comment: "#69717d",
  keyword: "#a14218",
  string: "#26733a",
  literal: "#087987",
  type: "#1769a8",
  property: "#8a3f82",
  tag: "#8a5d00",
  punctuation: "#444950",
  link: "#006f7e",
  meta: "#746d00",
  invalid: "#b71c1c",
} as const;

const syntaxColor = {
  comment: "var(--syntax-comment)",
  keyword: "var(--syntax-keyword)",
  string: "var(--syntax-string)",
  literal: "var(--syntax-literal)",
  type: "var(--syntax-type)",
  property: "var(--syntax-property)",
  tag: "var(--syntax-tag)",
  punctuation: "var(--syntax-punctuation)",
  link: "var(--syntax-link)",
  meta: "var(--syntax-meta)",
  invalid: "var(--syntax-invalid)",
} as const;

const asterlynHighlightStyle = HighlightStyle.define([
  {
    tag: tags.comment,
    color: syntaxColor.comment,
    fontStyle: "italic",
  },
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
    ],
    color: syntaxColor.keyword,
  },
  {
    tag: [tags.string, tags.character, tags.attributeValue],
    color: syntaxColor.string,
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: syntaxColor.literal,
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: syntaxColor.type,
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.variableName),
    ],
    color: syntaxColor.type,
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: syntaxColor.property,
  },
  {
    tag: [tags.tagName, tags.labelName],
    color: syntaxColor.tag,
  },
  {
    tag: [tags.operator, tags.punctuation],
    color: syntaxColor.punctuation,
  },
  {
    tag: [tags.regexp, tags.escape, tags.url, tags.link],
    color: syntaxColor.link,
  },
  {
    tag: [tags.meta, tags.processingInstruction, tags.annotation],
    color: syntaxColor.meta,
  },
  {
    tag: tags.heading,
    color: syntaxColor.type,
    fontWeight: "700",
  },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.invalid,
    color: syntaxColor.invalid,
    textDecoration: "underline wavy",
  },
]);

export const asterlynSyntaxHighlighting = syntaxHighlighting(
  asterlynHighlightStyle,
);

const editorThemeRules =
  {
    "&": {
      height: "100%",
      color: "var(--text)",
      backgroundColor: "var(--bg-deep)",
      fontFamily: "var(--editor-font-family)",
      fontSize: "var(--editor-font-size, 14px)",
      fontWeight: "400",
      fontKerning: "none",
      fontVariantLigatures: "none",
      fontFeatureSettings: '"liga" 0, "calt" 0',
      fontSynthesis: "none",
    },
    ".cm-content": {
      fontFamily: "var(--editor-font-family)",
      letterSpacing: "var(--editor-letter-spacing, 0px)",
      padding: "10px 0 40px",
      caretColor: "var(--editor-caret)",
    },
    ".cm-gutter": {
      fontFamily: "var(--editor-font-family)",
    },
    ".cm-line": { padding: "0 14px 0 0" },
    ".cm-scroller": {
      overflow: "auto",
      lineHeight: "var(--editor-line-height, 1.35)",
    },
    ".cm-gutters": {
      color: "var(--editor-gutter-text)",
      backgroundColor: "var(--bg-deep)",
      borderRight: "1px solid var(--bg-panel)",
    },
    ".cm-activeLineGutter": { backgroundColor: "var(--bg-hover)" },
    ".cm-foldGutter": { width: "19px" },
    ".cm-foldGutter .cm-gutterElement": {
      boxSizing: "border-box",
      width: "19px",
      padding: "1px",
    },
    ".asterlyn-fold-marker": {
      display: "inline-grid",
      boxSizing: "border-box",
      width: "17px",
      height: "18px",
      placeItems: "center",
      borderRadius: "3px",
      color: "var(--text-muted)",
      cursor: "pointer",
      verticalAlign: "top",
    },
    ".asterlyn-fold-marker svg": {
      width: "14px",
      height: "14px",
      fill: "none",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: "1.7",
      pointerEvents: "none",
    },
    ".cm-foldGutter .cm-gutterElement:hover .asterlyn-fold-marker": {
      backgroundColor: "var(--bg-hover)",
      color: "var(--info-text)",
    },
    ".cm-foldPlaceholder": {
      border: "1px solid var(--border-strong)",
      backgroundColor: "var(--bg-panel)",
      color: "var(--info-text)",
    },
    ".cm-activeLine": { backgroundColor: "var(--editor-active-line)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--editor-selection) !important",
    },
    ".cm-searchMatch": { backgroundColor: "var(--editor-search)", outline: "none" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--editor-search-selected)" },
    ".cm-panels": { backgroundColor: "var(--bg-panel)", color: "var(--text)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
    ".cm-panel.cm-search": { padding: "6px 10px" },
    ".cm-textfield": {
      backgroundColor: "var(--bg-deep)",
      color: "var(--text)",
      border: "1px solid var(--border-strong)",
      borderRadius: "4px",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--bg-elevated)",
      color: "var(--text)",
      border: "1px solid var(--border-strong)",
      borderRadius: "4px",
    },
    ".cm-diff-added": { backgroundColor: "var(--editor-diff-added-bg)", color: "var(--editor-diff-added-text)" },
    ".cm-diff-removed": { backgroundColor: "var(--editor-diff-removed-bg)", color: "var(--editor-diff-removed-text)" },
    ".cm-diff-hunk": { backgroundColor: "var(--editor-diff-hunk-bg)", color: "var(--editor-diff-hunk-text)" },
    ".cm-diff-meta": { color: "var(--editor-diff-meta)", fontStyle: "italic" },
    ".cm-diff-meta span, .cm-diff-hunk span": {
      color: "inherit !important",
      fontStyle: "inherit",
    },
    ".cm-source-added": { backgroundColor: "var(--editor-diff-added-bg)" },
    ".cm-source-removed": { backgroundColor: "var(--editor-diff-removed-bg)" },
    ".cm-source-spacer": {
      backgroundColor: "var(--surface-editor-secondary)",
      color: "transparent",
    },
    ".cm-source-omitted": {
      backgroundColor: "var(--info-bg)",
      color: "var(--info-text)",
      fontStyle: "italic",
    },
    ".cm-source-notice": {
      color: "var(--text-muted)",
      fontStyle: "italic",
    },
    ".cm-source-word-added": {
      borderRadius: "2px",
      backgroundColor: "var(--editor-intraline-added)",
    },
    ".cm-source-word-removed": {
      borderRadius: "2px",
      backgroundColor: "var(--editor-intraline-removed)",
    },
    ".cm-diff-current-change": {
      boxShadow: "inset 3px 0 0 var(--focus-ring-bright), inset -1px 0 0 var(--focus-ring)",
    },
    ".cm-diff-current-change-start": {
      boxShadow: "inset 3px 0 0 var(--focus-ring-bright), inset -1px 0 0 var(--focus-ring), inset 0 1px 0 var(--focus-ring)",
    },
    ".cm-diff-current-change-end": {
      boxShadow: "inset 3px 0 0 var(--focus-ring-bright), inset -1px 0 0 var(--focus-ring), inset 0 -1px 0 var(--focus-ring)",
    },
    ".cm-diff-current-change-start.cm-diff-current-change-end": {
      boxShadow: "inset 3px 0 0 var(--focus-ring-bright), inset -1px 0 0 var(--focus-ring), inset 0 1px 0 var(--focus-ring), inset 0 -1px 0 var(--focus-ring)",
    },
  };

const editorThemes = {
  dark: EditorView.theme(editorThemeRules, { dark: true }),
  light: EditorView.theme(editorThemeRules, { dark: false }),
} as const;

export function asterlynEditorTheme(theme: EffectiveTheme) {
  return editorThemes[theme];
}
