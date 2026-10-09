import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ownedStyles = [
  ["styles.css", "bootstrap.ts"],
  ["startup-failure.css", "bootstrap.ts"],
  ["shared/layout.css", "main.ts"],
  ["shared/controls.css", "main.ts"],
  ["shared/select-control.css", "main.ts"],
  ["shared/presentation.css", "main.ts"],
  ["shared/content.css", "main.ts"],
  ["shared/overlays.css", "main.ts"],
  ["shared/context-menu/context-menu.css", "main.ts"],
  ["shared/responsive.css", "main.ts"],
  ["shell/shell.css", "main.ts"],
  ["features/settings/settings.css", "main.ts"],
  ["features/changes-commit/changes-commit.css", "main.ts"],
  ["features/files-editor/project-files.css", "main.ts"],
  ["features/files-editor/welcome.css", "main.ts"],
  ["features/files-editor/files-editor.css", "main.ts"],
  ["features/files-editor/editable-diff.css", "main.ts"],
  ["features/files-editor/change-overview.css", "main.ts"],
  ["shared/diff-review.css", "main.ts"],
  ["features/files-editor/workspace-search.css", "main.ts"],
  ["features/files-editor/workspace-replacement-tool.css", "main.ts"],
  ["features/git-history/git-history.css", "main.ts"],
  ["features/git-history/history.css", "main.ts"],
  ["features/git-history/branches.css", "main.ts"],
  ["features/git-history/branch-mutation.css", "main.ts"],
  ["features/git-history/git-reset.css", "main.ts"],
  ["features/git-history/commit-file-restore.css", "main.ts"],
  ["features/git-history/details.css", "main.ts"],
  ["features/git-stash/stash.css", "main.ts"],
  ["features/remote-push/remote-push.css", "main.ts"],
  ["features/remote-push/push-dialog-layout.css", "main.ts"],
  ["features/remote-push/remote-authentication.css", "main.ts"],
  ["features/remote-push/remote-management.css", "main.ts"],
  ["features/git-operations/git-operation-controls.css", "main.ts"],
  ["features/git-operations/conflict-editor.css", "main.ts"],
  [
    "features/git-operations/git-operations.css",
    "features/git-operations/git-operation-dialog-entry.ts",
  ],
];

const sourceRoot = path.resolve(import.meta.dirname, "../src");

test("every production stylesheet has exactly one declared entry point", async () => {
  const styles = (await filesWithExtension(sourceRoot, ".css"))
    .map((file) => portablePath(path.relative(sourceRoot, file)))
    .sort();
  const declarations = ownedStyles.map(([style]) => style).sort();
  assert.deepEqual(declarations, styles, "ownedStyles must enumerate every src stylesheet exactly once");

  const imports = await stylesheetImports(await filesWithExtension(sourceRoot, ".ts"));
  for (const [style, expectedOwner] of ownedStyles) {
    assert.deepEqual(
      imports.get(style) ?? [],
      [expectedOwner],
      `${style} must be imported by exactly ${expectedOwner}`,
    );
  }
});

test("owned styles remain below the architecture decomposition trigger", async () => {
  for (const [path] of ownedStyles) {
    const source = await readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
    const lines = source.split("\n").length;
    assert.ok(lines <= 800, `${path} has ${lines} lines`);
  }
});

