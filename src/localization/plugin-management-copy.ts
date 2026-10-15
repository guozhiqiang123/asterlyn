import type { PluginManagementCopy } from "../features/settings/plugin-management-view.ts";

export const EN_US_PLUGIN_MANAGEMENT_COPY: PluginManagementCopy = {
  locale: "en-US",
  title: "Plugins", description: "Manage plugins and their settings.", builtIn: "Built-in", enablePlugin: "Enable plugin",
  enabled: "Enabled", disabled: "Disabled", matched: "Detected in this project", notMatched: "Not detected in this project",
  active: "Active", inactive: "Inactive", version: "Version", diagnostics: "Diagnostic", settings: "Plugin settings",
  noSettings: "This plugin has no configurable settings.", noPlugins: "No plugins are available.", loadingPlugins: "Loading plugins…", invalidSetting: "This setting is unavailable.",
};

export const ZH_CN_PLUGIN_MANAGEMENT_COPY: PluginManagementCopy = {
  locale: "zh-CN",
  title: "插件", description: "管理插件及其设置。", builtIn: "内置", enablePlugin: "启用插件",
  enabled: "已启用", disabled: "已禁用", matched: "已在此项目中检测到", notMatched: "此项目未检测到",
  active: "已激活", inactive: "未激活", version: "版本", diagnostics: "诊断信息", settings: "插件设置",
  noSettings: "此插件没有可配置的设置。", noPlugins: "没有可用的插件。", loadingPlugins: "正在加载插件…", invalidSetting: "此设置不可用。",
};
