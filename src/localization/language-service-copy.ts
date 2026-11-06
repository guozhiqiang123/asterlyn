import {EN_OPEN_IN_WINDOW,ZH_OPEN_IN_WINDOW} from "./result-window-copy.ts";
import { EN_LANGUAGE_STATUS, ZH_LANGUAGE_STATUS, type LanguageServiceStatusCopy } from "./language-service-status-copy.ts";
export interface LanguageServiceCopy {
  management: ManagedLanguageStatusCopy;
  coverage:Record<"complete"|"partial"|"unknown",string>;incompleteEmpty:string;
  excludeImports:string;
  openInWindow:string;referencesTitle:string;definitionsTitle:string;
  workspaceStatus:LanguageServiceStatusCopy;
  readOnlySource:string;
  indexing: string; requestFailed: string;
  pointerHint: string; findingDefinition: string; chooseDefinition: string; definitionsLimited: string;
  noDefinition: string; invalidDefinition: string; targetUnavailable: string; invalidTargetRange: string; definitionOpened: string;
  findingReferences: string; chooseReference: string; noReferences: string; filterLocations: string; noMatchingLocations: string; limitedLocations: string;
}
export interface ManagedLanguageStatusCopy {
  checking(language: string): string;
  factsUnavailable(language: string): string;
  unconfigured(language: string): string;
  platformUnavailable(language: string): string;
  projectUnknown(language: string): string;
  selectionRequired(language: string): string;
  recipeUnavailable(server: string): string;
  targetUnavailable(server: string): string;
  installAvailable(server: string): string;
  installing(server: string, progress: string): string;
  removing(server: string): string;
  verificationRequired(server: string): string;
  recoveryAvailable(server: string): string;
  progressLabel(server: string): string;
  actions: Record<"open" | "install" | "cancel" | "verify" | "recover" | "suppress" | "dismiss", string>;
}
export const EN_US_LANGUAGE_SERVICE_COPY: LanguageServiceCopy = {
  management: {
    checking: language => `Checking ${language} language service…`,
    factsUnavailable: language => `${language} language service status is unavailable`,
    unconfigured: language => `${language} language service is not configured`,
    platformUnavailable: language => `${language} language service is unavailable on this platform`,
    projectUnknown: language => `Checking whether ${language} is supported by this project…`,
    selectionRequired: language => `Choose a ${language} language service`,
    recipeUnavailable: server => `${server} installation is not available yet`,
    targetUnavailable: server => `${server} is unavailable for this device`,
    installAvailable: server => `${server} is not installed`,
    installing: (server, progress) => `Installing ${server}${progress ? ` · ${progress}` : ""}`,
    removing: server => `Waiting to remove ${server}`,
    verificationRequired: server => `${server} must be verified before use`,
    recoveryAvailable: server => `${server} has an installed version available for recovery`,
    progressLabel: server => `${server} installation progress`,
    actions: { open: "Manage", install: "Install", cancel: "Cancel", verify: "Verify", recover: "Review", suppress: "Don't show for this project", dismiss: "Later" },
  },
  coverage:{complete:"Analysis coverage confirmed",partial:"Results cover part of the project",unknown:"The provider has not confirmed analysis coverage"},incompleteEmpty:"No locations returned; analysis coverage is incomplete or unconfirmed.",
  excludeImports:"Exclude imports",
  openInWindow:EN_OPEN_IN_WINDOW,referencesTitle:"References",definitionsTitle:"Definitions",
  workspaceStatus:EN_LANGUAGE_STATUS,
  readOnlySource:"Dependency source (read-only)",
  indexing: "Language services are indexing this project. Try again shortly.", requestFailed: "The language service request failed. Check the service status or logs.",
  pointerHint: "Ctrl-click to go to definition or usages (Command-click also works on macOS)",
  findingDefinition: "Finding definition…", chooseDefinition: "Choose a definition", definitionsLimited: "Choose a definition (first 16)",
  noDefinition: "No definition was returned. Check that language services are enabled.",
  invalidDefinition: "The language service returned an invalid source location.",
  targetUnavailable: "This definition is outside the current project file catalog.",
  invalidTargetRange: "The definition position no longer matches the target file.",
  definitionOpened: "Opened source location.",
  findingReferences: "Finding references…", chooseReference: "Choose a reference", noReferences: "No references were found.",
  filterLocations: "Filter by file or path", noMatchingLocations: "No matching locations.", limitedLocations: "Showing the first {count} locations",
};
export const ZH_CN_LANGUAGE_SERVICE_COPY: LanguageServiceCopy = {
  management: {
    checking: language => `正在检查 ${language} 语言服务…`,
    factsUnavailable: language => `暂时无法读取 ${language} 语言服务状态`,
    unconfigured: language => `${language} 语言服务尚未配置`,
    platformUnavailable: language => `当前平台不支持 ${language} 语言服务`,
    projectUnknown: language => `正在确认当前项目是否支持 ${language}…`,
    selectionRequired: language => `请选择 ${language} 语言服务`,
    recipeUnavailable: server => `${server} 暂无可用安装方案`,
    targetUnavailable: server => `${server} 不支持当前设备`,
    installAvailable: server => `${server} 尚未安装`,
    installing: (server, progress) => `正在安装 ${server}${progress ? ` · ${progress}` : ""}`,
    removing: server => `正在等待卸载 ${server}`,
    verificationRequired: server => `${server} 使用前需要重新校验`,
    recoveryAvailable: server => `${server} 有可恢复的已安装版本`,
    progressLabel: server => `${server} 安装进度`,
    actions: { open: "管理", install: "安装", cancel: "取消", verify: "校验", recover: "查看", suppress: "本项目不再提示", dismiss: "稍后提醒" },
  },
  coverage:{complete:"已确认分析覆盖范围",partial:"结果仅覆盖部分项目",unknown:"提供者尚未确认分析覆盖范围"},incompleteEmpty:"本次未返回位置；分析范围尚不完整或未确认。",
  excludeImports:"排除 import",
  openInWindow:ZH_OPEN_IN_WINDOW,referencesTitle:"引用",definitionsTitle:"定义",
  workspaceStatus:ZH_LANGUAGE_STATUS,
  readOnlySource:"依赖源码（只读）",
  indexing: "语言服务正在加载和索引项目，请稍后再试。", requestFailed: "语言服务请求失败，请检查服务状态或日志。",
  pointerHint: "Ctrl＋单击跳转到定义或引用（macOS 也支持 ⌘＋单击）",
  findingDefinition: "正在查找定义…", chooseDefinition: "选择要跳转的定义", definitionsLimited: "选择要跳转的定义（前 16 项）",
  noDefinition: "未获得定义结果，请确认语言服务已启用。", invalidDefinition: "语言服务返回了无效的源码位置。",
  targetUnavailable: "此定义不在当前项目的文件目录中。", invalidTargetRange: "定义位置已与目标文件内容不一致。",
  definitionOpened: "已跳转到源码位置。",
  findingReferences: "正在查找引用…", chooseReference: "选择引用位置", noReferences: "未找到引用位置。",
  filterLocations: "按文件名或路径筛选", noMatchingLocations: "没有匹配的位置。", limitedLocations: "仅显示前 {count} 个位置",
};
