import type {JavaToolchainSnapshot} from "../protocol/toolchain.ts";
export interface ToolchainCopy {
  title:string;
  roles:Record<JavaToolchainSnapshot["role"],string>;
  sources:Record<JavaToolchainSnapshot["source"],string>;
  reason(value:string):string;
  requirement(min:number,max?:number):string;
}
const enReasons:Record<string,string>={"lowest-compatible":"Lowest compatible installed JDK","command-line":"Explicit command-line choice","user-properties":"User Gradle configuration","project-properties":"Project Gradle configuration","compatible-environment":"Compatible JAVA_HOME","replaced-incompatible-environment":"Compatible installed JDK replaces incompatible JAVA_HOME","compatible-installed":"Compatible installed JDK"};
const zhReasons:Record<string,string>={"lowest-compatible":"最低兼容的已安装 JDK","command-line":"命令行显式指定","user-properties":"用户 Gradle 配置","project-properties":"项目 Gradle 配置","compatible-environment":"兼容的 JAVA_HOME","replaced-incompatible-environment":"使用已安装的兼容 JDK 替代不兼容的 JAVA_HOME","compatible-installed":"兼容的已安装 JDK"};
export const EN_TOOLCHAINS:ToolchainCopy={title:"Java toolchains",roles:{"build-runtime":"Gradle build JVM","build-model":"Project model worker JVM","language-server":"Language server JVM"},sources:{installed:"Installed",environment:"Environment",project:"Project",user:"User", "command-line":"Command line"},reason:value=>enReasons[value]??value,requirement:(min,max)=>max===min+1?`Requires Java ${min}`:max?`Requires Java ${min}–${max-1}`:`Requires Java ${min}+`};
export const ZH_TOOLCHAINS:ToolchainCopy={title:"Java 工具链",roles:{"build-runtime":"Gradle 构建 JVM","build-model":"项目模型工作进程 JVM","language-server":"语言服务器 JVM"},sources:{installed:"本机安装",environment:"环境变量",project:"项目配置",user:"用户配置","command-line":"命令行"},reason:value=>zhReasons[value]??value,requirement:(min,max)=>max===min+1?`要求 Java ${min}`:max?`要求 Java ${min}–${max-1}`:`要求 Java ${min} 及以上`};
export function toolchainDescription(item:JavaToolchainSnapshot,copy:ToolchainCopy):string {
  return `${copy.roles[item.role]} · ${item.id} · Java ${item.version}\n${item.home}\n${copy.requirement(item.requirement.minimumMajor,item.requirement.maximumMajorExclusive??undefined)} · ${copy.sources[item.source]} · ${copy.reason(item.selectionReason)}`;
}
