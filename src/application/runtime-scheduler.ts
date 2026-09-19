export type ScheduledTask = unknown;

export interface RuntimeScheduler {
  schedule(task: () => void, delayMs: number): ScheduledTask;
  cancel(task: ScheduledTask): void;
}
