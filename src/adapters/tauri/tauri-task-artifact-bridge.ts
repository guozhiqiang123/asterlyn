import { parseTaskArtifactDiscovery, type TaskArtifactBridge } from "../../protocol/task-artifacts.ts";
import { invokeDesktopCommand } from "./desktop-command-adapter.ts";

export const tauriTaskArtifactBridge: TaskArtifactBridge = {
  discoverTaskArtifacts: async (repositoryRoot, hints, sidecarNames = []) => parseTaskArtifactDiscovery(
    await invokeDesktopCommand("discover_task_artifacts", { repositoryRoot, hints: [...hints], sidecarNames: [...sidecarNames] }),
  ),
  revealTaskArtifact: async (repositoryRoot, workspacePath) => {
    await invokeDesktopCommand("reveal_workspace_entry", { repositoryRoot, workspacePath, kind: "file" });
  },
};
