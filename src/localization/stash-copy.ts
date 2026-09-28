export interface StashCopy {
  title: string;
  listAria: string;
  filesAria: string;
  loading: string;
  loadingFiles: string;
  empty: string;
  selectStash: string;
  noFiles: string;
  retry: string;
  truncated: string;
  apply: string;
  pop: string;
  unstash: string;
  drop: string;
  clear: string;
  showDiff: string;
  showDiffNewTab: string;
  reinstateIndex: string;
  newBranch: string;
  newBranchPlaceholder: string;
  applyMode: string;
  popMode: string;
  unstashTitle: string;
  execute: string;
  dropTitle: string;
  dropMessage(reference: string): string;
  clearTitle: string;
  clearMessage: string;
  mutationAction: string;
  operationComplete(action: string): string;
  cleanRequired: string;
  changedRefresh: string;
}

export const EN_US_STASH_COPY: StashCopy = {
  title: "Stash", listAria: "Stashed changes", filesAria: "Files in selected stash",
  loading: "Loading stashes…", loadingFiles: "Loading stashed files…", empty: "No stashed changes",
  selectStash: "Select a stash to inspect its files.", noFiles: "This stash has no changed files.",
  retry: "Retry", truncated: "Some stash lists were truncated. Clear is disabled until the complete list is available.",
  apply: "Apply", pop: "Pop", unstash: "Unstash…", drop: "Drop", clear: "Clear",
  showDiff: "Show Diff", showDiffNewTab: "Show Diff in a New Tab", reinstateIndex: "Reinstate index",
  newBranch: "Apply to a new branch", newBranchPlaceholder: "Branch name", applyMode: "Apply and keep stash",
  popMode: "Apply and remove stash", unstashTitle: "Unstash Changes", execute: "Unstash",
  dropTitle: "Drop Stash", dropMessage: (reference) => `Permanently drop ${reference}?`,
  clearTitle: "Clear Stashes", clearMessage: "Permanently remove all stashes in this repository?",
  mutationAction: "changing stashed changes", operationComplete: (action) => `Stash ${action} completed.`,
  cleanRequired: "Save files and clean the working tree before applying a stash.",
  changedRefresh: "The stash list changed. It has been refreshed; review the selection and try again.",
};

export const ZH_CN_STASH_COPY: StashCopy = {
  title: "贮藏", listAria: "贮藏列表", filesAria: "所选贮藏中的文件",
  loading: "正在加载贮藏…", loadingFiles: "正在加载贮藏文件…", empty: "没有贮藏的更改",
  selectStash: "选择一项贮藏以查看文件。", noFiles: "此贮藏没有变更文件。",
  retry: "重试", truncated: "部分贮藏列表已截断。在完整列表可用前不能清空。",
  apply: "应用", pop: "弹出", unstash: "取消贮藏…", drop: "删除", clear: "全部清空",
  showDiff: "显示差异", showDiffNewTab: "在新标签页显示差异", reinstateIndex: "恢复暂存区状态",
  newBranch: "应用到新分支", newBranchPlaceholder: "分支名称", applyMode: "应用并保留贮藏",
  popMode: "应用并删除贮藏", unstashTitle: "取消贮藏更改", execute: "执行",
  dropTitle: "删除贮藏", dropMessage: (reference) => `永久删除 ${reference}？`,
  clearTitle: "清空贮藏", clearMessage: "永久删除此仓库中的全部贮藏？",
  mutationAction: "处理贮藏的更改", operationComplete: (action) => `贮藏${action}已完成。`,
  cleanRequired: "应用贮藏前请先保存文件并保持工作区干净。",
  changedRefresh: "贮藏列表已经变化。列表已刷新，请重新检查后再试。",
};
