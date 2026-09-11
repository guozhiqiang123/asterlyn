import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

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

const asterlynHighlightStyle = HighlightStyle.define([
  {
    tag: tags.comment,
    color: ASTERLYN_SYNTAX_COLORS.comment,
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
    color: ASTERLYN_SYNTAX_COLORS.keyword,
  },
  {
    tag: [tags.string, tags.character, tags.attributeValue],
    color: ASTERLYN_SYNTAX_COLORS.string,
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: ASTERLYN_SYNTAX_COLORS.literal,
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: ASTERLYN_SYNTAX_COLORS.type,
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.variableName),
    ],
    color: ASTERLYN_SYNTAX_COLORS.type,
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: ASTERLYN_SYNTAX_COLORS.property,
  },
  {
    tag: [tags.tagName, tags.labelName],
    color: ASTERLYN_SYNTAX_COLORS.tag,
  },
  {
    tag: [tags.operator, tags.punctuation],
    color: ASTERLYN_SYNTAX_COLORS.punctuation,
  },
  {
    tag: [tags.regexp, tags.escape, tags.url, tags.link],
    color: ASTERLYN_SYNTAX_COLORS.link,
  },
  {
    tag: [tags.meta, tags.processingInstruction, tags.annotation],
    color: ASTERLYN_SYNTAX_COLORS.meta,
  },
  {
    tag: tags.heading,
    color: ASTERLYN_SYNTAX_COLORS.type,
    fontWeight: "700",
  },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.invalid,
    color: ASTERLYN_SYNTAX_COLORS.invalid,
    textDecoration: "underline wavy",
  },
]);

export const asterlynSyntaxHighlighting = syntaxHighlighting(
  asterlynHighlightStyle,
);

export const asterlynEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "#dfe1e5",
      backgroundColor: "#1e1f22",
      fontSize: "var(--editor-font-size, 13px)",
    },
    ".cm-content": {
      fontFamily:
        '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      padding: "10px 0 40px",
      caretColor: "#a8c7fa",
    },
    ".cm-line": { padding: "0 14px 0 0" },
    ".cm-scroller": {
      overflow: "auto",
      lineHeight: "var(--editor-line-height, 1.2)",
    },
    ".cm-gutters": {
      color: "#6f737b",
      backgroundColor: "#1e1f22",
      borderRight: "1px solid #2b2d30",
    },
    ".cm-activeLineGutter": { backgroundColor: "#26282c" },
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
      color: "#a5a9b2",
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
      backgroundColor: "#34363b",
      color: "#d7e3ff",
    },
    ".cm-foldPlaceholder": {
      border: "1px solid #4e5157",
      backgroundColor: "#2b2d30",
      color: "#a8c7fa",
    },
    ".cm-activeLine": { backgroundColor: "#26282c80" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#214283 !important",
    },
    ".cm-searchMatch": { backgroundColor: "#725b19", outline: "none" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#9c7320" },
    ".cm-panels": { backgroundColor: "#2b2d30", color: "#dfe1e5" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid #393b40" },
    ".cm-panel.cm-search": { padding: "6px 10px" },
    ".cm-textfield": {
      backgroundColor: "#1e1f22",
      color: "#dfe1e5",
      border: "1px solid #4e5157",
      borderRadius: "4px",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "#393b40",
      color: "#dfe1e5",
      border: "1px solid #4e5157",
      borderRadius: "4px",
    },
    ".cm-diff-added": { backgroundColor: "#29443666", color: "#b8e2c4" },
    ".cm-diff-removed": { backgroundColor: "#5b2d3266", color: "#f0b8bd" },
    ".cm-diff-hunk": { backgroundColor: "#233d6166", color: "#a8c7fa" },
    ".cm-diff-meta": { color: "#858a94", fontStyle: "italic" },
    ".cm-diff-meta span, .cm-diff-hunk span": {
      color: "inherit !important",
      fontStyle: "inherit",
    },
    ".cm-source-added": { backgroundColor: "#29443670" },
    ".cm-source-removed": { backgroundColor: "#5b2d3270" },
    ".cm-source-spacer": {
      backgroundColor: "#191a1d",
      color: "transparent",
    },
    ".cm-source-omitted": {
      backgroundColor: "#233d6152",
      color: "#8eb4ef",
      fontStyle: "italic",
    },
    ".cm-source-notice": {
      color: "#a4a7ae",
      fontStyle: "italic",
    },
    ".cm-source-word-added": {
      borderRadius: "2px",
      backgroundColor: "#397b4eaa",
    },
    ".cm-source-word-removed": {
      borderRadius: "2px",
      backgroundColor: "#94424aaa",
    },
  },
  { dark: true },
);
