export interface TaskExecutionCopy {
  readonly title: string; readonly provenance: string; readonly executable: string; readonly arguments: string;
  readonly cwd: string; readonly trust: string; readonly trustAction: string; readonly deny: string; readonly confirm: string; readonly cancel: string;
  readonly trustRequired: string; readonly outputTruncated: string; readonly status: Record<string, string>;
}
export const EN_US_TASK_EXECUTION_COPY: TaskExecutionCopy = Object.freeze({
  title: "Confirm task execution", provenance: "Provenance", executable: "Executable", arguments: "Arguments", cwd: "Working directory", trust: "Workspace trust", trustAction: "Trust", deny: "Deny", confirm: "Confirm", cancel: "Cancel", trustRequired: "Trust this workspace before running the task.", outputTruncated: "Output was truncated.", status: { idle: "Idle", review: "Awaiting confirmation", queued: "Queued", running: "Running", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", crashed: "Crashed" },
});
export const ZH_CN_TASK_EXECUTION_COPY: TaskExecutionCopy = Object.freeze({
  title: "确认执行任务", provenance: "来源", executable: "可执行文件", arguments: "参数", cwd: "工作目录", trust: "工作区信任", trustAction: "信任", deny: "拒绝", confirm: "确认", cancel: "取消", trustRequired: "请先信任此工作区，再运行任务。", outputTruncated: "输出已截断。", status: { idle: "空闲", review: "等待确认", queued: "排队中", running: "运行中", succeeded: "已完成", failed: "失败", cancelled: "已取消", crashed: "崩溃" },
});
