import assert from "node:assert/strict";
import test from "node:test";

import { renderSettingsNavigation, renderSettingsSection } from "../src/features/settings/settings-view.ts";
import { renderCommandSurface } from "../src/features/files-editor/workspace-navigation-view.ts";
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