test("scrollbar hit targets share the global 12px size token", async () => {
  const [tokens, overlays, editableDiff, replacementTool] = await Promise.all([
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/overlays.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/editable-diff.css", import.meta.url), "utf8"),
    readFile(
      new URL("../src/features/files-editor/workspace-replacement-tool.css", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(tokens, /--scrollbar-size:\s*12px;/u);
  assert.match(
    overlays,
    /::\-webkit-scrollbar\s*\{[^}]*width:\s*var\(--scrollbar-size\);[^}]*height:\s*var\(--scrollbar-size\);/s,
  );
  for (const source of [editableDiff, replacementTool]) {
    assert.match(
      source,
      /\.editable-diff-scrollbar-pane\s*\{[^}]*height:\s*var\(--scrollbar-size\);/s,
    );
  }
});

test("each owned stylesheet has one explicit entry point", async () => {
  for (const [path, owner] of ownedStyles) {
    const source = await readFile(new URL(`../src/${owner}`, import.meta.url), "utf8");
    const ownerDirectory = owner.includes("/") ? owner.slice(0, owner.lastIndexOf("/") + 1) : "";
    const relativePath = path.startsWith(ownerDirectory)
      ? `./${path.slice(ownerDirectory.length)}`
      : `./${path}`;
    assert.match(
      source,
      new RegExp(`import ["']${escapeRegExp(relativePath)}["']`),
      `${path} is not installed by ${owner}`,
    );
  }
});

test("native macOS chrome keeps the trailing settings action inset from the window edge", async () => {
  const source = await readFile(new URL("../src/shell/shell.css", import.meta.url), "utf8");
  assert.match(
    source,
    /\.platform-macos-native \.topbar-actions\s*\{[^}]*padding-right:\s*8px;/s,
  );
});

test("bottom tool close stays right-aligned when feature actions are hidden", async () => {
  const source = await readFile(new URL("../src/shared/layout.css", import.meta.url), "utf8");
  assert.match(source, /\.bottom-tool-hide\s*\{[^}]*margin-left:\s*auto;/s);
  assert.match(
    source,
    /\.terminal-header-actions:not\(\.hidden\)\s*\+\s*\.git-operation-open\.hidden\s*\+\s*\.bottom-tool-hide\s*\{[^}]*margin-left:\s*0;/s,
  );
});

test("keyboard shortcut keycaps use one UI font metric independent of editor preferences", async () => {
  const source = await readFile(
    new URL("../src/features/settings/settings.css", import.meta.url),
    "utf8",
  );
  const keycaps = source.match(
    /\.keybinding-pill kbd,\s*\.keybinding-recorder-input kbd\s*\{([^}]*)\}/s,
  )?.[1] ?? "";

  assert.match(keycaps, /font-family:\s*-apple-system, BlinkMacSystemFont,/);
  assert.match(keycaps, /font-size:\s*var\(--ui-font-size, 13px\);/);
  assert.match(keycaps, /font-weight:\s*500;/);
  assert.match(keycaps, /line-height:\s*1;/);
  assert.doesNotMatch(keycaps, /--editor-font-family|monospace/);
});

test("project folders use the same configured UI scale as files", async () => {
  const [source, shared] = await Promise.all([
    readFile(new URL("../src/features/files-editor/project-files.css", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/presentation.css", import.meta.url), "utf8"),
  ]);
  assert.match(shared, /--compact-file-tree-font-size:\s*var\(--ui-font-size, 13px\);/u);
  assert.match(
    source,
    /\.project-directory > summary,[^{]*\{[^}]*font-size:\s*var\(--compact-file-tree-font-size\);/s,
  );
});

test("every file tree surface opts into the shared compact density and typography", async () => {
  const [
    projectView,
    changesView,
    findView,
    replacementRuntime,
    historyView,
    historyDialog,
    stashView,
    pushView,
    changesCss,
    findCss,
    historyCss,
    pushCss,
  ] = await Promise.all([
    readFile(new URL("../src/features/files-editor/project-files-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/changes-commit/changes-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/find-results-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/workspace-replacement-presentation-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/git-detail-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/history-dialog-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-stash/stash-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/remote-push/remote-push-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/changes-commit/changes-commit.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/workspace-search.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/history.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/remote-push/remote-push.css", import.meta.url), "utf8"),
  ]);

  assert.match(projectView, /project-tree compact-file-tree/u);
  assert.match(changesView, /change-list compact-file-tree/u);
  assert.match(findView, /find-file-list compact-file-tree/u);
  assert.match(replacementRuntime, /replacement-tool-file-list compact-file-tree/u);
  assert.match(historyView, /commit-file-list compact-file-tree/u);
  assert.match(historyDialog, /history-path-tree compact-file-tree/u);
  assert.match(stashView, /stash-files commit-file-list compact-file-tree/u);
  assert.match(pushView, /push-file-list compact-file-tree/u);

  for (const [name, css, selector] of [
    ["Changes", changesCss, ".change-directory-row"],
    ["Find", findCss, ".find-file-row"],
    ["history path filter", historyCss, ".history-path-tree-row"],
    ["Push", pushCss, ".push-file-row"],
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      css,
      new RegExp(`${escaped}[^\\{]*\\{[^}]*height:\\s*var\\(--compact-file-tree-row-height\\);[^}]*font-size:\\s*var\\(--compact-file-tree-font-size\\);[^}]*font-weight:\\s*var\\(--compact-file-tree-font-weight\\);`, "s"),
      `${name} file rows must consume the shared tree tokens`,
    );
  }
});

test("Push mode remains one aligned split action with a visible native-scale chevron", async () => {
  const source = await readFile(
    new URL("../src/features/remote-push/remote-push.css", import.meta.url),
    "utf8",
  );
  assert.match(source, /\.push-split-action\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*stretch;/s);
  assert.match(source, /\.push-mode-chevron\s*\{[^}]*border-right:\s*1\.5px solid currentColor;[^}]*transform:\s*rotate\(45deg\);/s);
  // The shared primary-button surface is evaluated after the feature stylesheets, so the split
  // declarations must outrank it by scope instead of relying on source order.
  assert.match(source, /\.push-split-action \.push-primary-action\s*\{[^}]*border-right:\s*0;[^}]*border-radius:\s*5px 0 0 5px;/s);
  assert.match(source, /\.push-split-action \.push-mode-toggle\s*\{[^}]*padding:\s*0;[^}]*border-radius:\s*0 5px 5px 0;/s);
  assert.match(source, /\.push-split-action \.push-mode-chevron\s*\{/u);
});

test("Push Diff covers the parent preview splitter", async () => {
  const [push, shell] = await Promise.all([
    readFile(new URL("../src/features/remote-push/remote-push.css", import.meta.url), "utf8"),
    readFile(new URL("../src/shell/shell.css", import.meta.url), "utf8"),
  ]);
  const splitterLayer = Number(
    shell.match(/\.workbench-splitter\s*\{[^}]*z-index:\s*(\d+);/s)?.[1],
  );
  const diffLayer = Number(
    push.match(/\.push-diff-backdrop\s*\{[^}]*z-index:\s*(\d+);/s)?.[1],
  );
  assert.ok(Number.isFinite(splitterLayer), "the shared splitter must declare its layer");
  assert.ok(Number.isFinite(diffLayer), "the nested Push Diff must declare its layer");
  assert.ok(
    diffLayer > splitterLayer,
    "the nested Push Diff must paint above the parent preview splitter",
  );
});

test("both project search fields keep one query field with flat in-field option segments", async () => {
  const [shell, search, history] = await Promise.all([
    readFile(new URL("../src/shell/shell.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/workspace-search.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/history.css", import.meta.url), "utf8"),
  ]);
  // The command surface matches the Git History search control: a neutral border that only lights up
  // while the field owns focus, and contiguous segments separated by 1px dividers.
  assert.match(shell, /\.command-surface-input\s*\{[^}]*border:\s*1px solid var\(--border-strong\);/s);
  assert.doesNotMatch(shell, /\.command-surface-input\s*\{[^}]*box-shadow/s);
  assert.match(shell, /\.command-surface-input:focus-within\s*\{[^}]*border-color:\s*var\(--focus-ring\);[^}]*box-shadow:\s*0 0 0 1px var\(--focus-ring\);/s);
  assert.match(shell, /\.command-surface-input textarea\s*\{/u);
  assert.doesNotMatch(shell, /\.command-surface-input input\s*\{/u);
  assert.match(search, /\.command-surface-input \.search-option-strip\s*\{[^}]*gap:\s*0;/s);
  assert.match(search, /\.workspace-search-mode\s*\{[^}]*border-left:\s*1px solid var\(--border\);[^}]*border-radius:\s*0;/s);
  assert.match(history, /\.history-mode-button\s*\{[^}]*border-left:\s*1px solid var\(--border\);[^}]*border-radius:\s*0;/s);
});

test("command-surface Find action keeps breathing room from hints and dialog edges", async () => {
  const shell = await readFile(new URL("../src/shell/shell.css", import.meta.url), "utf8");
  const search = await readFile(new URL("../src/features/files-editor/workspace-search.css", import.meta.url), "utf8");
  assert.match(shell, /\.command-surface-footer\s*\{[^}]*padding:\s*4px 12px;/s);
  assert.match(search, /\.command-surface-footer-actions\s*\{[^}]*gap:\s*16px;/s);
  assert.match(search, /\.command-surface-find-button\s*\{[^}]*height:\s*28px;[^}]*padding:\s*0 12px;/s);
});

test("replacement preview keeps matched text in the surrounding line flow", async () => {
  const search = await readFile(new URL("../src/features/files-editor/workspace-search.css", import.meta.url), "utf8");
  assert.match(search, /\.replacement-comparison code\s*\{[^}]*display:\s*block;/s);
  assert.doesNotMatch(search, /\.replacement-comparison code\s*\{[^}]*display:\s*grid;/s);
  assert.match(search, /\.replacement-comparison code span\s*\{[^}]*display:\s*block;/s);
});

test("replacement window owns one horizontal scrollbar and compact patch controls", async () => {
  const [replacement, runtime, shared, project, history] = await Promise.all([
    readFile(
      new URL("../src/features/files-editor/workspace-replacement-tool.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/features/files-editor/workspace-replacement-presentation-runtime.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/shared/presentation.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/project-files.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-history/details.css", import.meta.url), "utf8"),
  ]);
  assert.match(replacement, /\.cm-mergeView \.cm-scroller\s*\{[^}]*scrollbar-width:\s*none;/s);
  assert.match(replacement, /\.cm-scroller::\-webkit-scrollbar\s*\{[^}]*display:\s*none;/s);
  assert.match(replacement, /\.cm-merge-revert\s*\{[^}]*width:\s*36px;[^}]*flex:\s*0 0 36px;/s);
  assert.match(replacement, /--diff-change-control-width:\s*28px;/u);
  assert.match(shared, /\.compact-file-tree\s*\{[^}]*--compact-file-tree-row-height:\s*25px;[^}]*--compact-file-tree-row-gap:\s*4px;[^}]*--compact-file-tree-font-size:\s*var\(--ui-font-size, 13px\);[^}]*--compact-file-tree-font-weight:\s*400;/s);
  assert.match(project, /\.project-directory > summary,[^{]*\{[^}]*gap:\s*var\(--compact-file-tree-row-gap\);[^}]*font-size:\s*var\(--compact-file-tree-font-size\);[^}]*font-weight:\s*var\(--compact-file-tree-font-weight\);/s);
  assert.match(replacement, /\.replacement-tool-file\s*\{[^}]*height:\s*var\(--compact-file-tree-row-height\);[^}]*color:\s*var\(--compact-file-tree-color\);[^}]*font-size:\s*var\(--compact-file-tree-font-size\);[^}]*font-weight:\s*var\(--compact-file-tree-font-weight\);/s);
  assert.match(history, /\.commit-file-row\s*\{[^}]*height:\s*var\(--compact-file-tree-row-height\);[^}]*gap:\s*var\(--compact-file-tree-row-gap\);[^}]*font-size:\s*var\(--compact-file-tree-font-size\);[^}]*font-weight:\s*var\(--compact-file-tree-font-weight\);/s);
  assert.match(history, /\.commit-file-directory > summary\s*\{[^}]*font-size:\s*var\(--compact-file-tree-font-size\);[^}]*font-weight:\s*var\(--compact-file-tree-font-weight\);/s);
  assert.match(replacement, /\.replacement-node-label\s*\{[^}]*font-weight:\s*inherit;/s);
  assert.ok(runtime.indexOf('id="replacement-tool-review"') < runtime.indexOf('id="replacement-tool-save"'));
  assert.match(runtime, /replacement-tool-save hidden/);
  assert.match(runtime, /save\.classList\.toggle\("hidden", !dirty\)/u);
  assert.equal((runtime.match(/replacement-tool-file-list compact-file-tree/g) ?? []).length, 2);
  assert.match(replacement, /\.replacement-tool-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, var\(--replacement-list-width\)\) 5px minmax\(0, 1fr\);/s);
  assert.match(replacement, /\.replacement-tool-summary input\s*\{[^}]*border:\s*1px solid var\(--border-strong\);[^}]*border-radius:\s*5px;/s);
  assert.match(replacement, /\.replacement-tool-summary input:focus\s*\{[^}]*border-color:\s*var\(--focus-ring\);[^}]*box-shadow:\s*0 0 0 1px var\(--focus-ring\);/s);
});

