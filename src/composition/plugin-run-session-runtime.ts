import type {
  PluginRunArtifact,
  PluginRunArtifactSidecar,
  PluginStagedRunPlan,
  PluginTaskExecutionResult,
  PluginToolOperationRequest,
  PluginToolOperationResult,
  PluginWorkspaceIdentity,
} from "../application/plugins/index.ts";
import type { TaskTerminalSessionPort, TaskTerminalSessionStatus } from "../application/tasks/task-terminal-session.ts";

export type PluginRunSessionStatus = "running" | "succeeded" | "failed" | "cancelled" | "crashed";
export type PluginRunTerminalStatus = Exclude<PluginRunSessionStatus, "running">;

export interface PluginRunSessionSnapshot {
  readonly requestId: string;
  readonly pluginId: string;
  readonly label: string;
  readonly status: PluginRunSessionStatus;
  readonly phase: "building" | "resolving-artifact" | "validating-target" | "installing" | "launching";
  readonly error: string | null;
}

export interface PluginRunSessionRequest {
  readonly identity: PluginWorkspaceIdentity;
  readonly pluginId: string;
  readonly label: string;
  readonly plan: PluginStagedRunPlan;
  readonly revalidateTarget: () => Promise<boolean>;
}

export interface PluginRunSessionRuntimeOptions {
  readonly executeBuild: (
    identity: PluginWorkspaceIdentity,
    plan: NonNullable<PluginStagedRunPlan["build"] | PluginStagedRunPlan["install"]>,
    signal: AbortSignal,
    cancel: () => void,
  ) => Promise<{ readonly result: PluginTaskExecutionResult; readonly terminalSessionId: string | null }>;
  readonly discoverArtifacts: (
    identity: PluginWorkspaceIdentity,
    hints: readonly string[],
    sidecarNames: readonly string[],
  ) => Promise<{ readonly artifacts: readonly PluginRunArtifact[]; readonly sidecars: readonly PluginRunArtifactSidecar[] }>;
  readonly executeTool: (
    pluginId: string,
    identity: PluginWorkspaceIdentity,
    requestId: string,
    request: PluginToolOperationRequest,
  ) => Promise<PluginToolOperationResult>;
  readonly cancelTool: (pluginId: string, identity: PluginWorkspaceIdentity, requestId: string) => Promise<void>;
  readonly taskTerminal?: TaskTerminalSessionPort;
  readonly changed: (snapshot: PluginRunSessionSnapshot | null) => void;
  readonly completed: (
    request: PluginRunSessionRequest,
    snapshot: PluginRunSessionSnapshot & { readonly status: PluginRunTerminalStatus },
    buildResult: PluginTaskExecutionResult | null,
  ) => void;
  readonly reportError: (error: unknown) => void;
}

export class PluginRunSessionRuntime {
  private readonly options: PluginRunSessionRuntimeOptions;
  private active: { request: PluginRunSessionRequest; abort: AbortController; toolRequestId: string | null } | null = null;
  private value: PluginRunSessionSnapshot | null = null;
  private sequence = 0;

  constructor(options: PluginRunSessionRuntimeOptions) {
    this.options = options;
  }

  get snapshot(): PluginRunSessionSnapshot | null { return this.value; }
  get busy(): boolean { return this.active !== null; }

  async run(request: PluginRunSessionRequest): Promise<void> {
    if (this.active) throw new Error("A plugin Run session is already active.");
    const requestId = `plugin-run-${Date.now()}-${++this.sequence}`;
    const abort = new AbortController();
    this.active = { request, abort, toolRequestId: null };
    let terminalSessionId: string | null = null;
    let buildResult: PluginTaskExecutionResult | null = null;
    this.publish({ requestId, pluginId: request.pluginId, label: request.label, status: "running", phase: "building", error: null });
    try {
      const buildPlan = stagedBuildPlan(request.plan);
      const build = await this.options.executeBuild(request.identity, buildPlan, abort.signal, () => this.cancel());
      buildResult = build.result;
      terminalSessionId = build.terminalSessionId;
      safelyApply(() => buildPlan.apply(build.result), this.options.reportError);
      if (build.result.status !== "succeeded") {
        this.finish(taskStatus(build.result.status), "building", build.result.error, terminalSessionId, build.result.truncated, request, buildResult);
        return;
      }
      this.phase("resolving-artifact");
      this.append(terminalSessionId, "\r\n[Asterlyn] Resolving built Android application…\r\n");
      const hints = buildPlan.artifactSearch?.hints;
      if (!hints || hints.length === 0) throw new Error("Run plan did not declare an artifact search.");
      const discovery = await this.options.discoverArtifacts(request.identity, hints, buildPlan.artifactSearch?.sidecarNames ?? []);
      this.ensureActive(request, abort);
      const inspectionRequest = await request.plan.inspect(discovery.artifacts, discovery.sidecars);
      if (!inspectionRequest) throw new Error("Run plan could not resolve one authoritative APK artifact.");
      const inspection = await this.executeTool(request, requestId, "inspect", inspectionRequest, abort);
      this.appendToolResult(terminalSessionId, inspection);
      if (inspection.status !== "succeeded") throw operationError("APK inspection", inspection);

      this.phase("validating-target");
      this.append(terminalSessionId, "[Asterlyn] Revalidating selected device…\r\n");
      if (!await request.revalidateTarget()) throw new Error("The selected Android device is no longer online and selectable.");
      this.ensureActive(request, abort);

      if (request.plan.deploy) {
        this.phase("installing");
        const deployRequest = await request.plan.deploy(inspection);
        if (!deployRequest) throw new Error("Run plan could not create an exact-device installation request.");
        this.append(terminalSessionId, "[Asterlyn] Installing application on selected device…\r\n");
        const deployment = await this.executeTool(request, requestId, "install", deployRequest, abort);
        this.appendToolResult(terminalSessionId, deployment);
        if (deployment.status !== "succeeded") throw operationError("Android installation", deployment);
        this.phase("validating-target");
        this.append(terminalSessionId, "[Asterlyn] Revalidating selected device after installation…\r\n");
        if (!await request.revalidateTarget()) throw new Error("The selected Android device disconnected after installation.");
        this.ensureActive(request, abort);
      }

      this.phase("launching");
      const launchRequest = await request.plan.launch(inspection);
      if (!launchRequest) throw new Error("Run plan could not resolve the Android launch component.");
      this.append(terminalSessionId, "[Asterlyn] Launching application…\r\n");
      const launch = await this.executeTool(request, requestId, "launch", launchRequest, abort);
      this.appendToolResult(terminalSessionId, launch);
      if (launch.status !== "succeeded") throw operationError("Android launch", launch);
      this.finish("succeeded", "launching", null, terminalSessionId, build.result.truncated || launch.truncated, request, buildResult);
    } catch (error) {
      const cancelled = abort.signal.aborted;
      const message = cancelled ? "Run was cancelled." : error instanceof Error ? error.message : String(error);
      const status: PluginRunSessionStatus = cancelled ? "cancelled" : "failed";
      this.finish(status, this.value?.phase ?? "building", message, terminalSessionId, buildResult?.truncated ?? false, request, buildResult);
    } finally {
      if (this.active?.request === request) this.active = null;
    }
  }

