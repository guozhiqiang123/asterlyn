import { invoke } from "@tauri-apps/api/core";
import {
  demoDiff,
  demoSnapshot,
  demoStage,
  demoTrackedSnapshot,
  demoUntrackedScan,
  demoUnstage,
} from "./demo";
import type {
  DiffResult,
  RepositorySnapshot,
  UntrackedScan,
} from "./models";

const isTauri = "__TAURI_INTERNALS__" in window;
let browserSnapshot = structuredClone(demoSnapshot);
const cancelledDemoScans = new Set<string>();

export const bridge = {
  isDemo: !isTauri,

  async initialRepository(): Promise<string | null> {
    if (!isTauri) return null;
    return invoke<string | null>("initial_repository");
  },

  async openRepository(path: string): Promise<RepositorySnapshot> {
    if (!isTauri) {
      await demoDelay();
      browserSnapshot.root = path || demoSnapshot.root;
      return demoTrackedSnapshot(browserSnapshot);
    }
    return invoke<RepositorySnapshot>("open_repository", { path });
  },

  async scanUntracked(
    repositoryRoot: string,
    scanId: string,
  ): Promise<UntrackedScan> {
    if (!isTauri) {
      await demoDelay(360);
      if (cancelledDemoScans.delete(scanId)) {
        throw new Error("Untracked scan was cancelled.");
      }
      const scan = demoUntrackedScan(browserSnapshot);
      scan.root = repositoryRoot;
      return scan;
    }
    return invoke<UntrackedScan>("scan_untracked", {
      repositoryRoot,
      scanId,
    });
  },

  async cancelUntrackedScan(scanId: string): Promise<void> {
    if (!isTauri) {
      cancelledDemoScans.add(scanId);
      return;
    }
    return invoke<void>("cancel_untracked_scan", { scanId });
  },

  async readDiff(
    repositoryRoot: string,
    path: string,
    staged: boolean,
  ): Promise<DiffResult> {
    if (!isTauri) {
      await demoDelay(90);
      return demoDiff(path, staged);
    }
    return invoke<DiffResult>("read_diff", {
      repositoryRoot,
      path,
      staged,
    });
  },

  async stagePaths(
    repositoryRoot: string,
    paths: string[],
  ): Promise<RepositorySnapshot> {
    if (!isTauri) {
      await demoDelay();
      browserSnapshot = demoStage(browserSnapshot, paths);
      return demoTrackedSnapshot(browserSnapshot);
    }
    return invoke<RepositorySnapshot>("stage_paths", {
      repositoryRoot,
      paths,
    });
  },

  async unstagePaths(
    repositoryRoot: string,
    paths: string[],
  ): Promise<RepositorySnapshot> {
    if (!isTauri) {
      await demoDelay();
      browserSnapshot = demoUnstage(browserSnapshot, paths);
      return demoTrackedSnapshot(browserSnapshot);
    }
    return invoke<RepositorySnapshot>("unstage_paths", {
      repositoryRoot,
      paths,
    });
  },

  async commitChanges(
    repositoryRoot: string,
    message: string,
  ): Promise<RepositorySnapshot> {
    if (!isTauri) {
      await demoDelay(320);
      const next = structuredClone(browserSnapshot);
      const committed = next.changes.filter(
        (change) => change.indexStatus !== "unmodified",
      );
      next.changes = next.changes
        .map((change) => ({ ...change, indexStatus: "unmodified" as const }))
        .filter((change) => change.worktreeStatus !== "unmodified");
      const oid = `demo${Date.now().toString(16)}`.padEnd(40, "0").slice(0, 40);
      next.commits.unshift({
        oid,
        shortOid: oid.slice(0, 7),
        parents: next.commits[0] ? [next.commits[0].oid] : [],
        authorName: "Asterlyn Demo",
        authorEmail: "demo@asterlyn.invalid",
        authoredAt: Math.floor(Date.now() / 1000),
        decorations: ["HEAD"],
        subject: message.split("\n")[0] ?? message,
      });
      next.branch.ahead += 1;
      if (committed.length === 0) throw new Error("Nothing is staged.");
      browserSnapshot = next;
      return demoTrackedSnapshot(next);
    }
    return invoke<RepositorySnapshot>("commit_changes", {
      repositoryRoot,
      message,
    });
  },
};

function demoDelay(milliseconds = 160): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