test("Diff side labels share the editor grid instead of approximating its divider", async () => {
  const [editor, editable, labels, filesCss, replacementView, replacementCss] = await Promise.all([
    readFile(new URL("../src/diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/diff-side-labels.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/files-editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/workspace-replacement-presentation-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/workspace-replacement-tool.css", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /grid\.append\(createDiffSideLabels\(this\.sideLabels, window\.document\)\)/u);
  assert.match(editable, /this\.mergeView\.dom\.prepend\(createDiffSideLabels\(this\.sideLabels, document, true\)\)/u);
  assert.match(labels, /createDiffReviewPaneHeaders\(\[[\s\S]*actionGutters: true, className: "diff-side-labels"/u);
  assert.match(filesCss, /\.diff-split-grid\s*\{[^}]*grid-template-columns:[^}]*grid-template-rows:\s*27px minmax\(0, 1fr\);/s);
  const editableCss = await readFile(new URL("../src/features/files-editor/editable-diff.css", import.meta.url), "utf8");
  assert.match(editableCss, /\.diff-side-labels\s*\{[^}]*grid-template-columns:[^}]*var\(--diff-action-gutter-width, 5px\)/s);
  assert.match(editableCss, /\.diff-side-revision\s*\{[^}]*text-transform:\s*lowercase;/s);
  assert.doesNotMatch(replacementView, /replacement-tool-side-labels/u);
  assert.match(replacementCss, /--diff-action-gutter-width:\s*36px;/u);
  assert.match(replacementCss, /\.cm-mergeView > \.diff-side-labels\s*\{[^}]*position:\s*sticky;[^}]*grid-template-columns:[^}]*var\(--diff-action-gutter-width\)/s);
});

test("every change overview ruler shares one scrollbar-clearance surface", async () => {
  const [surface, indicators, attachment, overview, editable, push, conflict, theme] = await Promise.all([
    readFile(new URL("../src/features/files-editor/change-overview.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editor-change-indicators.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/change-overview-surface.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/diff-overview-ruler.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/remote-push/push-dialog-layout.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/git-operations/conflict-editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editor-theme.ts", import.meta.url), "utf8"),
  ]);
  assert.match(surface, /--change-overview-right-clearance:\s*14px;/u);
  assert.match(surface, /\.cm-change-overview-surface\.cm-change-overview-footer-clearance\s*\{[^}]*--change-overview-bottom-clearance:\s*12px;/s);
  assert.match(surface, /right:\s*var\(--change-overview-right-clearance\);/u);
  assert.match(indicators, /attachOverviewRuler\(target, this\.ruler, options\.overviewFooterScrollbar === true\)/u);
  assert.match(attachment, /target\.classList\.toggle\(OVERVIEW_SURFACE_CLASS, rulers\.length > 0\)/u);
  assert.match(overview, /attachOverviewRuler\(parent, ruler, true\)/u);
  assert.match(editable, /overviewFooterScrollbar:\s*comparison\.overview/u);
  for (const legacy of [push, conflict, theme]) {
    assert.doesNotMatch(legacy, /cm-change-overview-ruler/u);
  }
});

test("merged Diff restates its collapsed rows and centres the revert control on the change", async () => {
  const [theme, diff, controls, editor, scrollbars] = await Promise.all([
    readFile(new URL("../src/editor-theme.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/editable-diff.css", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/controls.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editable-diff-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/diff-review/editable-diff-scrollbars.ts", import.meta.url), "utf8"),
  ]);
  // CodeMirror renders collapsed unchanged rows as a real widget, so the app theme owns its color.
  assert.match(theme, /"\.cm-collapsedLines":\s*\{[^}]*color:\s*"var\(--info-text\)",[^}]*background:\s*"linear-gradient/s);
  assert.match(diff, /\.cm-merge-revert\s*\{[^}]*width:\s*32px;[^}]*flex:\s*0 0 32px;/s);
  assert.match(controls, /button\.diff-change-control[^}]*\{[^}]*width:\s*var\(--diff-change-control-width, 26px\);[^}]*height:\s*26px;/s);
  assert.match(controls, /\.replacement-tool-diff\.editable-diff-surface \.cm-merge-revert > button\.diff-change-control\s*\{[^}]*margin:\s*7px 0 0;[^}]*transform:\s*translateX\(-50%\);/s);
  assert.match(editor, /createDiffReviewActionButton\(\{[^}]*className: "editable-diff-revert"/su);
  // All visible horizontal owners share one coordinator, avoiding pairwise feedback loops.
  assert.match(scrollbars, /linkHorizontalScrollGroup\(\[\s*paneA\.pane,\s*paneB\.pane,\s*merge\.a\.scrollDOM,\s*merge\.b\.scrollDOM,\s*\]\)/s);
});

