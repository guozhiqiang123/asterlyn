import type { TaskProviderSnapshot } from "../tasks/index.ts";
import type { TaskExecutionRequest } from "../../models.ts";

export interface PluginWorkspaceIdentity {
  readonly root: string;
  readonly generation: number;
}

export interface PluginEvidenceSnapshot {
  readonly [key: string]: unknown;
}

export interface PluginWorkspaceCatalogFile {
  readonly workspacePath: string;
}

export interface PluginWorkspaceCatalogEvidence extends PluginEvidenceSnapshot {
  readonly kind: "workspace-catalog";
  readonly platform: "posix" | "windows";
  readonly files: readonly PluginWorkspaceCatalogFile[];
  readonly truncated: boolean;
}

export type PluginDiagnosticKind = "activation-failed" | "invalid-contribution" | "duplicate-contribution";

export interface PluginDiagnostic {
  readonly kind: PluginDiagnosticKind;
  readonly pluginId: string;
  readonly message: string;
  readonly error?: unknown;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface PluginCommandContribution {
  readonly kind: "command";
  readonly id: string;
  readonly title: () => string;
  readonly detail: () => string;
  readonly keywords?: () => string;
  readonly availability?: () => { readonly enabled: boolean; readonly reason?: string };
  readonly providerId?: string;
  readonly execute: () => void | Promise<void>;
}

export interface PluginProviderContribution {
  readonly kind: "provider";
  readonly id: string;
  readonly label: string;
  readonly snapshot: () => TaskProviderSnapshot;
  readonly subscribe?: (listener: () => void) => Disposable;
  readonly refresh?: () => PluginTaskRefreshPlan | null | Promise<PluginTaskRefreshPlan | null>;
  /** Returns a host-reviewed execution plan for a task. Plugins never receive the bridge. */
  readonly run?: (taskId: string) => PluginTaskRunPlan | null | Promise<PluginTaskRunPlan | null>;
}

export interface PluginTaskExecutionResult {
  readonly status: "succeeded" | "failed" | "cancelled" | "crashed";
  readonly outputs: readonly { readonly stream: "stdout" | "stderr"; readonly dataBase64: string }[];
  readonly truncated: boolean;
  readonly error: string | null;
}

export interface PluginTaskRefreshPlan {
  readonly request: TaskExecutionRequest;
  readonly apply: (result: PluginTaskExecutionResult) => void;
}

/** Execution plans are deliberately the only value a provider may return to the host. */
export interface PluginTaskRunPlan extends PluginTaskRefreshPlan {}

export type PluginContribution = PluginCommandContribution | PluginProviderContribution;

export interface PluginActivationContext {
  readonly identity: PluginWorkspaceIdentity;
  readonly evidence: PluginEvidenceSnapshot;
  contribute(contribution: PluginContribution): Disposable;
}

export interface PluginMatchContext {
  readonly identity: PluginWorkspaceIdentity;
  readonly evidence: PluginEvidenceSnapshot;
}

export interface BundledPlugin {
  readonly id: string;
  readonly version: string;
  readonly matches: (context: PluginMatchContext) => boolean;
  readonly evidenceKey?: (context: PluginMatchContext) => string;
  readonly activate: (context: PluginActivationContext) => void | Disposable | Promise<void | Disposable>;
}

export type RegisteredPluginContribution = PluginContribution & {
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly qualifiedId: string;
};

export interface PluginActivationReport {
  readonly identity: PluginWorkspaceIdentity;
  readonly activated: readonly string[];
  readonly skipped: readonly string[];
  readonly diagnostics: readonly PluginDiagnostic[];
}
