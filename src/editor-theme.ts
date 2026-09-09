import { EditorView } from "@codemirror/view";

export const asterlynEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "#dfe1e5",
      backgroundColor: "#1e1f22",
      fontSize: "12px",
    },
    ".cm-content": {
      fontFamily:
        '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      padding: "10px 0 40px",
      caretColor: "#a8c7fa",
    },
    ".cm-line": { padding: "0 14px" },
    ".cm-scroller": { overflow: "auto", lineHeight: "1.62" },
    ".cm-gutters": {
      color: "#6f737b",
      backgroundColor: "#1e1f22",
      borderRight: "1px solid #2b2d30",
    },
    ".cm-activeLineGutter": { backgroundColor: "#26282c" },
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
