export interface RemoteManagementCopy {
  manageRemotes: string;
  title: string;
  addRemote: string;
  editRemote: string;
  deleteRemote: string;
  name: string;
  url: string;
  fetchRemote: string;
  noRemotes: string;
  addTitle: string;
  editTitle: string;
  deleteTitle: string;
  deleteDescription(name: string): string;
  fieldsRequired: string;
  working: string;
  save: string;
  delete: string;
  cancel: string;
  close: string;
  changed: string;
  failed: string;
}

export interface TopbarBranchMenuCopy {
  ariaLabel: string;
  manageRemotes: string;
  noBranch: string;
  localBranches: string;
  remoteBranches: string;
}

export interface GitResetCopy {
  menuItem: string;
  title: string;
  description(branch: string, oid: string, subject: string): string;
  modes: Record<"soft" | "mixed" | "hard" | "keep", string>;
  details: Record<"soft" | "mixed" | "hard" | "keep", string>;
  hardWarning: string;
  currentBranchOnly: string;
  preparing: string;
  working: string;
  reset: string;
  cancel: string;
  failed: string;
  headCommit: Record<"undoCommit" | "dropCommit", {
    title: string;
    description(branch: string, oid: string, subject: string): string;
    detail: string;
    warning: string | null;
    preparing: string;
    working: string;
    action: string;
    completed: string;
    failed: string;
  }>;
}

export const EN_REMOTE_MANAGEMENT_COPY: RemoteManagementCopy = {
  manageRemotes: "Manage Remotes…", title: "Git Remotes", addRemote: "Add remote",
  editRemote: "Edit selected remote", deleteRemote: "Delete selected remote",
  name: "Name", url: "URL", fetchRemote: "Fetch remote", noRemotes: "No remotes configured",
  addTitle: "Add Remote", editTitle: "Edit Remote", deleteTitle: "Delete Remote",
  deleteDescription: (name) => `Delete remote ${name}? Local commits are not deleted, but its remote-tracking refs and configuration will be removed.`,
  fieldsRequired: "Enter both a remote name and URL.", working: "Working…", save: "OK",
  delete: "Delete Remote", cancel: "Cancel", close: "OK", changed: "Remote configuration updated",
  failed: "The remote configuration could not be changed.",
};

export const ZH_REMOTE_MANAGEMENT_COPY: RemoteManagementCopy = {
  manageRemotes: "管理远程仓库…", title: "Git 远程仓库", addRemote: "新增远程仓库",
  editRemote: "编辑所选远程仓库", deleteRemote: "删除所选远程仓库",
  name: "名称", url: "URL", fetchRemote: "获取远程仓库", noRemotes: "尚未配置远程仓库",
  addTitle: "新增远程仓库", editTitle: "编辑远程仓库", deleteTitle: "删除远程仓库",
  deleteDescription: (name) => `确定删除远程仓库 ${name} 吗？本地提交不会被删除，但其远程跟踪引用和配置会被移除。`,
  fieldsRequired: "请同时输入远程仓库名称和 URL。", working: "处理中…", save: "确定",
  delete: "删除远程仓库", cancel: "取消", close: "确定", changed: "远程仓库配置已更新",
  failed: "无法更改远程仓库配置。",
};

export const EN_TOPBAR_BRANCH_COPY: TopbarBranchMenuCopy = {
  ariaLabel: "Current branch and branch actions", manageRemotes: "Manage Remotes…", noBranch: "No branch",
  localBranches: "Local", remoteBranches: "Remote",
};

export const ZH_TOPBAR_BRANCH_COPY: TopbarBranchMenuCopy = {
  ariaLabel: "当前分支与分支操作", manageRemotes: "管理远程仓库…", noBranch: "没有分支", localBranches: "本地", remoteBranches: "远程",
};

