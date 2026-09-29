import type { WorkspaceReplacementDiff } from "../../models.ts";

interface DemoReplacementPlanView {
  readonly files: readonly {
    workspacePath: string;
    originalContent: string;
    replacementContent: string;
  }[];
}

export async function demoWorkspaceReplacementDiff(
  plan: DemoReplacementPlanView | undefined,
  workspacePath: string,
  _expanded: boolean,
): Promise<WorkspaceReplacementDiff> {
  const file = plan?.files.find((candidate) => candidate.workspacePath === workspacePath);
  if (!file) throw { kind: "invalidReplacement", message: "Replacement preview is stale." };
  const before = file.originalContent.replace(/\n$/u, "").split("\n");
  const after = file.replacementContent.replace(/\n$/u, "").split("\n");
  const patch = [`diff --git a/${workspacePath} b/${workspacePath}`, `--- a/${workspacePath}`,
    `+++ b/${workspacePath}`, `@@ -1,${before.length} +1,${after.length} @@`,
    ...before.map((line) => `-${line}`), ...after.map((line) => `+${line}`)].join("\n");
  return {
    workspacePath,
    patch,
    truncated: false,
    originalContent: file.originalContent,
    proposedContent: file.replacementContent,
  };
}
