import type { TagMutationKind } from "../models.ts";

export interface TagMutationCopy {
  titles: Record<TagMutationKind, string>;
  descriptions: Record<TagMutationKind, string>;
  tagName: string;
  commit: string;
  remote: string;
  cancel: string;
  create: string;
  delete: string;
  working: string;
  tagNameRequired: string;
  failed: string;
  progress(kind: TagMutationKind, tagName: string, remote: string | null): string;
  completed(kind: TagMutationKind, tagName: string, remote: string | null): string;
}

export const EN_US_TAG_MUTATION_COPY: TagMutationCopy = {
  titles: { create: "New Tag", deleteLocal: "Delete Local Tag", deleteRemote: "Delete Remote Tag" },
  descriptions: {
    create: "Create a lightweight tag at the exact selected commit.",
    deleteLocal: "Delete this local tag. Any tag with the same name on a remote is retained.",
    deleteRemote: "Delete this tag from the selected remote. The local tag is retained.",
  },
  tagName: "Tag name", commit: "Commit", remote: "Remote", cancel: "Cancel",
  create: "Create Tag", delete: "Delete Tag", working: "Working…",
  tagNameRequired: "Enter a tag name.", failed: "The tag operation could not complete.",
  progress: (kind, tag, remote) => kind === "create"
    ? `Creating tag ${tag}…`
    : kind === "deleteLocal" ? `Deleting local tag ${tag}…` : `Deleting tag ${tag} from ${remote}…`,
  completed: (kind, tag, remote) => kind === "create"
    ? `Tag ${tag} created`
    : kind === "deleteLocal" ? `Local tag ${tag} deleted` : `Tag ${tag} deleted from ${remote}`,
};

export const ZH_CN_TAG_MUTATION_COPY: TagMutationCopy = {
  titles: { create: "新建标签", deleteLocal: "删除本地标签", deleteRemote: "删除远端标签" },
  descriptions: {
    create: "在所选提交上创建轻量标签。",
    deleteLocal: "删除此本地标签；远端同名标签将保留。",
    deleteRemote: "从所选远端删除此标签；本地标签将保留。",
  },
  tagName: "标签名称", commit: "提交", remote: "远端", cancel: "取消",
  create: "创建标签", delete: "删除标签", working: "处理中…",
  tagNameRequired: "请输入标签名称。", failed: "无法完成标签操作。",
  progress: (kind, tag, remote) => kind === "create"
    ? `正在创建标签 ${tag}…`
    : kind === "deleteLocal" ? `正在删除本地标签 ${tag}…` : `正在从 ${remote} 删除标签 ${tag}…`,
  completed: (kind, tag, remote) => kind === "create"
    ? `已创建标签 ${tag}`
    : kind === "deleteLocal" ? `已删除本地标签 ${tag}` : `已从 ${remote} 删除标签 ${tag}`,
};