test("conflict Diff owns three aligned docked scrollbars and the shared Diff control", async () => {
  const [css, filesCss, controls, editor, actionGutter, icons] = await Promise.all([
    readFile(new URL("../src/features/git-operations/conflict-editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/files-editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/controls.css", import.meta.url), "utf8"),
    readFile(new URL("../src/conflict-editor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/diff-review/diff-review-action-gutter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/icons.ts", import.meta.url), "utf8"),
  ]);
  const scrollbarStart = css.indexOf(".conflict-scrollbars {");
  const scrollbarRule = css.slice(scrollbarStart, css.indexOf("}\n", scrollbarStart) + 1);
  const resultMirrorStart = css.indexOf(".conflict-right-merge .cm-mergeViewEditor:first-child {");
  const resultMirrorRule = css.slice(resultMirrorStart, css.indexOf("}\n", resultMirrorStart) + 1);
  assert.match(css, /\.conflict-three-pane\s*\{[^}]*grid-template-rows:\s*27px minmax\(0, 1fr\) auto;/s);
  assert.match(css, /--conflict-equal-pane-width:\s*calc\(33\.333333% - 38\.666667px\);/u);
  assert.match(scrollbarRule, /position:\s*relative;/u);
  assert.match(scrollbarRule, /--conflict-ours-width/u);
  assert.match(scrollbarRule, /--conflict-result-width/u);
  assert.match(scrollbarRule, /--conflict-theirs-width/u);
  assert.doesNotMatch(scrollbarRule, /\)\s+auto;/u);
  assert.match(css, /\.conflict-scrollbar-corner\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.conflict-right-merge > \.cm-mergeView\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
  assert.match(resultMirrorRule, /flex:\s*0 0 0 !important;/u);
  assert.match(resultMirrorRule, /visibility:\s*hidden;/u);
  assert.match(resultMirrorRule, /pointer-events:\s*none;/u);
  assert.doesNotMatch(resultMirrorRule, /display:\s*none;/u);
  assert.match(css, /\.conflict-three-pane \.cm-scroller\s*\{[^}]*scrollbar-width:\s*none;/s);
  assert.match(css, /--conflict-action-gutter-width:\s*58px;/u);
  assert.match(css, /\.conflict-editor-actions > \.primary-button,[^}]*\.conflict-editor-actions > \.secondary-button\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(filesCss, /\.diff-controls button\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(controls, /\.conflict-three-pane \.conflict-change-controls > button\.diff-change-control/u);
  assert.match(controls, /\.conflict-unified-source \.conflict-change-controls > button\.diff-change-control\s*\{[^}]*position:\s*relative;[^}]*margin:\s*0;[^}]*transform:\s*none;/s);
  assert.match(controls, /button\.diff-change-control[^}]*\{[^}]*min-width:\s*var\(--diff-change-control-width, 26px\);[^}]*max-width:\s*var\(--diff-change-control-width, 26px\);[^}]*background:\s*var\(--accent\);[^}]*color:\s*var\(--text-on-accent\);/s);
  assert.match(controls, /\.conflict-unified-source \.conflict-change-controls > button\.diff-change-control/u);
  assert.match(controls, /\.diff-change-control > \.icon\s*\{[^}]*width:\s*15px;[^}]*height:\s*15px;/s);
  assert.match(editor, /createDiffReviewActionGroup\(side/u);
  assert.match(actionGutter, /group\.className = "diff-review-action-group conflict-change-controls"/u);
  assert.match(editor, /dataset\.decision = "accepted"/u);
  assert.match(editor, /dataset\.decision = "ignored"/u);
  assert.match(editor, /event\.stopPropagation\(\)/u);
  assert.match(editor, /this\.resolutionModel\.applyDecision\(side, decision, source/u);
  assert.match(editor, /const sharedWidth = Math\.max\(\.\.\.scrollers\.map\(\(scroller\) => scroller\.scrollWidth\)\)/u);
  assert.doesNotMatch(editor, /corner\.style\.flex/u);
  assert.match(editor, /linkHorizontalScrollGroup\(\[\.\.\.panes, \.\.\.scrollers\]\)/u);
  assert.match(editor, /this\.rightMerge\.a\.scrollDOM/u);
  assert.match(icons, /"double-chevron-right"/u);
  assert.match(icons, /"double-chevron-left"/u);
  assert.match(icons, /"double-chevron-down"/u);
  assert.match(icons, /"double-chevron-up"/u);
});

