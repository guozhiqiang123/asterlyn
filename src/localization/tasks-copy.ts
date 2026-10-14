import type { TasksCopy } from "./catalog.ts";

export const EN_US_TASKS_COPY: TasksCopy = Object.freeze({
  title: "Tasks",
  ariaLabel: "Tasks tool window",
  refresh: "Refresh tasks",
  empty: "No task providers are active.",
  unavailable: "Task discovery is unavailable for this project.",
  unavailableReasons: {
    "discovery-not-supported": "This project does not support task discovery yet.",
    "evidence-incomplete": "The project catalog is incomplete, so task discovery is unavailable.",
    "workspace-untrusted": "Trust this workspace before discovering tasks.",
  },
  loading: "Loading tasks…",
  error: "Task discovery failed.",
  noResults: "No matching tasks.",
  queryPlaceholder: "Filter tasks",
  run: "Run task",
  notRunnable: "This task is not runnable.",
});

export const ZH_CN_TASKS_COPY: TasksCopy = Object.freeze({
  title: "任务",
  ariaLabel: "任务工具窗口",
  refresh: "刷新任务",
  empty: "当前没有活动的任务提供方。",
  unavailable: "此项目无法发现任务。",
  unavailableReasons: {
    "discovery-not-supported": "此项目暂不支持任务发现。",
    "evidence-incomplete": "项目目录不完整，无法发现任务。",
    "workspace-untrusted": "请先信任当前工作区，再发现任务。",
  },
  loading: "正在加载任务…",
  error: "任务发现失败。",
  noResults: "没有匹配的任务。",
  queryPlaceholder: "筛选任务",
  run: "运行任务",
  notRunnable: "此任务不可运行。",
});
