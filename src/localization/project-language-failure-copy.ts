import type { ProjectFailure, ProjectFailureKind } from "../protocol/generated-native-language-types.ts";

const EN: Record<ProjectFailureKind, readonly [string, string]> = {
  "dependency-offline": ["A required compile dependency is missing from the offline cache.", "Restore Gradle dependencies with network access, then retry language services."],
  "dependency-unavailable": ["A required compile dependency could not be resolved.", "Check the dependency version and repository access, restore Gradle dependencies, then retry language services."],
  "dependency-tls": ["Dependency access failed because the TLS certificate could not be verified.", "Check the repository certificate and Java trust store, then retry language services."],
  "dependency-dns": ["The dependency repository hostname could not be resolved.", "Check network and DNS access, then retry language services."],
  "repository-credentials-missing": ["The dependency repository rejected access.", "Check the project's repository credentials and access permissions, then retry language services."],
  "android-sdk-missing": ["The project's Android SDK could not be found.", "Check sdk.dir or the Android SDK configuration, then retry language services."],
  "project-configuration-failed": ["Gradle could not configure this project.", "Correct the project's Gradle configuration, then retry language services."],
  "project-script-failed": ["A project Gradle script failed.", "Correct the project's Gradle script, then retry language services."],
  "model-selected-variant-missing": ["The selected build variant is unavailable in this project.", "Refresh Gradle tasks, select an available Run configuration, then retry language services."],
  "model-dependency-variant-missing": ["A project dependency has no matching build variant.", "Check the modules' build types and flavors, then retry language services."],
  "model-dependency-variant-ambiguous": ["A project dependency has multiple matching build variants.", "Correct the modules' variant selection, then retry language services."],
};
const ZH: Record<ProjectFailureKind, readonly [string, string]> = {
  "dependency-offline": ["离线缓存中缺少必需的编译依赖。", "请联网恢复 Gradle 依赖，然后重试语言服务。"],
  "dependency-unavailable": ["项目编译依赖解析失败。", "请检查依赖版本和仓库访问，恢复 Gradle 依赖后重试语言服务。"],
  "dependency-tls": ["下载依赖时无法验证 TLS 证书。", "请检查仓库证书和 Java 信任库，然后重试语言服务。"],
  "dependency-dns": ["无法解析依赖仓库的域名。", "请检查网络和 DNS，然后重试语言服务。"],
  "repository-credentials-missing": ["依赖仓库拒绝访问。", "请检查项目的仓库凭据和访问权限，然后重试语言服务。"],
  "android-sdk-missing": ["找不到项目所需的 Android SDK。", "请检查 sdk.dir 或 Android SDK 配置，然后重试语言服务。"],
  "project-configuration-failed": ["Gradle 无法配置此项目。", "请修正项目的 Gradle 配置，然后重试语言服务。"],
  "project-script-failed": ["项目 Gradle 脚本执行失败。", "请修正项目的 Gradle 脚本，然后重试语言服务。"],
  "model-selected-variant-missing": ["项目中已不存在所选构建变体。", "请刷新 Gradle task，选择可用的 Run 配置，然后重试语言服务。"],
  "model-dependency-variant-missing": ["依赖模块缺少匹配的构建变体。", "请检查模块的构建类型和 flavor，然后重试语言服务。"],
  "model-dependency-variant-ambiguous": ["依赖模块存在多个匹配的构建变体。", "请修正模块的变体选择，然后重试语言服务。"],
};

/** Revalidate display identifiers; raw server/Gradle exception messages are never UI copy. */
export function projectLanguageFailureMessage(value: unknown, locale: "en" | "zh-CN"): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const detail = value as ProjectFailure;
  if (!Object.hasOwn(EN, detail.kind)) return null;
  const zh = locale === "zh-CN", [reason, guidance] = (zh ? ZH : EN)[detail.kind];
  const module = typeof detail.module === "string" && detail.module.length <= 80 && /^:[A-Za-z0-9_$:.-]*$/u.test(detail.module) && !detail.module.includes("..") ? detail.module : null;
  const dependency = typeof detail.dependency === "string" && detail.dependency.length <= 160 && /^[A-Za-z0-9_.+-]+:[A-Za-z0-9_.+-]+:[A-Za-z0-9_.+-]+$/u.test(detail.dependency) && !detail.dependency.includes("..") ? detail.dependency : null;
  const remaining = typeof detail.remaining === "number" && Number.isInteger(detail.remaining) && detail.remaining > 0 && detail.remaining <= 9999 ? detail.remaining : 0;
  return [zh ? "项目语言服务无法加载。" : "Language services could not load this project.", reason,
    module ? `${zh ? "模块" : "Module"}: ${module}.` : "", dependency ? `${zh ? "依赖" : "Dependency"}: ${dependency}${remaining ? zh ? `（另有 ${remaining} 项）` : ` (+${remaining} more)` : ""}.` : "", guidance].filter(Boolean).join(" ");
}
