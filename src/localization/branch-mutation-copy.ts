import type { BranchMutationKind } from "../models.ts";

export interface BranchMutationCopy {
  titles: Record<BranchMutationKind, string>;
  descriptions: Record<BranchMutationKind, string>;
  actions: Record<BranchMutationKind, string>;
  progress(kind: BranchMutationKind, source: string): string;
  completed(kind: BranchMutationKind, source: string, destination: string | null, remote: string | null): string;
  source: string;
  object: string;
  destination: string;
  currentHead: string;
  upstream: string;
  noUpstream: string;
  mergedIntoCurrent: string;
  remoteBranch: string;
  deleteRemote: string;
  deleteRemoteUnavailable: string;
  deleteLocalAndRemote: string;
  localOnly: string;
  localAndRemote: string;
  branchName: string;
  branchNameRequired: string;
  cancel: string;
  working: string;
  failed: string;
}

export const EN_US_BRANCH_MUTATION_COPY: BranchMutationCopy = {
  titles: {
    switch: "Switch Branch", create: "Create Branch",
    checkoutRemote: "Check Out Remote Branch", rename: "Rename Local Branch",
    delete: "Delete Local Branch",
  },
  descriptions: {
    switch: "Switch the current worktree to this exact local branch after checking the worktree again.",
    create: "Create and switch to a new local branch at the selected exact object. No upstream is inherited.",
    checkoutRemote: "Create and switch to a local branch at the selected remote-tracking object, then set that exact upstream.",
    rename: "Rename only the selected local reference. Its remote branch is not renamed.",
    delete: "Delete this merged, unused local branch. Its supported remote upstream can be selected explicitly below.",
  },
  actions: {
    switch: "Switch Branch", create: "Create and Switch", checkoutRemote: "Check Out",
    rename: "Rename Branch", delete: "Delete Local Branch",
  },
  progress: (kind, source) => `${{
    switch: "Switching to", create: "Creating from", checkoutRemote: "Checking out",
    rename: "Renaming", delete: "Deleting",
  }[kind]} ${source}…`,
  completed: (kind, source, destination, remote) => `${{
    switch: `Switched to ${source}`, create: `Created and switched to ${destination ?? source}`,
    checkoutRemote: `Checked out ${destination ?? source}`, rename: `Renamed ${source} to ${destination ?? source}`,
    delete: remote ? `Deleted local branch ${source} and its branch on ${remote}` : `Deleted local branch ${source}`,
  }[kind]}`,
  source: "Reviewed source", object: "Exact object", destination: "Destination",
  currentHead: "Current HEAD", upstream: "Upstream", noUpstream: "None",
  mergedIntoCurrent: "Confirmed merged into current HEAD", remoteBranch: "Remote branch",
  deleteRemote: "Also delete its remote branch", deleteRemoteUnavailable: "This branch has no supported remote upstream.",
  deleteLocalAndRemote: "Delete Local and Remote Branches",
  localOnly: "The remote branch and commit objects are not deleted.",
  localAndRemote: "The exact last-fetched remote branch will be deleted first with a lease; commit objects are not deleted.",
  branchName: "Local branch name", branchNameRequired: "Enter a local branch name.",
  cancel: "Cancel",
  working: "Applying…", failed: "The branch change did not complete. Review the refreshed repository state before retrying.",
};

export const ZH_CN_BRANCH_MUTATION_COPY: BranchMutationCopy = {
  titles: {
    switch: "切换分支", create: "创建分支",
    checkoutRemote: "检出远程分支", rename: "重命名本地分支", delete: "删除本地分支",
  },
  descriptions: {
    switch: "再次检查工作区后，将当前工作树切换到这个精确本地分支。",
    create: "在所选精确对象处创建并切换到新本地分支，不继承上游。",
    checkoutRemote: "在所选远程跟踪对象处创建并切换到本地分支，然后设置这个精确上游。",
    rename: "只重命名所选本地引用，不会重命名远程分支。",
    delete: "删除已合并且未被任何关联工作树使用的本地分支；可在下方明确选择同时删除其受支持的远程上游。",
  },
  actions: {
    switch: "切换分支", create: "创建并切换", checkoutRemote: "检出",
    rename: "重命名分支", delete: "删除本地分支",
  },
  progress: (kind, source) => `${{
    switch: "正在切换到", create: "正在从此处创建", checkoutRemote: "正在检出",
    rename: "正在重命名", delete: "正在删除",
  }[kind]} ${source}…`,
  completed: (kind, source, destination, remote) => `${{
    switch: `已切换到 ${source}`, create: `已创建并切换到 ${destination ?? source}`,
    checkoutRemote: `已检出 ${destination ?? source}`, rename: `已将 ${source} 重命名为 ${destination ?? source}`,
    delete: remote ? `已删除本地分支 ${source} 及其在 ${remote} 上的分支` : `已删除本地分支 ${source}`,
  }[kind]}`,
  source: "已审查起点", object: "精确对象", destination: "目标",
  currentHead: "当前 HEAD", upstream: "上游", noUpstream: "无",
  mergedIntoCurrent: "已确认合并到当前 HEAD", remoteBranch: "远程分支",
  deleteRemote: "同时删除对应的远程分支", deleteRemoteUnavailable: "此分支没有受支持的远程上游。",
  deleteLocalAndRemote: "删除本地和远程分支",
  localOnly: "不会删除远程分支或提交对象。",
  localAndRemote: "将先用精确 lease 删除最后获取到的远程分支；不会删除提交对象。",
  branchName: "本地分支名称", branchNameRequired: "请输入本地分支名称。",
  cancel: "取消",
  working: "正在应用…", failed: "分支变更未完成。重试前请检查已刷新的仓库状态。",
};
