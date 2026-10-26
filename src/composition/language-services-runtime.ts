import type { PluginContributionRegistry } from "../application/plugins/index.ts";
import { createEditorLanguageServicePort, type NativeLanguageServiceBridge } from "../features/language-services/language-service-client.ts";
import type { EditorLanguageServiceHandle, EditorLanguageServiceLocation, EditorLanguageServicePortFactory } from "../protocol/editor-language-service.ts";
import type { ApplicationConfirmationRequest } from "../shared/application-confirmation-dialog.ts";

export interface LanguageServicesRuntimeOptions {
  readonly registry: PluginContributionRegistry;
  readonly native: NativeLanguageServiceBridge;
  readonly workspace: () => { root: string; generation: number } | null;
  readonly document: (handle: EditorLanguageServiceHandle) => { workspacePath: string; readOnly: boolean; loadEpoch: number } | null;
  readonly bind: (factory: EditorLanguageServicePortFactory | null) => void;
  readonly reportError: (error: unknown) => void;
  readonly navigate: (location: EditorLanguageServiceLocation) => void;
}
const LANGUAGES: Readonly<Record<string, string>> = { ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact" };
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
    const provider = providers[0]!; const uri = workspaceFileUri(workspace.root, document.workspacePath);
    return uri ? { workspaceRoot: workspace.root, workspaceGeneration: workspace.generation, uri, languageId, pluginId: provider.pluginId, providerVersion: provider.pluginVersion } : null;
  }, options.native, options.reportError, options.navigate);
  let key = "";
  const refresh = () => {
    const workspace = options.workspace();
    const next = JSON.stringify([workspace, options.registry.list().filter((item) => item.kind === "language-service").map((item) => [item.qualifiedId, item.pluginVersion])]);
    if (key === next) return;
    key = next; factory.reconcile();
    // A new binding identity refreshes existing cached editors once when admission/activation changes.
    options.bind((handle) => factory(handle));
  };
  const release = options.registry.subscribe(refresh);
  return { refresh, dispose: () => { release(); options.bind(null); factory.dispose(); } };
}
export function languageExecutionConfirmation(review: Parameters<NativeLanguageServiceBridge["confirm"]>[0], chinese: boolean): ApplicationConfirmationRequest {
  return chinese ? {
    title: "启用 TypeScript / JavaScript 语言服务？",
    message: `插件 ${review.pluginId} ${review.pluginVersion} 将通过本机 Node.js 运行随包附带的语言服务，并读取当前项目与打开的源文件。该进程具有当前用户的系统权限。\n\n执行程序：${review.executableIdentity}\n插件校验：${review.packageDigest}\n\n本次项目会话内记住此选择。`,
    confirmLabel: "启用语言服务", cancelLabel: "暂不启用",
  } : {
    title: "Enable TypeScript / JavaScript language services?",
    message: `Plugin ${review.pluginId} ${review.pluginVersion} will run its packaged language server with local Node.js and read this project and its open source files. The process has your user account's system permissions.\n\nExecutable: ${review.executableIdentity}\nPackage: ${review.packageDigest}\n\nRemember this choice for this project session.`,
    confirmLabel: "Enable language services", cancelLabel: "Not now",
  };
}

export async function navigateLanguageDefinition(location: EditorLanguageServiceLocation, ports: {
  workspace(): { root: string; generation: number } | null;
  files(): readonly import("../models.ts").ProjectFile[];
  open(root: string, file: import("../models.ts").ProjectFile): Promise<void>;
  content(): string | null;
  select(from: number, to: number): void;
}): Promise<void> {
  const workspace = ports.workspace(); if (!workspace) return;
  const file = ports.files().find((item) => workspaceFileUri(workspace.root, item.workspacePath) === location.uri);
  if (!file || file.readOnly) return;
  await ports.open(workspace.root, file);
  const current = ports.workspace(); if (current?.root !== workspace.root || current.generation !== workspace.generation) return;
  const content = ports.content()?.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n"); if (content === undefined) return;
  const lines = content.split("\n");
  const offset = (pos: { line: number; character: number }) => {
    if (!Number.isSafeInteger(pos.line) || !Number.isSafeInteger(pos.character) || pos.line < 0 || pos.character < 0 || pos.line >= lines.length || pos.character > lines[pos.line]!.length) return null;
    return lines.slice(0, pos.line).reduce((sum, text) => sum + text.length + 1, 0) + pos.character;
  };
  const from = offset(location.range.start), to = offset(location.range.end);
  if (from !== null && to !== null && from <= to) ports.select(from, to);
}
