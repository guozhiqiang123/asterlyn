import { readManagedLanguageEnvironment } from "../adapters/tauri/tauri-managed-language-bridge.ts";
import type { PluginManagementSnapshot } from "../application/plugins/plugin-types.ts";
import type { EditorDocument } from "../editor-document.ts";
import type { ProjectFilesState } from "../features/files-editor/project-files-controller.ts";
import type { ManagedLanguageStatusCopy } from "../localization/language-service-copy.ts";
import {
  ManagedLanguageStatusRuntime,
  managedLanguageStatusContext,
  type ManagedLanguageManagementHost,
} from "./managed-language-status-runtime.ts";

export interface ManagedLanguageStatusBootstrapPorts {
  readonly workspaceRoot: () => string | null;
  readonly document: () => EditorDocument;
  readonly files: () => ProjectFilesState;
  readonly locale: () => string;
  readonly copy: () => ManagedLanguageStatusCopy;
  readonly openManagement: (pluginId: string | null) => void;
  readonly reportError: (error: unknown) => void;
}

export function startManagedLanguageStatus(
  root: HTMLElement,
  host: ManagedLanguageManagementHost & { readonly pluginManagementSnapshot: PluginManagementSnapshot },
  ports: ManagedLanguageStatusBootstrapPorts,
): ManagedLanguageStatusRuntime {
  return new ManagedLanguageStatusRuntime(root, { read: readManagedLanguageEnvironment }, {
    context: () => managedLanguageStatusContext(ports.workspaceRoot(), ports.document(), ports.files()),
    locale: ports.locale,
    copy: ports.copy,
    openManagement: ports.openManagement,
    reportError: ports.reportError,
  }).connectManagement(host);
}
