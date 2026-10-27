import type { PluginContributionRegistry } from "../application/plugins/index.ts";
import { createEditorLanguageServicePort, type NativeLanguageServiceBridge } from "../features/language-services/language-service-client.ts";
import type { EditorLanguageServiceHandle, EditorLanguageServiceLocation, EditorLanguageServicePortFactory } from "../protocol/editor-language-service.ts";
import type { ApplicationConfirmationRequest } from "../shared/application-confirmation-dialog.ts";
import type { WindowSession } from "../application/window-session.ts";

/** One callback supplies both language services and target navigation with their workspace scope. */
export function languageWorkspaceForWindow(session: Pick<WindowSession, "workspace">) {
  return () => session.workspace.identity();
}

export interface LanguageServicesRuntimeOptions {
  readonly registry: PluginContributionRegistry;
  readonly native: NativeLanguageServiceBridge;
  readonly workspace: () => { root: string; generation: number } | null;
  readonly document: (handle: EditorLanguageServiceHandle) => { workspacePath: string; readOnly: boolean; loadEpoch: number } | null;
  readonly bind: (factory: EditorLanguageServicePortFactory | null) => void;
  readonly reportError: (error: unknown) => void;
  readonly navigate: (location: EditorLanguageServiceLocation) => void;
  readonly definitionDiagnostic?: (event: import("../protocol/editor-language-service.ts").EditorDefinitionEvent) => void;
  readonly approvalDiagnostic?: (event: import("../protocol/language-service.ts").LanguageServiceApprovalEvent) => void;
  readonly diagnostic?: (fields: { providerCount: number; workspaceGeneration: number | null }) => void;
}
const LANGUAGES: Readonly<Record<string, string>> = { java:"java", kt:"kotlin", kts:"kotlin", groovy:"groovy", gradle:"groovy", rs: "rust", ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact" };
export function workspaceFileUri(root: string, path: string): string | null {
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const normalized = root.replace(/\\/gu, "/").replace(/\/$/u, "");
  const parts = normalized.split("/").map((part, index) => index === 0 && /^[A-Za-z]:$/u.test(part) ? part : encodeURIComponent(part)).join("/");
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//u.test(normalized)) return null;
  return `file://${normalized.startsWith("/") ? "" : "/"}${parts}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
export function createLanguageServicesRuntime(options: LanguageServicesRuntimeOptions) {
  const factory = createEditorLanguageServicePort((handle) => {
    const workspace = options.workspace(); const document = options.document(handle);
    if (!workspace || !document || document.readOnly || document.loadEpoch !== handle.loadEpoch) return null;
    const extension = document.workspacePath.match(/\.([^.\/]+)$/u)?.[1];
    const languageId = extension ? LANGUAGES[extension] : undefined;
    const providers = options.registry.list().filter((entry) => entry.kind === "language-service" && languageId && entry.languageIds.includes(languageId) && entry.extensions.includes(`.${extension}`));
    if (providers.length !== 1 || !languageId) return null;
    const provider = providers[0]!; if (provider.kind !== "language-service") return null; const uri = workspaceFileUri(workspace.root, document.workspacePath);
    return uri ? { workspaceRoot: workspace.root, workspaceGeneration: workspace.generation, uri, languageId, pluginId: provider.pluginId, providerVersion: provider.pluginVersion, serverId: provider.serverId } : null;
  }, options.native, options.reportError, options.navigate, options.definitionDiagnostic, options.approvalDiagnostic);
  let key = "";
  const refresh = () => {
    const workspace = options.workspace();
    const next = JSON.stringify([workspace, options.registry.list().filter((item) => item.kind === "language-service").map((item) => [item.qualifiedId, item.pluginVersion, item.serverId])]);
    if (key === next) return;
    key = next; factory.reconcile((info) => workspace?.root === info.workspaceRoot && workspace.generation === info.workspaceGeneration
      && !options.registry.list().some((item) => item.kind === "language-service" && item.pluginId === info.pluginId && item.pluginVersion !== info.providerVersion));
    options.diagnostic?.({ providerCount: options.registry.list().filter((item) => item.kind === "language-service").length, workspaceGeneration: workspace?.generation ?? null });
    // A new binding identity refreshes existing cached editors once when admission/activation changes.
    options.bind((handle) => factory(handle));
  };
  const release = options.registry.subscribe(refresh);
  return { refresh, revoke: (pluginId: string) => { factory.revoke(pluginId); }, dispose: () => { release(); options.bind(null); factory.dispose(); } };
}
export function languageExecutionConfirmation(review: Parameters<NativeLanguageServiceBridge["confirm"]>[0], chinese: boolean): ApplicationConfirmationRequest {
  if (!["typescript", "rust-analyzer"].includes(review.serverId)) return chinese ? {
    title: "启用项目语言服务？",
    message: `语言插件将通过依赖插件读取当前项目模型，并运行已校验的本机语言工具。Gradle 会执行项目配置；语言工具会读取源码和当前未保存的编辑内容，具有当前用户的系统权限。首次分析可能需要较长时间，进度和失败原因可在日志中查看。\n\n执行程序：${review.executableIdentity}\n插件与工具校验：${review.resourceDigest}\n\n当前窗口的项目会话内记住此选择。更换插件或工具后重新确认。`,
    confirmLabel: "启用语言服务", cancelLabel: "暂不启用",
  } : {
    title: "Enable project language services?",
    message: `The language plugin will read this project's model through its declared dependency plugin and run verified local language tools. Gradle executes project configuration. Tools can read source files and unsaved edits with your account's system permissions. Initial analysis can take time; progress and failures are recorded in the application log.\n\nExecutable: ${review.executableIdentity}\nPlugin and tool identity: ${review.resourceDigest}\n\nRemember this choice for the current window's project session. Changed plugins or tools require confirmation again.`,
    confirmLabel: "Enable language services", cancelLabel: "Not now",
  };
  if (review.serverId === "rust-analyzer") return chinese ? {
    title: "启用 Rust 语言服务？",
    message: `插件 ${review.pluginId} ${review.pluginVersion} 将运行本机 Rust 1.98.1 的 rust-analyzer，并通过 Cargo 读取当前项目模型。该进程具有当前用户的系统权限；项目和用户的 Cargo 配置也会影响执行。\n\n首版使用离线模式，关闭构建脚本、过程宏和保存时 Cargo check；宏生成代码的分析可能不完整。不会自动安装依赖或工具。\n\n执行程序：${review.executableIdentity}\n插件校验：${review.packageDigest}\n\n当前窗口的项目会话内单独记住 Rust 的选择。重启、切换项目或工具身份变化后重新确认。`,
    confirmLabel: "启用 Rust 语言服务", cancelLabel: "暂不启用",
  } : {
    title: "Enable Rust language services?",
    message: `Plugin ${review.pluginId} ${review.pluginVersion} will run local Rust 1.98.1 rust-analyzer and read this project's model through Cargo. It has your user account's system permissions; project and user Cargo configuration can also affect execution.\n\nThis initial profile runs offline with build scripts, procedural macros and Cargo check on save disabled. Generated code analysis may be incomplete. Tools and dependencies are never installed automatically.\n\nExecutable: ${review.executableIdentity}\nPackage: ${review.packageDigest}\n\nRemember Rust's separate choice for this project's session. Restarting, changing projects or a changed tool identity requires confirmation again.`,
    confirmLabel: "Enable Rust language services", cancelLabel: "Not now",
  };
  return chinese ? {
    title: "启用 TypeScript / JavaScript 语言服务？",
    message: `插件 ${review.pluginId} ${review.pluginVersion} 将通过本机 Node.js 运行随包附带的语言服务，并读取当前项目与打开的源文件。该进程具有当前用户的系统权限。\n\n执行程序：${review.executableIdentity}\n插件校验：${review.packageDigest}\n\n当前窗口的项目会话内记住此选择，刷新和切换文件不会重复询问。重启应用、切换项目或插件／Node 身份变化后需要重新确认。`,
    confirmLabel: "启用语言服务", cancelLabel: "暂不启用",
  } : {
    title: "Enable TypeScript / JavaScript language services?",
    message: `Plugin ${review.pluginId} ${review.pluginVersion} will run its packaged language server with local Node.js and read this project and its open source files. The process has your user account's system permissions.\n\nExecutable: ${review.executableIdentity}\nPackage: ${review.packageDigest}\n\nRemember this choice for this project's session in the current window. Refreshing or switching files will not ask again. Restarting the app, changing projects, or a changed plugin/Node identity requires confirmation again.`,
    confirmLabel: "Enable language services", cancelLabel: "Not now",
  };
}
