import { demoDiff } from "../../demo.ts";
import type { FileChange, WorkingDiffBase } from "../../models.ts";

export async function demoWorkingDiffBase(selected: FileChange): Promise<WorkingDiffBase> {
  await new Promise((resolve) => window.setTimeout(resolve, 70));
  const content = baseContent(selected.path);
  return {
    path: selected.path,
    originalPath: selected.originalPath,
    headOid: "a4f2c9e".repeat(6).slice(0, 40),
    blobOid: "b71de09".repeat(6).slice(0, 40),
    content,
    utf8Bom: false,
    byteLength: content.length,
  };
}

function baseContent(path: string): string {
  const lines: string[] = [];
  for (const line of demoDiff(path, false).patch.split("\n")) {
    if (line.startsWith("@@") || line.startsWith("diff --git ") ||
      line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("-") || line.startsWith(" ")) lines.push(line.slice(1));
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
