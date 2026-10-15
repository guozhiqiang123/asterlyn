import type { PluginManagementCopy } from "../features/settings/plugin-management-view.ts";

export const EN_US_PLUGIN_MANAGEMENT_COPY: PluginManagementCopy = {
  title: "Plugins", description: "Manage bundled project integrations and their settings.", builtIn: "Built-in", enablePlugin: "Enable plugin",
  enabled: "Enabled", disabled: "Disabled", matched: "Detected in this project", notMatched: "Not detected in this project",
  active: "Active", inactive: "Inactive", version: "Version", diagnostics: "Diagnostic", settings: "Plugin settings",
  noSettings: "This plugin has no configurable settings.", noPlugins: "No bundled plugins are available.", loadingPlugins: "Loading bundled plugins…", invalidSetting: "This setting is unavailable.",
  resolve: (key) => EN_US_PLUGIN_KEYS[key] ?? key,
};

export const ZH_CN_PLUGIN_MANAGEMENT_COPY: PluginManagementCopy = {
  title: "插件", description: "管理内置项目集成及其设置。", builtIn: "内置", enablePlugin: "启用插件",
  enabled: "已启用", disabled: "已禁用", matched: "已在此项目中检测到", notMatched: "此项目未检测到",
  active: "已激活", inactive: "未激活", version: "版本", diagnostics: "诊断信息", settings: "插件设置",
  noSettings: "此插件没有可配置的设置。", noPlugins: "没有可用的内置插件。", loadingPlugins: "正在加载内置插件…", invalidSetting: "此设置不可用。",
  resolve: (key) => ZH_CN_PLUGIN_KEYS[key] ?? key,
};

const EN_US_PLUGIN_KEYS: Readonly<Record<string, string>> = {
  "plugins.androidGradle.name": "Android / Gradle",
  "plugins.androidGradle.description": "Discover and run Gradle tasks for Android projects.",
  "plugins.androidGradle.taskPresentation.label": "Task presentation",
  "plugins.androidGradle.taskPresentation.description": "Choose the task tree shown in the Tasks tool window.",
  "plugins.androidGradle.taskPresentation.allTasksTree": "All tasks tree",
  "plugins.androidGradle.taskPresentation.quickActionsTree": "Android quick actions tree",
};

const ZH_CN_PLUGIN_KEYS: Readonly<Record<string, string>> = {
  "plugins.androidGradle.name": "Android / Gradle",
  "plugins.androidGradle.description": "为 Android 项目发现并运行 Gradle 任务。",
  "plugins.androidGradle.taskPresentation.label": "任务展示方式",
  "plugins.androidGradle.taskPresentation.description": "选择任务窗口中显示的任务树。",
  "plugins.androidGradle.taskPresentation.allTasksTree": "完整任务树",
  "plugins.androidGradle.taskPresentation.quickActionsTree": "Android 快捷操作树",
};
