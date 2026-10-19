import type { PluginManagementCopy } from "../features/settings/plugin-management-view.ts";

export const EN_US_PLUGIN_MANAGEMENT_COPY: PluginManagementCopy = {
  locale: "en-US",
  title: "Plugins", description: "Manage plugins and their settings.", builtIn: "Built-in", enablePlugin: "Enable plugin",
  enabled: "Enabled", disabled: "Disabled", matched: "Detected in this project", notMatched: "Not detected in this project",
  active: "Active", inactive: "Inactive", version: "Version", diagnostics: "Diagnostic", settings: "Plugin settings",
  noSettings: "This plugin has no configurable settings.", noPlugins: "No plugins are available.", loadingPlugins: "Loading plugins…", invalidSetting: "This setting is unavailable.",
  installedTab: "Installed", marketplaceTab: "Marketplace", marketplaceDescription: "Discover plugins from configured GitHub Release sources.",
  addSource: "Add source", editSource: "Edit source", deleteSource: "Remove source", confirmDeleteSource: "Remove this source? Installed plugins will not be removed.", cancel: "Cancel", save: "Save",
  repository: "GitHub repository", sourceName: "Display name", sourceDescription: "Description", sourceRepositoryPlaceholder: "owner/repository or GitHub URL", sourceNamePlaceholder: "Plugin name", sourceDescriptionPlaceholder: "What this plugin provides",
  officialSource: "Official source", customSource: "Custom source", enableSource: "Enable source", refreshSource: "Check Release", refreshingSource: "Checking…", loadingMarketplace: "Loading plugin sources…", noSources: "No plugin sources are configured.",
  notChecked: "Not checked", releaseAvailable: "Release available", noRelease: "No stable Release", staleRelease: "cached", packageLabel: "Package: ", checkedLabel: "Checked: ",
  marketplaceSecurityNote: "A GitHub Release is only a download source. Asterlyn verifies its repository identity, SHA-256, package structure, compatibility, license, permissions, and isolated runtime contract before installation.",
  inspectPackage: "Review package", inspectingPackage: "Inspecting…", confirmAdmission: "Admit package", admissionTitle: "Review plugin package", permissions: "Permissions", capabilities: "Capabilities", license: "License", pendingRuntimeNote: "The admitted package is stored immutably. Restart Asterlyn to activate it through the isolated runtime health check; it does not replace the current plugin before then.",
  admittedPackage: "Admitted package", pendingRuntime: "Pending isolated runtime", pendingRestart: "Restart required to apply plugin changes", restartToApply: "Restart Asterlyn", restarting: "Restarting…",
  enableInstalledPlugin: "Enable installed package", knownGood: "Known good", quarantined: "Quarantined", rollback: "Roll back", uninstallPlugin: "Uninstall", confirmUninstallPlugin: "Uninstall this plugin package?", uninstallKeepsData: "Plugin settings, trust decisions, and caches will be retained for a later reinstall.",
};

export const ZH_CN_PLUGIN_MANAGEMENT_COPY: PluginManagementCopy = {
  locale: "zh-CN",
  title: "插件", description: "管理插件及其设置。", builtIn: "内置", enablePlugin: "启用插件",
  enabled: "已启用", disabled: "已禁用", matched: "已在此项目中检测到", notMatched: "此项目未检测到",
  active: "已激活", inactive: "未激活", version: "版本", diagnostics: "诊断信息", settings: "插件设置",
  noSettings: "此插件没有可配置的设置。", noPlugins: "没有可用的插件。", loadingPlugins: "正在加载插件…", invalidSetting: "此设置不可用。",
  installedTab: "已安装", marketplaceTab: "插件商店", marketplaceDescription: "从已配置的 GitHub Release 源发现插件。",
  addSource: "添加源", editSource: "编辑源", deleteSource: "移除源", confirmDeleteSource: "确定移除此源吗？已经安装的插件不会被删除。", cancel: "取消", save: "保存",
  repository: "GitHub 仓库", sourceName: "显示名称", sourceDescription: "描述", sourceRepositoryPlaceholder: "owner/repository 或 GitHub 地址", sourceNamePlaceholder: "插件名称", sourceDescriptionPlaceholder: "说明插件提供的能力",
  officialSource: "官方源", customSource: "自定义源", enableSource: "启用源", refreshSource: "检查 Release", refreshingSource: "检查中…", loadingMarketplace: "正在加载插件源…", noSources: "尚未配置插件源。",
  notChecked: "尚未检查", releaseAvailable: "发现 Release", noRelease: "没有稳定 Release", staleRelease: "缓存", packageLabel: "安装包：", checkedLabel: "检查时间：",
  marketplaceSecurityNote: "GitHub Release 只负责提供下载来源。安装前，Asterlyn 还会校验仓库身份、SHA-256、包结构、兼容性、许可证、权限和隔离运行时契约。",
  inspectPackage: "审查安装包", inspectingPackage: "正在检查…", confirmAdmission: "准入安装包", admissionTitle: "审查插件安装包", permissions: "权限", capabilities: "能力", license: "许可证", pendingRuntimeNote: "准入后的安装包会进入不可变存储。重启 Asterlyn 后才会进入隔离运行时健康检查；在此之前不会替换当前插件。",
  admittedPackage: "已准入安装包", pendingRuntime: "等待隔离运行时", pendingRestart: "需要重启以应用插件变更", restartToApply: "重启 Asterlyn", restarting: "正在重启…",
  enableInstalledPlugin: "启用已安装插件", knownGood: "已验证可用", quarantined: "已隔离", rollback: "回滚", uninstallPlugin: "卸载", confirmUninstallPlugin: "确定卸载此插件安装包吗？", uninstallKeepsData: "插件设置、信任记录和缓存会保留，重新安装后可继续使用。",
};
