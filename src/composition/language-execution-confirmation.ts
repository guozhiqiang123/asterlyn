import {EN_TOOLCHAINS,ZH_TOOLCHAINS,toolchainDescription} from "../localization/toolchain-copy.ts";
import type {NativeLanguageServiceBridge} from "../protocol/language-service.ts";
import type {ApplicationConfirmationRequest} from "../shared/application-confirmation-dialog.ts";

export function languageExecutionConfirmation(review: Parameters<NativeLanguageServiceBridge["confirm"]>[0], chinese: boolean): ApplicationConfirmationRequest {
  const tools=review.toolchains?.length?`\n\n${(chinese?ZH_TOOLCHAINS:EN_TOOLCHAINS).title}:\n${review.toolchains.map(tool=>toolchainDescription(tool,chinese?ZH_TOOLCHAINS:EN_TOOLCHAINS)).join("\n\n")}`:"";
  if (!["typescript", "rust-analyzer"].includes(review.serverId)) return chinese ? {
    title: "启用项目语言服务？",
    message: `语言插件将通过依赖插件读取当前项目模型，并运行已校验的本机语言工具。Gradle 会执行项目配置；语言工具会读取源码和当前未保存的编辑内容，具有当前用户的系统权限。首次分析可能需要较长时间，进度和失败原因可在日志中查看。${tools}\n\n执行程序：${review.executableIdentity}\n插件与工具校验：${review.resourceDigest}\n\n启用后为此项目记住授权，重新打开项目和重启应用不会重复询问；“暂不启用”仅适用于本次会话。更换插件、依赖插件或工具后重新确认，可在语言服务状态中清除项目授权。`,
    confirmLabel: "启用语言服务", cancelLabel: "暂不启用",
  } : {
    title: "Enable project language services?",
    message: `The language plugin will read this project's model through its declared dependency plugin and run verified local language tools. Gradle executes project configuration. Tools can read source files and unsaved edits with your account's system permissions. Initial analysis can take time; progress and failures are recorded in the application log.${tools}\n\nExecutable: ${review.executableIdentity}\nPlugin and tool identity: ${review.resourceDigest}\n\nApproval is remembered for this project across restarts; “Not now” applies to this session. Changed plugins, dependency plugins or tools require confirmation again. Project approval can be cleared from the language service status.`,
    confirmLabel: "Enable language services", cancelLabel: "Not now",
  };
  if (review.serverId === "rust-analyzer") return chinese ? {
    title: "启用 Rust 语言服务？",
    message: `插件 ${review.pluginId} ${review.pluginVersion} 将运行本机 Rust 1.98.1 的 rust-analyzer，并通过 Cargo 读取当前项目模型。该进程具有当前用户的系统权限；项目和用户的 Cargo 配置也会影响执行。\n\n首版使用离线模式，关闭构建脚本、过程宏和保存时 Cargo check；宏生成代码的分析可能不完整。不会自动安装依赖或工具。${tools}\n\n执行程序：${review.executableIdentity}\n插件校验：${review.packageDigest}\n\n为此项目单独记住 Rust 的选择，重启后仍然有效。工具或插件身份变化后重新确认，可在语言服务状态中清除项目授权。`,
    confirmLabel: "启用 Rust 语言服务", cancelLabel: "暂不启用",
  } : {
    title: "Enable Rust language services?",
    message: `Plugin ${review.pluginId} ${review.pluginVersion} will run local Rust 1.98.1 rust-analyzer and read this project's model through Cargo. It has your user account's system permissions; project and user Cargo configuration can also affect execution.\n\nThis initial profile runs offline with build scripts, procedural macros and Cargo check on save disabled. Generated code analysis may be incomplete. Tools and dependencies are never installed automatically.${tools}\n\nExecutable: ${review.executableIdentity}\nPackage: ${review.packageDigest}\n\nRemember Rust's separate choice for this project across restarts. Changed plugin or tool identities require confirmation again. Project approval can be cleared from the language service status.`,
    confirmLabel: "Enable Rust language services", cancelLabel: "Not now",
  };
  return chinese ? {
    title: "启用 TypeScript / JavaScript 语言服务？",
    message: `插件 ${review.pluginId} ${review.pluginVersion} 将通过本机 Node.js 运行随包附带的语言服务，并读取当前项目与打开的源文件。该进程具有当前用户的系统权限。${tools}\n\n执行程序：${review.executableIdentity}\n插件校验：${review.packageDigest}\n\n为此项目记住此选择，重启应用和重新打开项目不会重复询问。插件或 Node 身份变化后需要重新确认，可在语言服务状态中清除项目授权。`,
    confirmLabel: "启用语言服务", cancelLabel: "暂不启用",
  } : {
    title: "Enable TypeScript / JavaScript language services?",
    message: `Plugin ${review.pluginId} ${review.pluginVersion} will run its packaged language server with local Node.js and read this project and its open source files. The process has your user account's system permissions.${tools}\n\nExecutable: ${review.executableIdentity}\nPackage: ${review.packageDigest}\n\nApproval is remembered for this project across restarts; “Not now” applies to this session. Changed plugin or Node identities require confirmation again. Project approval can be cleared from the language service status.`,
    confirmLabel: "Enable language services", cancelLabel: "Not now",
  };
}