test("two-pane Diff splitters keep their drag target but reveal the divider only on interaction", async () => {
  const [files, editable, review] = await Promise.all([
    readFile(new URL("../src/features/files-editor/files-editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/files-editor/editable-diff.css", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/diff-review.css", import.meta.url), "utf8"),
  ]);

  assert.match(files, /\.diff-splitter\s*\{[^}]*background:\s*transparent;/s);
  assert.match(editable, /\.editable-diff-splitter\s*\{[^}]*width:\s*5px;/s);
  assert.match(review, /\.diff-splitter::after,[\s\S]*?\.editable-diff-splitter::after\s*\{[^}]*background:\s*transparent;[^}]*opacity:\s*0;/u);
  assert.match(review, /\.diff-splitter:hover::after,[\s\S]*?\.editable-diff-splitter\.dragging::after\s*\{[^}]*background:\s*var\(--accent\);[^}]*opacity:\s*1;/u);
});

test("dialog buttons share one surface, follow the UI font size, and define danger centrally", async () => {
  const layout = await readFile(new URL("../src/shared/layout.css", import.meta.url), "utf8");
  const owned = await Promise.all(
    ownedStyles
      .filter(([stylePath]) => stylePath !== "shared/layout.css")
      .map(([stylePath]) => readFile(new URL(`../src/${stylePath}`, import.meta.url), "utf8")),
  );
  assert.match(layout, /\.primary-button,\s*\.secondary-button,\s*\.danger-button\s*\{[^}]*height:\s*31px;[^}]*font-size:\s*max\(10px,\s*calc\(var\(--ui-font-size, 13px\) - 2px\)\);/s);
  assert.match(layout, /\.danger-button\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--red\) 12%, var\(--bg-panel\)\);[^}]*color:\s*var\(--danger-text\);/s);
  assert.match(layout, /\.danger-button:hover:not\(:disabled\)\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--red\) 20%, var\(--bg-panel\)\);/s);
  // A dialog must never have to scope its own destructive variant to get a styled confirm button.
  const scoped = owned.filter((source) => /\.danger-button\s*\{/u.test(source));
  assert.equal(scoped.length, 0, "the destructive surface belongs to the shared button layer only");
});

