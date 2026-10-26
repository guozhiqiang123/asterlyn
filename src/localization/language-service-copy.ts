export interface LanguageServiceCopy {
  pointerHint: string; findingDefinition: string; chooseDefinition: string; definitionsLimited: string;
  noDefinition: string; invalidDefinition: string; targetUnavailable: string; invalidTargetRange: string; definitionOpened: string;
}
export const EN_US_LANGUAGE_SERVICE_COPY: LanguageServiceCopy = {
  pointerHint: "Ctrl-click to go to definition (Command-click also works on macOS)",
  findingDefinition: "Finding definition…", chooseDefinition: "Choose a definition", definitionsLimited: "Choose a definition (first 16)",
  noDefinition: "No definition was returned. Check that language services are enabled.",
  invalidDefinition: "The language service returned an invalid definition.",
  targetUnavailable: "This definition is outside the current project file catalog.",
  invalidTargetRange: "The definition position no longer matches the target file.",
  definitionOpened: "Opened definition.",
};
export const ZH_CN_LANGUAGE_SERVICE_COPY: LanguageServiceCopy = {
  pointerHint: "Ctrl＋单击跳转到定义（macOS 也支持 ⌘＋单击）",
  findingDefinition: "正在查找定义…", chooseDefinition: "选择要跳转的定义", definitionsLimited: "选择要跳转的定义（前 16 项）",
  noDefinition: "未获得定义结果，请确认语言服务已启用。", invalidDefinition: "语言服务返回了无效的定义位置。",
  targetUnavailable: "此定义不在当前项目的文件目录中。", invalidTargetRange: "定义位置已与目标文件内容不一致。",
  definitionOpened: "已跳转到定义。",
};
