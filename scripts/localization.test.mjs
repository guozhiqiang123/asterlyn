import assert from "node:assert/strict";
import test from "node:test";

import { renderSettingsNavigation, renderSettingsSection } from "../src/features/settings/settings-view.ts";
import { renderCommandSurface, renderWorkspaceReplacementDialog } from "../src/features/files-editor/workspace-navigation-view.ts";
import { renderProjectToolbar } from "../src/features/files-editor/project-files-view.ts";
import { renderDiffControls } from "../src/features/files-editor/editor-view.ts";
import { renderChangeNavigation } from "../src/features/changes-commit/changes-view.ts";
import { renderGitOperationBanner } from "../src/features/git-operations/git-operation-banner.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { loadLocale } from "../src/localization/locale-loader.ts";
import { ZH_CN } from "../src/localization/zh-CN.ts";
import { renderShellView } from "../src/shell/shell-view.ts";
import { ShellController } from "../src/shell/shell-controller.ts";
import { DEFAULT_APP_PREFERENCES } from "../src/workbench/preferences.ts";

test("locale catalogs retain the same typed runtime shape", () => {
  assert.deepEqual(catalogShape(ZH_CN), catalogShape(EN_US));
});

test("Simplified Chinese catalog is lazy-loadable and renders shell and settings", async () => {
  assert.equal((await loadLocale("en-US")).locale, "en-US");
  const catalog = await loadLocale("zh-CN");
  assert.equal(catalog.locale, "zh-CN");

  const shell = renderShellView({
    shell: new ShellController(memoryStorage()).state,
    workspaceOpen: false,
    gitAvailable: false,
    demo: true,
    windowControlsAvailable: false,
    localization: catalog,
  });
  assert.match(shell, />搜索</);
  assert.match(shell, />设置</);
  assert.match(shell, /打开项目文件夹/);

  const navigation = renderSettingsNavigation("general", catalog.settings);
  const general = renderSettingsSection({
    section: "general",
    preferences: { ...DEFAULT_APP_PREFERENCES, locale: "zh-CN" },
  }, { id: null, kind: "idle" }, catalog.settings);
  assert.match(navigation, />常规</);
  assert.match(general, /应用语言/);
  assert.match(general, /data-setting-locale="zh-CN" aria-pressed="true"/);

  const commandSurface = renderCommandSurface({
    commandSurface: { mode: "commands", query: "", selectedIndex: 0 },
    workspaceOpen: true,
    filesLoading: false,
    files: [],
    commands: [{ id: "refresh", label: catalog.navigation.commands.refresh.label, detail: catalog.navigation.commands.refresh.detail, enabled: true }],
    workspaceSearch: { generation: 0, status: "idle", request: null, report: null, error: null },
    workspaceSearchControls: { mode: "literal", includeText: "", excludeText: "", contextLines: 0 },
    searchRequestIsCurrent: false,
    replacementText: "",
    replacementRecoveryCount: 0,
    copy: catalog.navigation,
  });
  assert.match(commandSurface, /导航模式/);
  assert.match(commandSurface, /刷新项目/);
  assert.match(commandSurface, /命令面板/);

  const projectToolbar = renderProjectToolbar({ selection: null }, [], null, catalog.projectFiles);
  assert.match(projectToolbar, /在项目中定位当前文件/);
  const diffControls = renderDiffControls({
    imageDiff: false, textReady: true, previousFile: null, nextFile: null,
    canOpenSource: true, expanded: false, preferences: { diffLayout: "split", showWhitespace: false },
    copy: catalog.editor,
  });
  assert.match(diffControls, /差异导航/);
  assert.match(diffControls, />并排</);
  const replacement = renderWorkspaceReplacementDialog({
    dialog: "preview",
    replacement: { status: "previewing" },
    recoveryBusy: null,
    blockedOpenPaths: new Set(),
    copy: catalog.replacement,
  });
  assert.match(replacement, /正在准备替换预览/);

  const changes = renderChangeNavigation(
    { changes: [], untrackedState: "complete", branch: { unborn: false } },
    { selectedChange: null, fileView: "tree", excludedPaths: new Set(), collapsedDirectories: new Set() },
    0,
    400,
    catalog.changes,
  );
  assert.match(changes, /工作树干净/);
  const operation = renderGitOperationBanner({
    kind: "rebase", phase: "conflicts", progress: { current: 1, total: 2 }, conflicts: [{ path: "a.ts" }], allowedActions: ["continue", "abort"],
  }, catalog.gitOperations);
  assert.match(operation, /变基/);
  assert.match(operation, />继续</);
});

function catalogShape(value) {
  if (typeof value === "function") return "function";
  if (!value || typeof value !== "object") return typeof value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, catalogShape(value[key])]),
  );
}

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
  };
}