  cancel(): void {
    const active = this.active;
    if (!active || active.abort.signal.aborted) return;
    active.abort.abort();
    if (active.toolRequestId) {
      void this.options.cancelTool(active.request.pluginId, active.request.identity, active.toolRequestId).catch(this.options.reportError);
    }
  }

  dispose(): void {
    this.reset();
  }

  reset(): void {
    this.cancel();
    this.active = null;
    this.value = null;
    this.options.changed(null);
  }

  private async executeTool(
    request: PluginRunSessionRequest,
    sessionRequestId: string,
    suffix: string,
    operation: PluginToolOperationRequest,
    abort: AbortController,
  ): Promise<PluginToolOperationResult> {
    this.ensureActive(request, abort);
    const requestId = `${sessionRequestId}-${suffix}`;
    if (this.active) this.active.toolRequestId = requestId;
    try {
      return await this.options.executeTool(request.pluginId, request.identity, requestId, operation);
    } finally {
      if (this.active?.toolRequestId === requestId) this.active.toolRequestId = null;
    }
  }

  private ensureActive(request: PluginRunSessionRequest, abort: AbortController): void {
    if (abort.signal.aborted || this.active?.request !== request) throw new Error("Run was cancelled.");
  }

  private phase(phase: PluginRunSessionSnapshot["phase"]): void {
    if (!this.value) return;
    this.publish({ ...this.value, status: "running", phase, error: null });
  }

  private finish(
    status: PluginRunTerminalStatus,
    phase: PluginRunSessionSnapshot["phase"],
    error: string | null,
    terminalSessionId: string | null,
    truncated: boolean,
    request: PluginRunSessionRequest,
    installResult: PluginTaskExecutionResult | null,
  ): void {
    if (this.active?.request !== request) return;
    const snapshot = { ...(this.value ?? {
      requestId: "plugin-run", pluginId: request.pluginId, label: request.label,
    }), status, phase, error } satisfies PluginRunSessionSnapshot & { readonly status: PluginRunTerminalStatus };
    this.publish(snapshot);
    safelyApply(() => request.plan.apply({ status, phase, error }), this.options.reportError);
    safelyApply(() => {
      if (terminalSessionId) {
        if (error) this.append(terminalSessionId, `[Asterlyn] ${error}\r\n`);
        this.options.taskTerminal?.update(terminalSessionId, terminalStatus(status), error, truncated);
      }
    }, this.options.reportError);
    safelyApply(() => this.options.completed(request, snapshot, installResult), this.options.reportError);
  }

  private appendToolResult(sessionId: string | null, result: PluginToolOperationResult): void {
    if (result.stdout) this.append(sessionId, result.stdout);
    if (result.stderr) this.append(sessionId, result.stderr, "stderr");
  }

  private append(sessionId: string | null, value: string, stream: "stdout" | "stderr" = "stdout"): void {
    if (!sessionId || !value) return;
    this.options.taskTerminal?.append(sessionId, { stream, dataBase64: encodeUtf8(value) });
  }

  private publish(snapshot: PluginRunSessionSnapshot): void {
    this.value = Object.freeze(snapshot);
    this.options.changed(this.value);
  }
}

function taskStatus(status: PluginTaskExecutionResult["status"]): PluginRunTerminalStatus {
  return status;
}

function stagedBuildPlan(plan: PluginStagedRunPlan): NonNullable<PluginStagedRunPlan["build"] | PluginStagedRunPlan["install"]> {
  const task = plan.build ?? plan.install;
  if (!task) throw new Error("Run plan did not declare a build task.");
  return task;
}

function terminalStatus(status: PluginRunTerminalStatus): TaskTerminalSessionStatus {
  return status;
}

function operationError(label: string, result: PluginToolOperationResult): Error {
  const detail = result.error || result.stderr.trim() || result.stdout.trim();
  return new Error(detail ? `${label} failed: ${detail}` : `${label} failed.`);
}

function safelyApply(apply: () => void, reportError: (error: unknown) => void): void {
  try { apply(); } catch (error) { reportError(error); }
}

function encodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}
