import type { TaskArtifactBridge } from "../../protocol/task-artifacts.ts";

/** Browser demo boundary: generated Android artifacts exist only in a native workspace. */
export const demoTaskArtifactBridge: TaskArtifactBridge = {
  async discoverTaskArtifacts(repositoryRoot) {
    return { protocolVersion: 2, workspaceRoot: repositoryRoot, artifacts: [], sidecars: [], truncated: false };
  },
  async revealTaskArtifact() {
    // The demo has no native file manager.
  },
};