export const EN_GIT_RESET_COPY: GitResetCopy = {
  menuItem: "Reset to Here…", title: "Git Reset",
  description: (branch, oid, subject) => `${branch} → ${oid} “${subject}”\nThis resets the current branch head to the selected commit and updates the index and working tree according to the selected mode.`,
  modes: { soft: "Soft", mixed: "Mixed", hard: "Hard", keep: "Keep" },
  details: {
    soft: "Files won't change; differences will be staged for commit.",
    mixed: "Files won't change; differences won't be staged.",
    hard: "Files will be reverted to the selected commit.",
    keep: "Files will be reverted while compatible local changes are kept intact.",
  },
  hardWarning: "Warning: local changes will be lost.",
  currentBranchOnly: "Reset is available only for a non-HEAD commit in the current branch.",
  preparing: "Preparing exact reset review…", working: "Resetting…", reset: "Reset",
  cancel: "Cancel", failed: "The reviewed reset could not complete.",
  headCommit: {
    undoCommit: {
      title: "Undo Commit",
      description: (branch, oid, subject) => `Undo ${oid} “${subject}” on ${branch}?`,
      detail: "The branch moves to this commit's parent. Its file changes remain in the worktree and are not staged.",
      warning: null,
      preparing: "Verifying that the latest commit is still unpublished…",
      working: "Undoing commit…", action: "Undo Commit", completed: "Commit undone",
      failed: "The latest commit could not be undone.",
    },
    dropCommit: {
      title: "Drop Commit",
      description: (branch, oid, subject) => `Drop ${oid} “${subject}” from ${branch}?`,
      detail: "The branch and files move to this commit's parent.",
      warning: "The commit's file changes will be discarded. Recovery requires Git reflog knowledge.",
      preparing: "Verifying that the latest commit is still unpublished…",
      working: "Dropping commit…", action: "Drop Commit", completed: "Commit dropped",
      failed: "The latest commit could not be dropped.",
    },
  },
};

export const ZH_GIT_RESET_COPY: GitResetCopy = {
  menuItem: "重置到此处…", title: "Git 重置",
  description: (branch, oid, subject) => `${branch} → ${oid} “${subject}”\n这会把当前分支的 HEAD 重置到所选提交，并按选择的模式更新索引与工作区。`,
  modes: { soft: "软重置", mixed: "混合重置", hard: "硬重置", keep: "保留本地更改" },
  details: {
    soft: "文件不会变化，差异会进入暂存区。", mixed: "文件不会变化，差异不会进入暂存区。",
    hard: "文件会恢复为所选提交的状态。", keep: "文件会恢复，同时尽量保留兼容的本地更改。",
  },
  hardWarning: "警告：本地更改将会丢失。",
  currentBranchOnly: "只能把当前分支重置到其中一个非 HEAD 历史提交。",
  preparing: "正在准备精确的重置审查…", working: "正在重置…", reset: "重置",
  cancel: "取消", failed: "无法完成已审查的重置。",
  headCommit: {
    undoCommit: {
      title: "撤销提交",
      description: (branch, oid, subject) => `确定撤销 ${branch} 上的 ${oid}“${subject}”吗？`,
      detail: "分支会移动到该提交的父提交；文件改动保留在当前工作区且不会暂存。",
      warning: null,
      preparing: "正在确认最新提交仍未推送…",
      working: "正在撤销提交…", action: "撤销提交", completed: "已撤销提交",
      failed: "无法撤销最新提交。",
    },
    dropCommit: {
      title: "丢弃提交",
      description: (branch, oid, subject) => `确定从 ${branch} 丢弃 ${oid}“${subject}”吗？`,
      detail: "分支和文件都会移动到该提交的父提交。",
      warning: "该提交包含的文件改动会被丢弃；恢复时需要使用 Git reflog。",
      preparing: "正在确认最新提交仍未推送…",
      working: "正在丢弃提交…", action: "丢弃提交", completed: "已丢弃提交",
      failed: "无法丢弃最新提交。",
    },
  },
};
