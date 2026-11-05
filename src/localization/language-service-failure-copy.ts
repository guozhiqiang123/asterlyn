import type {NativeLanguageServiceFailure} from "../protocol/generated-native-language-types.ts";
import {EN_LANGUAGE_STATUS,ZH_LANGUAGE_STATUS} from "./language-service-status-copy.ts";
import {projectLanguageFailureMessage} from "./project-language-failure-copy.ts";

const EN:Record<string,string>={
  "gradle-model-incompatible":"The Android Gradle integration cannot read this project's build-model interface. Update the integration plugin, then retry language services. Project builds may still succeed.",
  "gradle-version-incompatible":"The model provider does not support this project's Gradle version. Check the integration's supported tool versions, then retry language services.",
  "gradle-toolchain-incompatible":"The Java runtime selected for project-model import is incompatible. Check the language service toolchains, then retry.",
  "kotlin-compiler-failed":"Kotlin source-model preparation failed. Check language service diagnostics, then retry.",
  "kotlin-compiler-timeout":"Kotlin source-model preparation timed out. Check language service diagnostics and available resources, then retry.",
};
const ZH:Record<string,string>={
  "gradle-model-incompatible":"Android Gradle 集成插件无法读取此项目的构建模型接口。请更新集成插件后重试语言服务；项目编译仍可能成功。",
  "gradle-version-incompatible":"模型提供者尚不支持此项目的 Gradle 版本。请检查集成插件支持的工具版本，然后重试语言服务。",
  "gradle-toolchain-incompatible":"用于导入项目模型的 Java 运行时不兼容。请检查语言服务使用的工具链，然后重试。",
  "kotlin-compiler-failed":"Kotlin 源码模型准备失败。请查看语言服务诊断，然后重试。",
  "kotlin-compiler-timeout":"Kotlin 源码模型准备超时。请检查语言服务诊断及可用资源，然后重试。",
};
/** Closed categories only: arbitrary exception text, codes, paths and URLs never become UI copy. */
export function languageServiceFailureMessage(failure:NativeLanguageServiceFailure|undefined,reason:string|undefined,locale:"en"|"zh-CN"):string {
  const project=projectLanguageFailureMessage(failure?.project,locale);if(project)return project;
  const specifics=locale==="zh-CN"?ZH:EN;
  if(reason&&Object.hasOwn(specifics,reason))return specifics[reason]!;
  const copy=locale==="zh-CN"?ZH_LANGUAGE_STATUS:EN_LANGUAGE_STATUS;
  const category=failure?.code&&Object.hasOwn(copy.failureReasons,failure.code)?failure.code:"unavailable";
  if(category==="resource-limit")return copy.failureReasons[category];
  return `${copy.failureReasons[category]} ${locale==="zh-CN"?"请查看语言服务状态和日志，然后重试。":"Review language service status and logs, then retry."}`;
}
