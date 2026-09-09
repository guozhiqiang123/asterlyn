import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  demoCommitDetails,
  demoCommitDiff,
  demoQueryHistory,
  demoCreateBranch,
  demoDiff,
  demoFetchRemote,
  demoPullCurrent,
  demoPushCurrent,
  demoSnapshot,
  demoStage,
  demoSwitchBranch,
  demoTrackedSnapshot,
  demoUntrackedScan,
  demoUnstage,
} from "./demo";
import type {
  CommitDetails,
  CommitDiffResult,
  CommitFileChange,
  DiffResult,
  HistoryQuery,
  HistoryPage,
  ProjectFileList,
  RepositorySnapshot,
  UntrackedScan,
} from "./models";

const isTauri = "__TAURI_INTERNALS__" in window;
let browserSnapshot = structuredClone(demoSnapshot);
const browserCommitFiles = new Map<string, CommitFileChange[]>();
const cancelledDemoScans = new Set<string>();
const cancelledDemoRemoteOperations = new Set<string>();

export type DirectoryChoice =
  | { kind: "selected"; path: string }
  | { kind: "cancelled" }
  | { kind: "unsupported" };

export const bridge = {
  isDemo: !isTauri,

  async initialRepository(): Promise<string | null> {
    if (!isTauri) return null;
    return invoke<string | null>("initial_repository");
  },

  async chooseRepositoryDirectory(
    defaultPath: string | null,
  ): Promise<DirectoryChoice> {
    if (!isTauri) return { kind: "unsupported" };
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Open Git Repository",
      defaultPath: defaultPath || undefined,
    });
    if (selected === null) return { kind: "cancelled" };
    if (Array.isArray(selected)) {
      throw new Error("The folder chooser returned more than one path.");
    }
    return { kind: "selected", path: selected };
  },

  async openRepository(path: string): Promise<RepositorySnapshot> {
    if (!isTauri) {
      await demoDelay();
      browserSnapshot.root = path || demoSnapshot.root;
      return demoTrackedSnapshot(browserSnapshot);
    }
    return invoke<RepositorySnapshot>("open_repository", { path });
  },

  async readHistoryPage(
    repositoryRoot: string,
    query: HistoryQuery,
    offset: number,
    limit: number,
  ): Promise<HistoryPage> {
    if (!isTauri) {
      await demoDelay(180);
      const commits = demoQueryHistory(browserSnapshot, query);
      return {
        commits: commits.slice(offset, offset + limit),
        offset,
        hasMore: commits.length > offset + limit,
      };
    }
    return invoke<HistoryPage>("read_history_page", {
      repositoryRoot,
      query,
      offset,
      limit,
    });
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

  async listProjectFiles(repositoryRoot: string): Promise<ProjectFileList> {
    if (!isTauri) {
      await demoDelay(120);
      const paths = [
        "README.md",
        "package.json",
        "src/app.ts",
        "src/bridge.ts",
        "src/diff-editor.ts",
        "src/styles.css",
        ...browserSnapshot.changes.map((change) => change.path),
      ];
      return {
        root: repositoryRoot,
        paths: Array.from(new Set(paths)).sort(),
        files: Array.from(new Set(paths)).sort().map((path) => ({
          repositoryId: ".",
          path,
          workspacePath: path,
        })),
        repositoryRoots: structuredClone(browserSnapshot.repositoryRoots),
        truncated: false,
      };
    }
    return invoke<ProjectFileList>("list_project_files", { repositoryRoot });
  },

  async readCommitDetails(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
  ): Promise<CommitDetails> {
    if (!isTauri) {
      await demoDelay(180);
      const details = demoCommitDetails(commitOid);
      details.repositoryId = repositoryId;
      details.files = structuredClone(browserCommitFiles.get(commitOid) ?? details.files);
      details.parentOid =
        browserSnapshot.commits.find((commit) => commit.oid === commitOid)?.parents[0] ?? null;
      return details;
    }
    return invoke<CommitDetails>("read_commit_details", {
      repositoryRoot,
      repositoryId,
      commitOid,
    });
  },

  async readCommitDiff(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    path: string,
    originalPath: string | null,
  ): Promise<CommitDiffResult> {
    if (!isTauri) {
      await demoDelay(110);
      const diff = demoCommitDiff(commitOid, path);
      diff.repositoryId = repositoryId;
      return diff;
    }
    return invoke<CommitDiffResult>("read_commit_diff", {
      repositoryRoot,
      repositoryId,
      commitOid,
      path,
      originalPath,
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
      if (committed.length === 0) throw new Error("Nothing is staged.");
      next.changes = next.changes
        .map((change) => ({ ...change, indexStatus: "unmodified" as const }))
        .filter((change) => change.worktreeStatus !== "unmodified");
      const oid = `demo${Date.now().toString(16)}`.padEnd(40, "0").slice(0, 40);
      next.commits.unshift({
        repositoryId: ".",
        oid,
        shortOid: oid.slice(0, 7),
        parents: next.commits[0] ? [next.commits[0].oid] : [],
        authorName: "Asterlyn Demo",
        authorEmail: "demo@asterlyn.invalid",
        authoredAt: Math.floor(Date.now() / 1000),
        decorations: ["HEAD"],
        subject: message.split("\n")[0] ?? message,
      });
      browserCommitFiles.set(
        oid,
        committed.map((change) => ({
          path: change.path,
          originalPath: change.originalPath,
          status: change.indexStatus,
        })),
      );
      next.branch.ahead += 1;
      next.branch.oid = oid;
      const currentBranch = next.branches.find((branch) => branch.current);
      if (currentBranch) {
        currentBranch.oid = oid;
        currentBranch.committedAt = next.commits[0]?.authoredAt ?? currentBranch.committedAt;
        currentBranch.subject = next.commits[0]?.subject ?? currentBranch.subject;
      }
      browserSnapshot = next;
      return demoTrackedSnapshot(next);
    }
    return invoke<RepositorySnapshot>("commit_changes", {
      repositoryRoot,
      message,
    });
  },

  async switchBranch(
    repositoryRoot: string,
    targetFullName: string,
  ): Promise<RepositorySnapshot> {
    if (!isTauri) {
      await demoDelay(260);
      browserSnapshot = demoSwitchBranch(browserSnapshot, targetFullName);
      return demoTrackedSnapshot(browserSnapshot);
    }
    return invoke<RepositorySnapshot>("switch_branch", {
      repositoryRoot,
      targetFullName,
    });
  },

  async createBranch(
    repositoryRoot: string,
    name: string,
  ): Promise<RepositorySnapshot> {
    if (!isTauri) {
      await demoDelay(260);
      browserSnapshot = demoCreateBranch(browserSnapshot, name);
      return demoTrackedSnapshot(browserSnapshot);
    }
    return invoke<RepositorySnapshot>("create_branch", {
      repositoryRoot,
      name,
    });
  },

  async fetchRemote(
    repositoryRoot: string,
    remote: string,
    operationId: string,
  ): Promise<RepositorySnapshot> {
    if (!isTauri) {
      await demoDelay(480);
      if (cancelledDemoRemoteOperations.delete(remoteOperationKey(repositoryRoot, operationId))) {
        throw new Error("Fetch was cancelled; local tracking refs may have changed.");
      }
      browserSnapshot = demoFetchRemote(browserSnapshot, remote);
      return demoTrackedSnapshot(browserSnapshot);
    }
    return invoke<RepositorySnapshot>("fetch_remote", {
      repositoryRoot,
      remote,
      operationId,
    });
  },

  async pullCurrent(
    repositoryRoot: string,
    operationId: string,
  ): Promise<RepositorySnapshot> {
    if (!isTauri) {
      await demoDelay(560);
      if (cancelledDemoRemoteOperations.delete(remoteOperationKey(repositoryRoot, operationId))) {
        throw new Error("Pull was cancelled; refresh before continuing.");
      }
      browserSnapshot = demoPullCurrent(browserSnapshot);
      return demoTrackedSnapshot(browserSnapshot);
    }
    return invoke<RepositorySnapshot>("pull_current", {
      repositoryRoot,
      operationId,
    });
  },

  async pushCurrent(
    repositoryRoot: string,
    remote: string,
    operationId: string,
  ): Promise<RepositorySnapshot> {
    if (!isTauri) {
      await demoDelay(520);
      if (cancelledDemoRemoteOperations.delete(remoteOperationKey(repositoryRoot, operationId))) {
        throw new Error("Push was cancelled; the remote outcome is unknown until fetch.");
      }
      browserSnapshot = demoPushCurrent(browserSnapshot, remote);
      return demoTrackedSnapshot(browserSnapshot);
    }
    return invoke<RepositorySnapshot>("push_current", {
      repositoryRoot,
      remote,
      operationId,
    });
  },

  async cancelRemoteOperation(
    repositoryRoot: string,
    operationId: string,
  ): Promise<void> {
    if (!isTauri) {
      cancelledDemoRemoteOperations.add(remoteOperationKey(repositoryRoot, operationId));
      return;
    }
    return invoke<void>("cancel_remote_operation", {
      repositoryRoot,
      operationId,
    });
  },
};

function remoteOperationKey(repositoryRoot: string, operationId: string): string {
  return `${repositoryRoot}\0${operationId}`;
}

function demoDelay(milliseconds = 160): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
