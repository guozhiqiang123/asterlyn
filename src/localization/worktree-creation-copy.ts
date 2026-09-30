export interface WorktreeCreationCopy {
  title: string;
  description: string;
  fromBranch: string;
  newBranch: string;
  newBranchName: string;
  projectName: string;
  location: string;
  browse: string;
  createdIn: string;
  cancel: string;
  create: string;
  creating: string;
  sourceRequired: string;
  projectNameRequired: string;
  branchNameRequired: string;
  locationRequired: string;
  chooserUnavailable: string;
  progress(name: string): string;
  completed(path: string): string;
  failed: string;
}

export const EN_US_WORKTREE_CREATION_COPY: WorktreeCreationCopy = {
  title: "New Worktree",
  description: "Create an isolated checkout at the exact selected branch object.",
  fromBranch: "From branch",
  newBranch: "New branch",
  newBranchName: "New local branch name",
  projectName: "Project name",
  location: "Location",
  browse: "Choose parent folder",
  createdIn: "The worktree will be created in",
  cancel: "Cancel",
  create: "Create Worktree",
  creating: "Creating…",
  sourceRequired: "Select a local or remote-tracking branch.",
  projectNameRequired: "Enter a project name.",
  branchNameRequired: "Enter a new local branch name.",
  locationRequired: "Choose a parent folder.",
  chooserUnavailable: "The system folder chooser is unavailable in this build.",
  progress: (name) => `Creating worktree ${name}…`,
  completed: (path) => `Created worktree at ${path}`,
  failed: "The worktree could not be created. Review the fields and try again.",
};

export const ZH_CN_WORKTREE_CREATION_COPY: WorktreeCreationCopy = {
  title: "新建工作树",
  description: "在所选分支的精确对象处创建一个独立检出目录。",
  fromBranch: "来源分支",
  newBranch: "新建分支",
  newBranchName: "新本地分支名称",
  projectName: "项目名称",
  location: "位置",
  browse: "选择父文件夹",
  createdIn: "工作树将创建在",
  cancel: "取消",
  create: "创建工作树",
  creating: "正在创建…",
  sourceRequired: "请选择一个本地或远程跟踪分支。",
  projectNameRequired: "请输入项目名称。",
  branchNameRequired: "请输入新本地分支名称。",
  locationRequired: "请选择父文件夹。",
  chooserUnavailable: "此构建无法使用系统文件夹选择器。",
  progress: (name) => `正在创建工作树 ${name}…`,
  completed: (path) => `已在 ${path} 创建工作树`,
  failed: "无法创建工作树，请检查各字段后重试。",
};
