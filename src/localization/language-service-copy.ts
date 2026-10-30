import { EN_LANGUAGE_STATUS, ZH_LANGUAGE_STATUS, type LanguageServiceStatusCopy } from "./language-service-status-copy.ts";
export interface LanguageServiceCopy {
  workspaceStatus:LanguageServiceStatusCopy;
  readOnlySource:string;
  indexing: string; requestFailed: string;
  pointerHint: string; findingDefinition: string; chooseDefinition: string; definitionsLimited: string;
  noDefinition: string; invalidDefinition: string; targetUnavailable: string; invalidTargetRange: string; definitionOpened: string;
  findingReferences: string; chooseReference: string; noReferences: string; filterLocations: string; noMatchingLocations: string; limitedLocations: string;
}
export const EN_US_LANGUAGE_SERVICE_COPY: LanguageServiceCopy = {
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