test("the Changes commit blocker keeps one complete line at the minimum splitter height", async () => {
  const content = await readFile(new URL("../src/shared/content.css", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  assert.match(content, /\.commit-tool \.commit-form textarea\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(content, /\.commit-tool \.commit-form textarea\s*\{[^}]*min-height:\s*0;/s);
  assert.match(content, /\.commit-blocker\s*\{[^}]*min-height:\s*13px;[^}]*flex-shrink:\s*0;[^}]*line-height:\s*13px;/s);
  assert.match(content, /\.commit-actions > \.commit-button,\s*\.commit-actions > \.stash-primary-action\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 0;[^}]*margin:\s*0;/s);
  assert.doesNotMatch(content, /\.commit-actions \.commit-button:first-child/);
  assert.doesNotMatch(content, /\.commit-button\s*\{[^}]*margin(?:-top)?:/s);
  assert.match(content, /\.commit-button-label\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.doesNotMatch(content, /\.commit-keep-staged|\.commit-stash-split|\.stash-options-toggle/);
  assert.match(app, /class="primary-button stash-primary-action" id="stash-changes-button"[^>]*><span class="commit-button-label">/s);
  assert.doesNotMatch(app, /stash-options-toggle|stashOptionsSession/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function filesWithExtension(root, extension) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesWithExtension(target, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(target);
  }
  return files;
}

async function stylesheetImports(files) {
  const imports = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/\bimport\s+["']([^"']+\.css)["']/g)) {
      if (!match[1].startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), match[1]);
      if (!target.startsWith(`${sourceRoot}${path.sep}`)) continue;
      const style = portablePath(path.relative(sourceRoot, target));
      const owner = portablePath(path.relative(sourceRoot, file));
      imports.set(style, [...(imports.get(style) ?? []), owner]);
    }
  }
  for (const owners of imports.values()) owners.sort();
  return imports;
}

function portablePath(value) {
  return value.split(path.sep).join("/");
}
