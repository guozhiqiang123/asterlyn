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
    ".cm-activeLineGutter": { backgroundColor: "var(--editor-active-line)" },
    ".cm-git-blame-gutter": {
      minWidth: "260px",
      color: "var(--text-muted)",
      backgroundColor: "var(--bg-deep)",
    },
    ".cm-git-blame-gutter .cm-gutterElement": {
      boxSizing: "border-box",
      width: "100%",
      padding: "0 8px",
    },
    ".cm-git-blame-marker": {
      display: "grid",
      gridTemplateColumns: "max-content minmax(0, 1fr)",
      gap: "8px",
      width: "100%",
      maxWidth: "266px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      cursor: "help",
    },
    ".cm-git-blame-time": {
      overflow: "hidden",
      textAlign: "left",
      textOverflow: "ellipsis",
    },
    ".cm-git-blame-author": {
      overflow: "hidden",
      textAlign: "right",
      textOverflow: "ellipsis",
    },
    ".cm-git-blame-tone-0": {
      backgroundColor: "color-mix(in srgb, var(--graph-1) 10%, var(--bg-deep))",
    },
    ".cm-git-blame-tone-1": {
      backgroundColor: "color-mix(in srgb, var(--graph-2) 10%, var(--bg-deep))",
    },
    ".cm-git-blame-tone-2": {
      backgroundColor: "color-mix(in srgb, var(--graph-3) 10%, var(--bg-deep))",
    },
    ".cm-git-blame-tone-3": {
      backgroundColor: "color-mix(in srgb, var(--graph-4) 10%, var(--bg-deep))",
    },
    ".cm-git-blame-local": {
      backgroundColor: "color-mix(in srgb, var(--file-modified) 18%, var(--bg-deep))",
    },
    ".cm-git-blame-uncommitted": {
      color: "var(--warning-text)",
      fontStyle: "italic",
    },
    ".cm-foldGutter": { width: "19px" },
    ".cm-change-indicator-gutter, .cm-changeGutter": {
      width: "5px",
      minWidth: "5px",
      backgroundColor: "var(--bg-deep)",
      paddingLeft: "0",
      paddingRight: "0",
    },
    ".cm-change-indicator-gutter .cm-gutterElement, .cm-changeGutter .cm-gutterElement": {
      boxSizing: "border-box",
      width: "5px",
      minWidth: "5px",
      padding: "0",
    },
    ".cm-change-gutter-spacer, .cm-change-gutter-marker": {
      display: "block",
      width: "5px",
      height: "100%",
      minHeight: "var(--editor-line-height, 1.35em)",
    },
    ".cm-change-gutter-element.cm-change-added": { backgroundColor: "var(--file-added)" },
    ".cm-change-gutter-element.cm-change-modified": { backgroundColor: "var(--file-modified)" },
    ".cm-change-gutter-element.cm-change-deleted": {
      color: "var(--file-deleted)",
      backgroundColor: "transparent",
    },
    ".cm-change-gutter-element.cm-change-deleted .cm-change-gutter-marker": {
      display: "grid",
      alignItems: "center",
      overflow: "visible",
      fontSize: "10px",
      fontWeight: "800",
      lineHeight: "1",
    },
    ".cm-change-overview-ruler": {
      position: "absolute",
      zIndex: "8",
      top: "2px",
      right: "14px",
      bottom: "2px",
      width: "5px",
      pointerEvents: "none",
    },
    ".cm-change-overview-marker": {
      position: "absolute",
      right: "0",
      width: "5px",
      minWidth: "0",
      minHeight: "5px",
      padding: "0",
      border: "0",
      borderRadius: "1px",
      pointerEvents: "auto",
      cursor: "pointer",
    },
    ".cm-change-overview-marker:hover, .cm-change-overview-marker:focus-visible": {
      width: "7px",
      outline: "1px solid var(--focus-ring)",
      outlineOffset: "1px",
    },
    ".cm-change-overview-marker.cm-change-added": { backgroundColor: "var(--file-added)" },
    ".cm-change-overview-marker.cm-change-modified": { backgroundColor: "var(--file-modified)" },
    ".cm-change-overview-marker.cm-change-deleted": { backgroundColor: "var(--file-deleted)" },
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
    ".asterlyn-search-panel": {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "5px",
    },
    ".asterlyn-search-input-shell, .asterlyn-search-replace-shell": {
      display: "flex",
      boxSizing: "border-box",
      minWidth: "190px",
      flex: "1 1 300px",
      alignItems: "center",
      border: "1px solid var(--border-strong)",
      borderRadius: "5px",
      backgroundColor: "var(--bg-deep)",
    },
    ".asterlyn-search-input-shell:focus-within, .asterlyn-search-replace-shell:focus-within": {
      borderColor: "var(--focus-ring)",
      boxShadow: "0 0 0 1px color-mix(in srgb, var(--focus-ring) 32%, transparent)",
    },
    ".asterlyn-search-input-shell input, .asterlyn-search-replace-shell input": {
      boxSizing: "border-box",
      minWidth: "70px",
      height: "27px",
      flex: "1 1 auto",
      padding: "0 7px",
      border: "0",
      outline: "0",
      backgroundColor: "transparent",
      color: "var(--text)",
      fontFamily: "var(--editor-font-family)",
      fontSize: "11px",
    },
    ".asterlyn-search-option-strip, .asterlyn-search-actions, .asterlyn-search-replace-row": {
      display: "flex",
      alignItems: "center",
      gap: "2px",
    },
    ".asterlyn-search-option-strip": { paddingRight: "3px" },
    ".asterlyn-search-replace-row": {
      width: "100%",
      paddingRight: "34px",
    },
    ".asterlyn-search-panel button": {
      boxSizing: "border-box",
      minWidth: "25px",
      height: "25px",
      padding: "0 5px",
      border: "1px solid transparent",
      borderRadius: "4px",
      backgroundColor: "transparent",
      color: "var(--text-muted)",
      cursor: "pointer",
      fontFamily: "var(--editor-font-family)",
      fontSize: "10px",
    },
    ".asterlyn-search-panel button:hover": {
      borderColor: "var(--border-strong)",
      backgroundColor: "var(--bg-hover)",
      color: "var(--text)",
    },
    ".asterlyn-search-option-strip button[aria-pressed=true]": {
      borderColor: "var(--info-border)",
      backgroundColor: "var(--accent)",
      color: "white",
    },
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
    "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
      backgroundColor: "var(--editor-diff-removed-bg)",
    },
    "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
      backgroundColor: "var(--editor-diff-added-bg)",
    },
    "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-changedText": {
      background: "transparent",
    },
    ".cm-insertedLine, .cm-deletedLine, .cm-deletedLine del": {
      textDecoration: "none",
    },
    ".cm-source-added": { backgroundColor: "var(--editor-diff-added-bg)" },
    ".cm-source-removed": { backgroundColor: "var(--editor-diff-removed-bg)" },
    ".cm-source-added-gutter": { backgroundColor: "var(--editor-diff-added-bg)" },
    ".cm-source-removed-gutter": { backgroundColor: "var(--editor-diff-removed-bg)" },
    ".cm-source-spacer-gutter": { backgroundColor: "var(--surface-editor-secondary)" },
    ".cm-source-omitted-gutter": { backgroundColor: "var(--info-bg)" },
    ".cm-git-blame-gutter .cm-gutterElement.cm-activeLineGutter:not(.cm-source-added-gutter):not(.cm-source-removed-gutter):not(.cm-source-spacer-gutter):not(.cm-source-omitted-gutter)": {
      backgroundColor: "var(--editor-active-line)",
    },
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
    // CodeMirror's merged-view collapsed-row widget is a real element with its own base-theme rule, so
    // the app restates it with its tokens: a dim band that reads as a system hint instead of code.
    ".cm-collapsedLines": {
      color: "var(--info-text)",
      background: "linear-gradient(to bottom, transparent 0, var(--info-bg) 30%, var(--info-bg) 70%, transparent 100%)",
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
      boxShadow: "inset 1px 0 0 var(--focus-ring-bright), inset -1px 0 0 var(--focus-ring-bright)",
    },
    ".cm-diff-current-change-start": {
      boxShadow: "inset 1px 0 0 var(--focus-ring-bright), inset -1px 0 0 var(--focus-ring-bright), inset 0 1px 0 var(--focus-ring-bright)",
    },
    ".cm-diff-current-change-end": {
      boxShadow: "inset 1px 0 0 var(--focus-ring-bright), inset -1px 0 0 var(--focus-ring-bright), inset 0 -1px 0 var(--focus-ring-bright)",
    },
    ".cm-diff-current-change-start.cm-diff-current-change-end": {
      boxShadow: "inset 1px 0 0 var(--focus-ring-bright), inset -1px 0 0 var(--focus-ring-bright), inset 0 1px 0 var(--focus-ring-bright), inset 0 -1px 0 var(--focus-ring-bright)",
    },
    ".cm-highlightSpace": {
      backgroundImage: "radial-gradient(circle at center, var(--editor-whitespace) 0, var(--editor-whitespace) 0.9px, transparent 1.5px)",
      backgroundPosition: "center",
      backgroundSize: "1ch 100%",
      backgroundRepeat: "repeat-x",
    },
    ".cm-highlightTab": {
      backgroundImage: "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"20\"><path stroke=\"%236f737b\" stroke-opacity=\"0.55\" stroke-width=\"1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\" d=\"M1 10H196L190 5M190 15L196 10\"/></svg>')",
      backgroundSize: "auto 100%",
      backgroundPosition: "right 90%",
      backgroundRepeat: "no-repeat",
    },
    ".cm-trailingSpace": {
      backgroundColor: "color-mix(in srgb, var(--danger-border) 35%, transparent)",
    },
  };

const editorThemes = {
  dark: EditorView.theme(editorThemeRules, { dark: true }),
  light: EditorView.theme(editorThemeRules, { dark: false }),
} as const;

export function asterlynEditorTheme(theme: EffectiveTheme) {
  return editorThemes[theme];
}
