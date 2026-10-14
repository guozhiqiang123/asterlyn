export interface TaskExecutionCopy {
  readonly title: string; readonly provenance: string; readonly executable: string; readonly arguments: string;
  readonly cwd: string; readonly trust: string; readonly trustAction: string; readonly deny: string; readonly confirm: string; readonly starting: string; readonly cancel: string; readonly cancelling: string; readonly retry: string; readonly closeOutput: string;
  readonly trustRequired: string; readonly busy: string; readonly timedOut: string; readonly outputTruncated: string; readonly artifacts: string; readonly artifactSearching: string; readonly artifactNone: string; readonly artifactUnavailable: string; readonly artifactTruncated: string; readonly revealArtifact: string; readonly artifactSize: (bytes: number) => string; readonly status: Record<string, string>;
}
export const EN_US_TASK_EXECUTION_COPY: TaskExecutionCopy = Object.freeze({
  title: "Confirm task execution", provenance: "Provenance", executable: "Executable", arguments: "Arguments", cwd: "Working directory", trust: "Workspace trust", trustAction: "Trust", deny: "Deny", confirm: "Confirm", starting: "Starting…", cancel: "Cancel", cancelling: "Cancelling…", retry: "Retry", closeOutput: "Close output", trustRequired: "Trust this workspace before running the task.", busy: "Another task is already running for this workspace.", timedOut: "Task discovery timed out. Check the Gradle environment and retry.", outputTruncated: "Output was truncated.", artifacts: "Build artifacts", artifactSearching: "Locating APK/AAB artifacts…", artifactNone: "No APK/AAB artifacts were found.", artifactUnavailable: "Artifact discovery was unavailable.", artifactTruncated: "Artifact results were truncated.", revealArtifact: "Reveal artifact", artifactSize: formatArtifactSize, status: { idle: "Idle", review: "Awaiting confirmation", starting: "Starting…", queued: "Queued", running: "Running", cancelling: "Cancelling…", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", crashed: "Crashed" },
});
export const ZH_CN_TASK_EXECUTION_COPY: TaskExecutionCopy = Object.freeze({
  title: "确认执行任务", provenance: "来源", executable: "可执行文件", arguments: "参数", cwd: "工作目录", trust: "工作区信任", trustAction: "信任", deny: "拒绝", confirm: "确认", starting: "正在启动…", cancel: "取消", cancelling: "正在取消…", retry: "重试", closeOutput: "关闭输出", trustRequired: "请先信任此工作区，再运行任务。", busy: "此工作区已有任务正在运行。", timedOut: "任务发现超时，请检查 Gradle 环境后重试。", outputTruncated: "输出已截断。", artifacts: "构建产物", artifactSearching: "正在定位 APK/AAB 产物…", artifactNone: "未找到 APK/AAB 产物。", artifactUnavailable: "无法发现构建产物。", artifactTruncated: "产物结果已截断。", revealArtifact: "在文件管理器中显示", artifactSize: formatArtifactSize, status: { idle: "空闲", review: "等待确认", starting: "正在启动…", queued: "排队中", running: "运行中", cancelling: "正在取消…", succeeded: "已完成", failed: "失败", cancelled: "已取消", crashed: "崩溃" },
});

function formatArtifactSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
