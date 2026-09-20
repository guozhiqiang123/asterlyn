import { invokeDesktopCommand as invoke, isTauriRuntime, openDialog } from
  "../tauri/desktop-command-adapter";
import { tauriDesktopBridge } from "../tauri/tauri-desktop-bridge";
import { compileDemoGlobs } from "./demo-glob";
import { demoWorkingDiffBase } from "./demo-working-diff.ts";
import { demoWorkingTreeOutcome } from "./demo-working-tree-outcome.ts";
import {
  demoCommitDetails,
  demoCommitDiff,
  demoQueryHistory,
  demoCreateBranch,
  demoExecuteBranchMutation,
  demoExecuteGitReset, demoExecuteRemoteMutation,
  demoPrepareBranchMutation,
  demoPrepareGitReset, demoPrepareRemoteMutation,
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
} from "../../demo";
import type {
  BranchMutationPlan, BranchMutationRequest,
  CommitComparisonDetails, CommitComparisonDiffResult,
  CommitDetails, CommitDiffResult,
  CommitFileChange, CommitFilePreview,
  CommitFileComparison, CommitFileRestorePreview,
  CommitSelectedResult, DiffResult,
  FileChange, FileRestoreApplyResult,
  FileRestoreRecoverySummary, RestoreChangesPlan,
  GitWorktreeRecovery, GitConflictContent,
  GitBlameResult, GitOperationAction,
  GitOperationKind, GitOperationMutationOutcome,
  GitOperationPlan, GitOperationSnapshot,
  GitResetMode, GitResetPlan,
  HistoryQuery, HistoryPage,
  ImageDiffPreview, ImagePreview,
  ProjectFileList, ProjectWindowMatch,
  ProjectWindowOpenResult, OpenedProject,
  PushPreview, PushMode,
  PushTagMode, RemoteAuthenticationStatus,
  RemoteMutationPlan, RemoteMutationRequest,
  ReplacementApplyResult, ReplacementRecoverySummary,
  RepositoryMutationOutcome, RepositorySliceProject,
  RepositoryStateSlice, SaveTextFileResult,
  TextFileSnapshot, TerminalEvent,
  TerminalStarted, TrackedChangeScan,
  WorkingDiffBase, WorkingTreeMutationOutcome, UntrackedScan,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchReport,
  WorkspaceReplacementPreview,
  WorkspaceCollisionPolicy,
  WorkspaceMutationOperation,
  WorkspaceMutationOutcome,
  WorkspaceMutationPreview,
  WorkspaceMutationRecoverySummary,
  WorkspaceEntryKind,
  WorkspaceRevealResult,
  WorkspaceEntryInspection,
} from "../../models";
import {
  parseWindowChromeMode,
  type WindowChromeMode,
} from "../../protocol/window-chrome.ts";
import type { DesktopBridge, DirectoryChoice } from "../../protocol/desktop-bridge";
import { isImagePreviewPath } from "../../presentation/image-preview.ts";

const isTauri = isTauriRuntime;
let browserSnapshot = structuredClone(demoSnapshot);
let browserGitEnabled = true;
const browserCommitFiles = new Map<string, CommitFileChange[]>();
const cancelledDemoScans = new Set<string>();
const cancelledDemoRemoteOperations = new Set<string>();
const cancelledDemoSearches = new Set<string>();
const cancelledDemoReplacements = new Set<string>();
const demoReplacementPlans = new Map<string, DemoReplacementPlan>();
const demoReplacementRecoveries = new Map<string, DemoReplacementRecovery>();
const demoCommitFileRestorePlans = new Map<string, DemoCommitFileRestorePlan>();
const demoCommitFileRestoreRecoveries = new Map<string, DemoCommitFileRestoreRecovery>();
const demoTerminalListeners = new Set<(event: TerminalEvent) => void>();
let demoTerminalSession: TerminalStarted | null = null;
let demoTerminalSequence = 0;
const demoTextFiles = new Map<string, { content: string; utf8Bom: boolean; revision: number }>([
  ["README.md", { content: "# Asterlyn\n\nA lightweight developer workspace.\n", utf8Bom: false, revision: 1 }],
  ["package.json", { content: '{\n  "name": "asterlyn"\n}\n', utf8Bom: false, revision: 1 }],
  ["src/app.ts", { content: "export class AsterlynApp {\r\n  // Browser demo\n}\r\n", utf8Bom: false, revision: 1 }],
  ["src/bridge.ts", { content: "export const bridge = {};\n", utf8Bom: false, revision: 1 }],
  ["src/diff-editor.ts", { content: "export class DiffEditor {}\n", utf8Bom: false, revision: 1 }],
  ["src/styles.css", { content: ":root {\n  color-scheme: dark;\n}\n", utf8Bom: false, revision: 1 }],
]);
const demoTextBaselines = new Map(
  Array.from(demoTextFiles, ([path, file]) => [
    path,
    { content: file.content, utf8Bom: file.utf8Bom },
  ]),
);
const DEMO_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function completeDemoMutation(): RepositoryMutationOutcome {
  return { snapshot: demoTrackedSnapshot(browserSnapshot), invalidatedSlices: [...COMPLETE_DEMO_REPOSITORY_SLICES] };
}

function demoImage(path: string): ImagePreview {
  return {
    path,
    mediaType: "image/png",
    dataUrl: DEMO_IMAGE_DATA_URL,
    width: 1,
    height: 1,
    byteLength: 68,
  };
}

interface DemoReplacementFile {
  workspacePath: string;
  originalContent: string;
  replacementContent: string;
  utf8Bom: boolean;
  originalRevision: number;
}

interface DemoReplacementPlan {
  planId: string;
  files: DemoReplacementFile[];
}

interface DemoReplacementRecovery extends DemoReplacementPlan {
  selectedPaths: string[];
}

interface DemoCommitFileRestorePlan {
  preview: CommitFileRestorePreview;
  restoredContent: string | null;
  original: { content: string; utf8Bom: boolean; revision: number } | null;
}

interface DemoCommitFileRestoreRecovery extends DemoCommitFileRestorePlan {
  repositoryRoot: string;
}

const demoBridge: DesktopBridge = {
  isDemo: !isTauri,
  native: false,

  async windowChromeMode(): Promise<WindowChromeMode> {
    if (!isTauri) return "custom-right";
    return parseWindowChromeMode(await invoke<unknown>("window_chrome_mode"));
  },

  async initialRepository(): Promise<string | null> {
    if (!isTauri) return null;
    return invoke<string | null>("initial_repository");
  },

  async existingProjectDirectories(paths: string[]): Promise<string[]> {
    if (!isTauri) return paths;
    return invoke<string[]>("existing_project_directories", { paths });
  },

  async chooseRepositoryDirectory(
    defaultPath: string | null,
  ): Promise<DirectoryChoice> {
    if (!isTauri) return { kind: "unsupported" };
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: defaultPath || undefined,
    });
    if (selected === null) return { kind: "cancelled" };
    if (Array.isArray(selected)) {
      throw new Error("The folder chooser returned more than one path.");
    }
    return { kind: "selected", path: selected };
  },

  async openProject(path: string): Promise<OpenedProject> {
    if (!isTauri) {
      await demoDelay();
      browserSnapshot.root = path || demoSnapshot.root;
      browserGitEnabled = !browserSnapshot.root.endsWith("/ordinary-folder");
      return {
        root: browserSnapshot.root,
        repository: browserGitEnabled ? demoTrackedSnapshot(browserSnapshot) : null,
      };
    }
    return invoke<OpenedProject>("open_project", { path });
  },

  async readProject(path: string): Promise<OpenedProject> {
    if (!isTauri) {
      await demoDelay();
      return { root: path, repository: browserGitEnabled ? demoTrackedSnapshot(browserSnapshot) : null };
    }
    return invoke<OpenedProject>("read_project_snapshot", { path });
  },

  async focusExistingProjectWindow(path: string): Promise<ProjectWindowMatch> {
    if (!isTauri) return "notOpen";
    return invoke<ProjectWindowMatch>("focus_existing_project_window", { path });
  },

  async readRepositorySlices(
    repositoryRoot: string,
    slices: RepositoryStateSlice[],
  ): Promise<RepositorySliceProject> {
    if (isTauri) {
      return invoke<RepositorySliceProject>("read_repository_slices", {
        repositoryRoot,
        slices,
      });
    }
    await demoDelay();
    if (!browserGitEnabled) return { root: repositoryRoot, repository: null };
    const snapshot = demoTrackedSnapshot(browserSnapshot);
    const selected = new Set(slices);
    return {
      root: repositoryRoot,
      repository: {
        root: repositoryRoot,
        gitDir: snapshot.gitDir,
        ...(selected.has("workingTree")
          ? { changes: snapshot.changes, untrackedState: snapshot.untrackedState }
          : {}),
        ...(selected.has("head") ? { branch: snapshot.branch } : {}),
        ...(selected.has("refs")
          ? {
              repositoryRoots: snapshot.repositoryRoots,
              branches: snapshot.branches,
              remotes: snapshot.remotes,
            }
          : {}),
        ...(selected.has("history") ? { commits: snapshot.commits } : {}),
        ...(selected.has("operation") ? { operation: snapshot.operation } : {}),
      },
    };
  },

  async readTrackedChanges(repositoryRoot: string): Promise<TrackedChangeScan> {
    if (!isTauri) {
      await demoDelay(70);
      const snapshot = demoTrackedSnapshot(browserSnapshot);
      return { root: repositoryRoot, changes: snapshot.changes };
    }
    return invoke<TrackedChangeScan>("read_tracked_changes", { repositoryRoot });
  },

  async openRepositoryWindow(path: string): Promise<ProjectWindowOpenResult> {
    if (!isTauri) {
      throw new Error("Opening another application window requires the desktop build.");
    }
    return invoke<ProjectWindowOpenResult>("open_repository_window", { path });
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

  async readLocalDiff(
    repositoryRoot: string,
    selected: FileChange,
    expandedUnchanged = false,
  ): Promise<DiffResult> {
    if (!isTauri) {
      await demoDelay(90);
      return demoDiff(selected.path, false);
    }
    return invoke<DiffResult>("read_local_diff", {
      repositoryRoot,
      selected,
      expandedUnchanged,
    });
  },

  async readWorkingDiffBase(repositoryRoot: string, selected: FileChange) {
    if (!isTauri) return demoWorkingDiffBase(selected);
    return invoke<WorkingDiffBase>("read_working_diff_base", { repositoryRoot, selected });
  },

  async readImageFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
  ): Promise<ImagePreview> {
    if (!isTauri) {
      await demoDelay(80);
      return demoImage(path);
    }
    return invoke<ImagePreview>("read_image_file", {
      repositoryRoot,
      repositoryId,
      path,
    });
  },

  async readLocalImageDiff(
    repositoryRoot: string,
    selected: FileChange,
  ): Promise<ImageDiffPreview> {
    if (!isTauri) {
      await demoDelay(90);
      return { path: selected.path, before: demoImage(selected.path), after: demoImage(selected.path) };
    }
    return invoke<ImageDiffPreview>("read_local_image_diff", {
      repositoryRoot,
      selected,
    });
  },

  async listProjectFiles(repositoryRoot: string): Promise<ProjectFileList> {
    if (!isTauri) {
      await demoDelay(120);
      const paths = [
        "README.md",
        "package.json",
        "assets/preview.png",
        "src/app.ts",
        "src/bridge.ts",
        "src/diff-editor.ts",
        "src/styles.css",
        ...browserSnapshot.changes.map((change) => change.path),
      ];
      for (const path of paths) {
        if (!demoTextFiles.has(path)) {
          demoTextFiles.set(path, {
            content: `Demo content for ${path}\n`,
            utf8Bom: false,
            revision: 1,
          });
        }
      }
      const uniquePaths = Array.from(new Set(paths)).sort();
      const ignoredPaths = browserGitEnabled
        ? [".cache/session.json", "local.settings"]
        : [];
      for (const path of ignoredPaths) {
        if (!demoTextFiles.has(path)) {
          demoTextFiles.set(path, {
            content: `Read-only ignored content for ${path}\n`,
            utf8Bom: false,
            revision: 1,
          });
        }
      }
      return {
        root: repositoryRoot,
        paths: uniquePaths,
        files: [
          ...uniquePaths.map((path) => ({
            repositoryId: browserGitEnabled ? "." : "workspace",
            path,
            workspacePath: path,
            readOnly: false,
          })),
          ...ignoredPaths.map((path) => ({
            repositoryId: ".",
            path,
            workspacePath: path,
            readOnly: true,
          })),
        ],
        ignoredEntries: ignoredPaths.map((workspacePath) => ({
          workspacePath,
          kind: "file" as const,
        })),
        repositoryRoots: browserGitEnabled
          ? structuredClone(browserSnapshot.repositoryRoots)
          : [],
        truncated: false,
      };
    }
    return invoke<ProjectFileList>("list_project_files", { repositoryRoot });
  },

  async revealWorkspaceEntry(
    repositoryRoot: string,
    workspacePath: string,
    kind: WorkspaceEntryKind,
  ): Promise<WorkspaceRevealResult> {
    if (!isTauri) return { selected: false };
    return invoke<WorkspaceRevealResult>("reveal_workspace_entry", {
      repositoryRoot,
      workspacePath,
      kind,
    });
  },

  async inspectWorkspaceEntry(
    repositoryRoot: string,
    workspacePath: string,
  ): Promise<WorkspaceEntryInspection> {
    if (!isTauri) {
      throw new Error(`Workspace entry inspection requires the desktop build: ${workspacePath}`);
    }
    return invoke<WorkspaceEntryInspection>("inspect_workspace_entry", {
      repositoryRoot,
      workspacePath,
    });
  },

  async planWorkspaceMutation(
    repositoryRoot: string,
    planId: string,
    operation: WorkspaceMutationOperation,
    collisionPolicy: WorkspaceCollisionPolicy,
  ): Promise<WorkspaceMutationPreview> {
    if (!isTauri) {
      throw new Error("Workspace mutations require the desktop build.");
    }
    return invoke<WorkspaceMutationPreview>("plan_workspace_mutation", {
      repositoryRoot,
      planId,
      operation,
      collisionPolicy,
    });
  },

  async executeWorkspaceMutation(
    repositoryRoot: string,
    planId: string,
  ): Promise<WorkspaceMutationOutcome> {
    if (!isTauri) {
      throw new Error("Workspace mutations require the desktop build.");
    }
    return invoke<WorkspaceMutationOutcome>("execute_workspace_mutation", {
      repositoryRoot,
      planId,
    });
  },

  async cancelWorkspaceMutation(repositoryRoot: string, planId: string): Promise<void> {
    if (!isTauri) return;
    return invoke<void>("cancel_workspace_mutation", { repositoryRoot, planId });
  },

  async listWorkspaceMutationRecoveries(
    repositoryRoot: string,
  ): Promise<WorkspaceMutationRecoverySummary[]> {
    if (!isTauri) return [];
    return invoke<WorkspaceMutationRecoverySummary[]>("list_workspace_mutation_recoveries", {
      repositoryRoot,
    });
  },

  async searchWorkspaceText(
    repositoryRoot: string,
    requestId: string,
    query: string,
    options: WorkspaceTextSearchOptions,
  ): Promise<WorkspaceTextSearchReport> {
    if (!isTauri) {
      await demoDelay(220);
      if (cancelledDemoSearches.delete(searchOperationKey(repositoryRoot, requestId))) {
        throw { kind: "cancelled", message: "Workspace search was cancelled." };
      }
      return demoWorkspaceSearch(requestId, query, options);
    }
    return invoke<WorkspaceTextSearchReport>("search_workspace_text", {
      repositoryRoot,
      requestId,
      query,
      options,
    });
  },

  async cancelWorkspaceTextSearch(
    repositoryRoot: string,
    requestId: string,
  ): Promise<void> {
    if (!isTauri) {
      cancelledDemoSearches.add(searchOperationKey(repositoryRoot, requestId));
      return;
    }
    return invoke<void>("cancel_workspace_text_search", {
      repositoryRoot,
      requestId,
    });
  },

  async previewWorkspaceReplacement(
    repositoryRoot: string,
    planId: string,
    query: string,
    replacement: string,
    options: WorkspaceTextSearchOptions,
  ): Promise<WorkspaceReplacementPreview> {
    if (!isTauri) {
      await demoDelay(240);
      if (cancelledDemoReplacements.delete(searchOperationKey(repositoryRoot, planId))) {
        throw { kind: "cancelled", message: "Workspace replacement preview was cancelled." };
      }
      return demoReplacementPreview(planId, query, replacement, options);
    }
    return invoke<WorkspaceReplacementPreview>("preview_workspace_replacement", {
      repositoryRoot,
      planId,
      query,
      replacement,
      options,
    });
  },

  async applyWorkspaceReplacement(
    repositoryRoot: string,
    planId: string,
    selectedPaths: string[],
  ): Promise<ReplacementApplyResult> {
    if (!isTauri) {
      await demoDelay(260);
      if (cancelledDemoReplacements.delete(searchOperationKey(repositoryRoot, planId))) {
        throw { kind: "cancelled", message: "Workspace replacement was cancelled." };
      }
      return demoApplyReplacement(planId, selectedPaths);
    }
    return invoke<ReplacementApplyResult>("apply_workspace_replacement", {
      repositoryRoot,
      planId,
      selectedPaths,
    });
  },

  async cancelWorkspaceReplacement(
    repositoryRoot: string,
    operationId: string,
  ): Promise<void> {
    if (!isTauri) {
      if (demoReplacementPlans.delete(operationId)) return;
      cancelledDemoReplacements.add(searchOperationKey(repositoryRoot, operationId));
      return;
    }
    return invoke<void>("cancel_workspace_replacement", {
      repositoryRoot,
      operationId,
    });
  },

  async listWorkspaceReplacementRecoveries(
    repositoryRoot: string,
  ): Promise<ReplacementRecoverySummary[]> {
    if (!isTauri) {
      await demoDelay(40);
      return Array.from(demoReplacementRecoveries.values()).map(demoRecoverySummary);
    }
    return invoke<ReplacementRecoverySummary[]>("list_workspace_replacement_recoveries", {
      repositoryRoot,
    });
  },

  async rollbackWorkspaceReplacement(
    repositoryRoot: string,
    recoveryId: string,
  ): Promise<ReplacementApplyResult> {
    if (!isTauri) {
      await demoDelay(180);
      return demoRollbackReplacement(recoveryId);
    }
    return invoke<ReplacementApplyResult>("rollback_workspace_replacement", {
      repositoryRoot,
      recoveryId,
    });
  },

  async finalizeWorkspaceReplacement(
    repositoryRoot: string,
    recoveryId: string,
  ): Promise<void> {
    if (!isTauri) {
      await demoDelay(100);
      demoFinalizeReplacement(recoveryId);
      return;
    }
    return invoke<void>("finalize_workspace_replacement", {
      repositoryRoot,
      recoveryId,
    });
  },

  async readTextFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
  ): Promise<TextFileSnapshot> {
    if (!isTauri) {
      await demoDelay(90);
      const file = demoTextFiles.get(path);
      const expectedRepositoryId = browserGitEnabled ? "." : "workspace";
      if (repositoryId !== expectedRepositoryId || !file) {
        throw { kind: "notAuthorized", message: "Select a current project file." };
      }
      return {
        workspacePath: path,
        content: file.content,
        utf8Bom: file.utf8Bom,
        revision: demoTextRevision(path, file),
        byteLength: new TextEncoder().encode(file.content).length + (file.utf8Bom ? 3 : 0),
      };
    }
    return invoke<TextFileSnapshot>("read_text_file", {
      repositoryRoot,
      repositoryId,
      path,
    });
  },

  async saveTextFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
    expectedRevision: string,
    content: string,
    utf8Bom: boolean,
    requestId: string,
  ): Promise<SaveTextFileResult> {
    if (!isTauri) {
      await demoDelay(140);
      const file = demoTextFiles.get(path);
      const expectedRepositoryId = browserGitEnabled ? "." : "workspace";
      if (repositoryId !== expectedRepositoryId || !file) {
        throw { kind: "notAuthorized", message: "Select a current project file." };
      }
      const currentRevision = demoTextRevision(path, file);
      if (file.content !== content || file.utf8Bom !== utf8Bom) {
        if (expectedRevision !== currentRevision) {
          throw { kind: "conflict", currentRevision };
        }
        file.content = content;
        file.utf8Bom = utf8Bom;
        file.revision += 1;
        reconcileDemoTextChange(path, file);
      }
      return {
        workspacePath: path,
        revision: demoTextRevision(path, file),
        byteLength: new TextEncoder().encode(content).length + (utf8Bom ? 3 : 0),
        requestId,
        alreadySaved: expectedRevision !== currentRevision,
      };
    }
    return invoke<SaveTextFileResult>("save_text_file", {
      repositoryRoot,
      repositoryId,
      path,
      expectedRevision,
      content,
      utf8Bom,
      requestId,
    });
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

  async readCommitComparisonDetails(
    repositoryRoot: string,
    repositoryId: string,
    beforeOid: string,
    afterOid: string,
  ): Promise<CommitComparisonDetails> {
    if (!isTauri) {
      await demoDelay(180);
      const before = browserSnapshot.commits.find((commit) => commit.oid === beforeOid);
      const after = browserSnapshot.commits.find((commit) => commit.oid === afterOid);
      const relation = after?.parents.includes(beforeOid)
        ? "beforeIsAncestor"
        : before?.parents.includes(afterOid)
          ? "afterIsAncestor"
          : "divergent";
      const fileSourceOid = relation === "afterIsAncestor" ? beforeOid : afterOid;
      const files = structuredClone(
        browserCommitFiles.get(fileSourceOid) ?? demoCommitDetails(fileSourceOid).files,
      );
      return {
        repositoryId,
        beforeOid,
        afterOid,
        relation,
        files: relation === "afterIsAncestor"
          ? files.map((file) => ({
              ...file,
              status: file.status === "added"
                ? "deleted" as const
                : file.status === "deleted"
                  ? "added" as const
                  : file.status,
            }))
          : files,
      };
    }
    return invoke<CommitComparisonDetails>("read_commit_comparison_details", {
      repositoryRoot,
      repositoryId,
      beforeOid,
      afterOid,
    });
  },

  async readGitBlame(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
    commitOid: string | null,
    parent: boolean,
  ): Promise<GitBlameResult> {
    if (!isTauri) {
      await demoDelay(140);
      const selectedCommit = browserSnapshot.commits.find((item) => item.oid === commitOid) ??
        browserSnapshot.commits[0];
      const revision = parent ? (selectedCommit?.parents[0] ?? null) : commitOid;
      const commit = browserSnapshot.commits.find((item) => item.oid === revision) ??
        selectedCommit;
      const ranges = demoBlameRanges(path);
      return {
        repositoryId,
        path,
        revision,
        hunks: parent && revision === null ? [] : ranges.map(({ start, count }) => ({
          oid: commit?.oid ?? "0000000000000000000000000000000000000000",
          originalStartLine: start,
          finalStartLine: start,
          lineCount: count,
          authorName: commit?.authorName ?? "Not Committed Yet",
          authorEmail: commit?.authorEmail ?? "",
          authoredAt: commit?.authoredAt ?? 0,
          summary: commit?.subject ?? "Working tree content",
          uncommitted: !commit,
        })),
        truncated: false,
      };
    }
    return invoke<GitBlameResult>("read_git_blame", {
      repositoryRoot,
      repositoryId,
      path,
      commitOid,
      parent,
    });
  },

  async readCommitDiff(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    path: string,
    originalPath: string | null,
    expandedUnchanged = false,
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
      expandedUnchanged,
    });
  },

  async readCommitFile(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    selected: CommitFileChange,
  ): Promise<CommitFilePreview> {
    if (!isTauri) {
      await demoDelay(90);
      const details = demoCommitDetails(commitOid);
      const current = details.files.find((file) =>
        file.path === selected.path &&
        file.originalPath === selected.originalPath &&
        file.status === selected.status
      );
      if (!current) throw new Error("Select an exact file from the current commit details.");
      const revisionOid = selected.status === "deleted"
        ? details.parentOid ?? commitOid
        : commitOid;
      const sourcePath = selected.status === "deleted"
        ? selected.originalPath ?? selected.path
        : selected.path;
      const image = isImagePreviewPath(selected.path) ? demoImage(selected.path) : null;
      const content = image
        ? null
        : demoTextFiles.get(selected.path)?.content ??
          `// Historical ${selected.path} at ${revisionOid.slice(0, 10)}\n`;
      return {
        repositoryId,
        commitOid,
        revisionOid,
        path: selected.path,
        sourcePath,
        blobOid: "d".repeat(40),
        fileMode: "100644",
        byteLength: image?.byteLength ?? new TextEncoder().encode(content ?? "").length,
        kind: image ? "image" : "text",
        content,
        utf8Bom: image ? null : false,
        image,
      };
    }
    return invoke<CommitFilePreview>("read_commit_file", {
      repositoryRoot,
      repositoryId,
      commitOid,
      selected,
    });
  },

  async compareCommitFileToCurrent(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    selected: CommitFileChange,
    currentContent: string | null,
    expectedCurrentRevision: string | null,
  ): Promise<CommitFileComparison> {
    if (!isTauri) {
      await demoDelay(110);
      const historical = await demoDesktopBridge.readCommitFile(
        repositoryRoot,
        repositoryId,
        commitOid,
        selected,
      );
      if (historical.kind === "image" && historical.image) {
        if (currentContent !== null || expectedCurrentRevision !== null) {
          throw new Error("Image comparisons cannot use a text editor buffer.");
        }
        const current = demoImage(selected.path);
        return {
          repositoryId,
          commitOid,
          revisionOid: historical.revisionOid,
          path: selected.path,
          sourcePath: historical.sourcePath,
          blobOid: historical.blobOid,
          fileMode: historical.fileMode,
          currentRevision: "e".repeat(64),
          currentSource: "disk",
          currentByteLength: current.byteLength,
          kind: "image",
          patch: null,
          image: { path: selected.path, before: historical.image, after: current },
          truncated: false,
        };
      }
      const file = demoTextFiles.get(selected.path);
      if (!file || historical.content === null) {
        throw new Error("Select a current text file from the active project.");
      }
      const revision = demoTextRevision(selected.path, file);
      if (expectedCurrentRevision !== null && expectedCurrentRevision !== revision) {
        throw new Error("The current file changed after the editor buffer was opened.");
      }
      const after = currentContent ?? file.content;
      return {
        repositoryId,
        commitOid,
        revisionOid: historical.revisionOid,
        path: selected.path,
        sourcePath: historical.sourcePath,
        blobOid: historical.blobOid,
        fileMode: historical.fileMode,
        currentRevision: "e".repeat(64),
        currentSource: currentContent === null ? "disk" : "buffer",
        currentByteLength: new TextEncoder().encode(after).length,
        kind: "text",
        patch: demoTextComparisonPatch(selected.path, historical.content, after),
        image: null,
        truncated: false,
      };
    }
    return invoke<CommitFileComparison>("compare_commit_file_to_current", {
      repositoryRoot,
      repositoryId,
      commitOid,
      selected,
      currentContent,
      expectedCurrentRevision,
    });
  },

  async prepareCommitFileRestore(
    repositoryRoot: string,
    planId: string,
    repositoryId: string,
    commitOid: string,
    selected: CommitFileChange,
  ): Promise<CommitFileRestorePreview> {
    if (!isTauri) {
      await demoDelay(100);
      const historical = await demoBridge.readCommitFile(
        repositoryRoot,
        repositoryId,
        commitOid,
        selected,
      );
      const current = demoTextFiles.get(selected.path) ?? null;
      const action = current === null
        ? "create"
        : historical.content === current.content
          ? "unchanged"
          : "overwrite";
      const preview: CommitFileRestorePreview = {
        planId,
        workspacePath: selected.path,
        action,
        expectedRevision: current ? demoTextRevision(selected.path, current) : null,
        currentMode: current ? 0o644 : 0o644,
        restoredMode: historical.fileMode === "100755" ? 0o755 : 0o644,
        currentByteLength: current ? new TextEncoder().encode(current.content).length : null,
        restoredByteLength: historical.byteLength,
        repositoryId,
        commitOid,
        revisionOid: historical.revisionOid,
        sourcePath: historical.sourcePath,
        blobOid: historical.blobOid,
        fileMode: historical.fileMode,
      };
      demoCommitFileRestorePlans.set(planId, {
        preview,
        restoredContent: historical.content,
        original: current ? { ...current } : null,
      });
      return structuredClone(preview);
    }
    return invoke<CommitFileRestorePreview>("prepare_commit_file_restore", {
      repositoryRoot,
      planId,
      repositoryId,
      commitOid,
      selected,
    });
  },

  async executeCommitFileRestore(
    repositoryRoot: string,
    planId: string,
  ): Promise<FileRestoreApplyResult> {
    if (!isTauri) {
      await demoDelay(120);
      const plan = demoCommitFileRestorePlans.get(planId);
      if (!plan) throw new Error("The historical-file restore plan is stale.");
      demoCommitFileRestorePlans.delete(planId);
      if (plan.preview.action === "unchanged") {
        return {
          recoveryId: null,
          workspacePath: plan.preview.workspacePath,
          status: "unchanged",
          fileState: "restored",
        };
      }
      if (plan.restoredContent !== null) {
        demoTextFiles.set(plan.preview.workspacePath, {
          content: plan.restoredContent,
          utf8Bom: false,
          revision: (plan.original?.revision ?? 0) + 1,
        });
      }
      demoCommitFileRestoreRecoveries.set(planId, { ...plan, repositoryRoot });
      return {
        recoveryId: planId,
        workspacePath: plan.preview.workspacePath,
        status: "applied",
        fileState: "restored",
      };
    }
    return invoke<FileRestoreApplyResult>("execute_commit_file_restore", {
      repositoryRoot,
      planId,
    });
  },

  async listCommitFileRestoreRecoveries(
    repositoryRoot: string,
  ): Promise<FileRestoreRecoverySummary[]> {
    if (!isTauri) {
      return Array.from(demoCommitFileRestoreRecoveries).flatMap(([recoveryId, recovery]) =>
        recovery.repositoryRoot === repositoryRoot
          ? [{
              recoveryId,
              workspacePath: recovery.preview.workspacePath,
              status: "applied" as const,
              fileState: "restored" as const,
            }]
          : []
      );
    }
    return invoke<FileRestoreRecoverySummary[]>("list_commit_file_restore_recoveries", {
      repositoryRoot,
    });
  },

  async rollbackCommitFileRestore(
    repositoryRoot: string,
    recoveryId: string,
  ): Promise<FileRestoreApplyResult> {
    if (!isTauri) {
      const recovery = demoCommitFileRestoreRecoveries.get(recoveryId);
      if (!recovery || recovery.repositoryRoot !== repositoryRoot) {
        throw new Error("The historical-file recovery is unavailable.");
      }
      const current = demoTextFiles.get(recovery.preview.workspacePath) ?? null;
      if (recovery.restoredContent !== null && current?.content !== recovery.restoredContent) {
        return {
          recoveryId,
          workspacePath: recovery.preview.workspacePath,
          status: "needsRecovery",
          fileState: "conflict",
        };
      }
      if (recovery.original) demoTextFiles.set(recovery.preview.workspacePath, { ...recovery.original });
      else demoTextFiles.delete(recovery.preview.workspacePath);
      demoCommitFileRestoreRecoveries.delete(recoveryId);
      return {
        recoveryId: null,
        workspacePath: recovery.preview.workspacePath,
        status: "rolledBack",
        fileState: "original",
      };
    }
    return invoke<FileRestoreApplyResult>("rollback_commit_file_restore", {
      repositoryRoot,
      recoveryId,
    });
  },

  async finalizeCommitFileRestore(repositoryRoot: string, recoveryId: string): Promise<void> {
    if (!isTauri) {
      const recovery = demoCommitFileRestoreRecoveries.get(recoveryId);
      if (!recovery || recovery.repositoryRoot !== repositoryRoot) {
        throw new Error("The historical-file recovery is unavailable.");
      }
      demoCommitFileRestoreRecoveries.delete(recoveryId);
      return;
    }
    return invoke<void>("finalize_commit_file_restore", { repositoryRoot, recoveryId });
  },

  async readCommitComparisonDiff(
    repositoryRoot: string,
    repositoryId: string,
    beforeOid: string,
    afterOid: string,
    path: string,
    originalPath: string | null,
    expandedUnchanged = false,
  ): Promise<CommitComparisonDiffResult> {
    if (!isTauri) {
      await demoDelay(110);
      const diff = demoCommitDiff(afterOid, path);
      return {
        repositoryId,
        beforeOid,
        afterOid,
        path: diff.path,
        patch: diff.patch,
        binary: diff.binary,
        truncated: diff.truncated,
      };
    }
    return invoke<CommitComparisonDiffResult>("read_commit_comparison_diff", {
      repositoryRoot,
      repositoryId,
      beforeOid,
      afterOid,
      path,
      originalPath,
      expandedUnchanged,
    });
  },

  async readCommitImageDiff(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    path: string,
    originalPath: string | null,
  ): Promise<ImageDiffPreview> {
    if (!isTauri) {
      await demoDelay(90);
      return { path, before: demoImage(path), after: demoImage(path) };
    }
    return invoke<ImageDiffPreview>("read_commit_image_diff", {
      repositoryRoot,
      repositoryId,
      commitOid,
      path,
      originalPath,
    });
  },

  async readCommitComparisonImageDiff(
    repositoryRoot: string,
    repositoryId: string,
    beforeOid: string,
    afterOid: string,
    path: string,
    originalPath: string | null,
  ): Promise<ImageDiffPreview> {
    if (!isTauri) {
      await demoDelay(90);
      return { path, before: demoImage(path), after: demoImage(path) };
    }
    return invoke<ImageDiffPreview>("read_commit_comparison_image_diff", {
      repositoryRoot,
      repositoryId,
      beforeOid,
      afterOid,
      path,
      originalPath,
    });
  },

  async stagePaths(
    repositoryRoot: string,
    paths: string[],
  ): Promise<WorkingTreeMutationOutcome> {
    if (!isTauri) {
      await demoDelay();
      browserSnapshot = demoStage(browserSnapshot, paths);
      return demoWorkingTreeOutcome(browserSnapshot);
    }
    return invoke<WorkingTreeMutationOutcome>("stage_paths", {
      repositoryRoot,
      paths,
    });
  },

  async trashUntrackedPaths(repositoryRoot: string, paths: string[]): Promise<WorkingTreeMutationOutcome> {
    if (!isTauri) {
      await demoDelay();
      const removed = new Set(paths);
      browserSnapshot = { ...browserSnapshot,
        changes: browserSnapshot.changes.filter((change) => !removed.has(change.path)) };
      return demoWorkingTreeOutcome(browserSnapshot);
    }
    return invoke<WorkingTreeMutationOutcome>("trash_untracked_paths", { repositoryRoot, paths });
  },

  async unstagePaths(
    repositoryRoot: string,
    paths: string[],
  ): Promise<WorkingTreeMutationOutcome> {
    if (!isTauri) {
      await demoDelay();
      browserSnapshot = demoUnstage(browserSnapshot, paths);
      return demoWorkingTreeOutcome(browserSnapshot);
    }
    return invoke<WorkingTreeMutationOutcome>("unstage_paths", {
      repositoryRoot,
      paths,
    });
  },

  async commitChanges(
    repositoryRoot: string,
    message: string,
    selected: FileChange[],
  ): Promise<CommitSelectedResult> {
    if (!isTauri) {
      await demoDelay(320);
      const next = structuredClone(browserSnapshot);
      const paths = new Set(selected.map((change) => change.path));
      const committed = next.changes.filter((change) => paths.has(change.path));
      if (committed.length !== paths.size || committed.length === 0) {
        throw new Error("The selected changes are stale.");
      }
      next.changes = next.changes.filter((change) => !paths.has(change.path));
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
          status:
            change.worktreeStatus !== "unmodified"
              ? change.worktreeStatus
              : change.indexStatus,
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
      return {
        oid,
        snapshot: demoTrackedSnapshot(next),
        invalidatedSlices: ["workingTree", "head", "refs", "history"],
        refreshError: null,
        verificationWarning: null,
      };
    }
    return invoke<CommitSelectedResult>("commit_changes", {
      repositoryRoot,
      message,
      selected,
    });
  },

  async prepareRestoreChanges(repositoryRoot: string, selected: FileChange[]): Promise<RestoreChangesPlan> {
    if (!isTauri) return { root: repositoryRoot, selected, paths: selected.map((file) => file.path), headOid: browserSnapshot.branch.oid ?? "demo", token: "demo-review" };
    return invoke<RestoreChangesPlan>("prepare_restore_changes", { repositoryRoot, selected });
  },

  async listGitWorktreeRecoveries(repositoryRoot: string): Promise<GitWorktreeRecovery[]> {
    if (!isTauri) return [];
    return invoke<GitWorktreeRecovery[]>("list_git_worktree_recoveries", { repositoryRoot });
  },

  async undoGitWorktreeRecovery(repositoryRoot: string, recoveryId: string): Promise<RepositoryMutationOutcome> {
    if (!isTauri) throw new Error("Durable recovery requires the desktop application.");
    return invoke<RepositoryMutationOutcome>("undo_git_worktree_recovery", { repositoryRoot, recoveryId });
  },

  async revertChanges(
    repositoryRoot: string,
    plan: RestoreChangesPlan,
  ): Promise<WorkingTreeMutationOutcome> {
    const selected = plan.selected;
    if (!isTauri) {
      await demoDelay(220);
      if (
        selected.some(
          (change) =>
            change.worktreeStatus === "untracked" ||
            change.indexStatus === "added" ||
            change.indexStatus === "copied" ||
            change.conflicted ||
            change.submodule,
        )
      ) {
        throw new Error("Only ordinary tracked files can be reverted in this version.");
      }
      const paths = new Set(selected.map((change) => change.path));
      browserSnapshot = {
        ...browserSnapshot,
        changes: browserSnapshot.changes.filter((change) => !paths.has(change.path)),
      };
      return {
        tracked: {
          root: browserSnapshot.root,
          changes: demoTrackedSnapshot(browserSnapshot).changes,
        },
        invalidatedSlices: ["openDocuments", "workingTree"],
      };
    }
    return invoke<WorkingTreeMutationOutcome>("revert_changes", {
      repositoryRoot,
      plan,
    });
  },

  async switchBranch(
    repositoryRoot: string,
    targetFullName: string,
  ): Promise<RepositoryMutationOutcome> {
    if (!isTauri) {
      await demoDelay(260);
      browserSnapshot = demoSwitchBranch(browserSnapshot, targetFullName);
      return completeDemoMutation();
    }
    return invoke<RepositoryMutationOutcome>("switch_branch", {
      repositoryRoot,
      targetFullName,
    });
  },

  async createBranch(
    repositoryRoot: string,
    name: string,
  ): Promise<RepositoryMutationOutcome> {
    if (!isTauri) {
      await demoDelay(260);
      browserSnapshot = demoCreateBranch(browserSnapshot, name);
      return completeDemoMutation();
    }
    return invoke<RepositoryMutationOutcome>("create_branch", {
      repositoryRoot,
      name,
    });
  },

  async prepareBranchMutation(
    repositoryRoot: string,
    request: BranchMutationRequest,
  ): Promise<BranchMutationPlan> {
    if (!isTauri) return demoPrepareBranchMutation(browserSnapshot, request);
    return invoke<BranchMutationPlan>("prepare_branch_mutation", { repositoryRoot, request });
  },

  async executeBranchMutation(
    repositoryRoot: string, plan: BranchMutationPlan, operationId: string,
  ): Promise<RepositoryMutationOutcome> {
    if (!isTauri) {
      await demoDelay(260);
      browserSnapshot = demoExecuteBranchMutation(browserSnapshot, plan);
      return completeDemoMutation();
    }
    return invoke<RepositoryMutationOutcome>(
      "execute_branch_mutation", { repositoryRoot, plan, operationId },
    );
  },

  async prepareRemoteMutation(repositoryRoot: string, request: RemoteMutationRequest): Promise<RemoteMutationPlan> {
    if (!isTauri) return demoPrepareRemoteMutation(browserSnapshot, request);
    return invoke<RemoteMutationPlan>("prepare_remote_mutation", { repositoryRoot, request });
  },

  async executeRemoteMutation(repositoryRoot: string, plan: RemoteMutationPlan): Promise<RepositoryMutationOutcome> {
    if (!isTauri) {
      await demoDelay(180);
      browserSnapshot = demoExecuteRemoteMutation(browserSnapshot, plan);
      return completeDemoMutation();
    }
    return invoke<RepositoryMutationOutcome>("execute_remote_mutation", { repositoryRoot, plan });
  },

  async prepareGitReset(repositoryRoot: string, targetOid: string): Promise<GitResetPlan> {
    if (!isTauri) return demoPrepareGitReset(browserSnapshot, targetOid);
    return invoke<GitResetPlan>("prepare_git_reset", { repositoryRoot, targetOid });
  },

  async executeGitReset(repositoryRoot: string, plan: GitResetPlan, mode: GitResetMode): Promise<RepositoryMutationOutcome> {
    if (!isTauri) {
      await demoDelay(220);
      browserSnapshot = demoExecuteGitReset(browserSnapshot, plan, mode);
      return completeDemoMutation();
    }
    return invoke<RepositoryMutationOutcome>("execute_git_reset", { repositoryRoot, plan, mode });
  },

  async fetchRemote(
    repositoryRoot: string,
    remote: string,
    operationId: string,
  ): Promise<RepositoryMutationOutcome> {
    if (!isTauri) {
      await demoDelay(480);
      if (cancelledDemoRemoteOperations.delete(remoteOperationKey(repositoryRoot, operationId))) {
        throw new Error("Fetch was cancelled; local tracking refs may have changed.");
      }
      browserSnapshot = demoFetchRemote(browserSnapshot, remote);
      return {
        snapshot: demoTrackedSnapshot(browserSnapshot),
        invalidatedSlices: ["head", "refs", "history"],
      };
    }
    return invoke<RepositoryMutationOutcome>("fetch_remote", {
      repositoryRoot,
      remote,
      operationId,
    });
  },

  async readRemoteAuthentication(
    repositoryRoot: string,
    remote: string,
  ): Promise<RemoteAuthenticationStatus> {
    if (!isTauri) {
      return {
        remote,
        transport: "https",
        host: "example.invalid",
        credentialAvailable: true,
        credentialHelperConfigured: true,
        suggestedSshUrl: "git@example.invalid:team/repository.git",
      };
    }
    return invoke<RemoteAuthenticationStatus>("read_remote_authentication", {
      repositoryRoot,
      remote,
    });
  },

  async storeRemoteHttpsCredential(
    repositoryRoot: string,
    remote: string,
    username: string,
    token: string,
  ): Promise<RemoteAuthenticationStatus> {
    if (!isTauri) {
      return {
        remote,
        transport: "https",
        host: "example.invalid",
        credentialAvailable: Boolean(username && token),
        credentialHelperConfigured: true,
        suggestedSshUrl: "git@example.invalid:team/repository.git",
      };
    }
    return invoke<RemoteAuthenticationStatus>("store_remote_https_credential", {
      repositoryRoot,
      remote,
      username,
      token,
    });
  },

  async configureRemoteSsh(
    repositoryRoot: string,
    remote: string,
    sshUrl: string,
  ): Promise<RemoteAuthenticationStatus> {
    if (!isTauri) {
      return {
        remote,
        transport: "ssh",
        host: sshUrl.includes("@") ? sshUrl.split("@").at(-1)?.split(/[/:]/)[0] ?? null : null,
        credentialAvailable: true,
        credentialHelperConfigured: false,
        suggestedSshUrl: null,
      };
    }
    return invoke<RemoteAuthenticationStatus>("configure_remote_ssh", {
      repositoryRoot,
      remote,
      sshUrl,
    });
  },

  async readPushPreview(
    repositoryRoot: string,
    remote: string,
    tagMode: PushTagMode,
    offset: number,
    pageSize: number,
  ): Promise<PushPreview> {
    if (!isTauri) {
      await demoDelay(120);
      return demoPushPreview(remote, tagMode, offset, pageSize);
    }
    return invoke<PushPreview>("read_push_preview", {
      repositoryRoot,
      remote,
      tagMode,
      offset,
      pageSize,
    });
  },

  async readPushFileCommit(
    repositoryRoot: string,
    remote: string,
    tagMode: PushTagMode,
    previewToken: string,
    path: string,
  ): Promise<CommitDetails | null> {
    if (!isTauri) {
      await demoDelay(100);
      if (demoPushPreview(remote, tagMode, 0, 1).previewToken !== previewToken) {
        throw new Error("The Push review is stale. Refresh it before opening Diff.");
      }
      const commit = browserSnapshot.commits.find((candidate) =>
        (browserCommitFiles.get(candidate.oid) ?? demoCommitDetails(candidate.oid).files)
          .some((file) => file.path === path),
      );
      return commit ? demoCommitDetails(commit.oid) : null;
    }
    return invoke<CommitDetails | null>("read_push_file_commit", {
      repositoryRoot,
      remote,
      tagMode,
      previewToken,
      path,
    });
  },

  async pullCurrent(
    repositoryRoot: string,
    operationId: string,
  ): Promise<RepositoryMutationOutcome> {
    if (!isTauri) {
      await demoDelay(560);
      if (cancelledDemoRemoteOperations.delete(remoteOperationKey(repositoryRoot, operationId))) {
        throw new Error("Pull was cancelled; refresh before continuing.");
      }
      browserSnapshot = demoPullCurrent(browserSnapshot);
      return completeDemoMutation();
    }
    return invoke<RepositoryMutationOutcome>("pull_current", {
      repositoryRoot,
      operationId,
    });
  },

  async pushCurrent(
    repositoryRoot: string,
    remote: string,
    mode: PushMode,
    tagMode: PushTagMode,
    previewToken: string,
    operationId: string,
  ): Promise<RepositoryMutationOutcome> {
    if (!isTauri) {
      await demoDelay(520);
      if (cancelledDemoRemoteOperations.delete(remoteOperationKey(repositoryRoot, operationId))) {
        throw new Error("Push was cancelled; the remote outcome is unknown until fetch.");
      }
      if (demoPushPreview(remote, tagMode, 0, 1).previewToken !== previewToken) {
        throw new Error("The branch or HEAD changed after confirmation. Review the push again.");
      }
      browserSnapshot = demoPushCurrent(browserSnapshot, remote);
      return {
        snapshot: demoTrackedSnapshot(browserSnapshot),
        invalidatedSlices: ["head", "refs", "history"],
      };
    }
    return invoke<RepositoryMutationOutcome>("push_current", {
      repositoryRoot,
      remote,
      mode,
      tagMode,
      previewToken,
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

  async readGitOperation(repositoryRoot: string): Promise<GitOperationSnapshot | null> {
    if (!isTauri) return browserSnapshot.root === repositoryRoot ? browserSnapshot.operation : null;
    return invoke<GitOperationSnapshot | null>("read_git_operation", { repositoryRoot });
  },

  async prepareGitOperation(
    repositoryRoot: string,
    kind: GitOperationKind,
    targetRefs: string[],
    message: string | null,
  ): Promise<GitOperationPlan> {
    if (!isTauri) {
      await demoDelay(120);
      const head = browserSnapshot.branch.oid;
      const headName = browserSnapshot.branch.head;
      if (!head || !headName || browserSnapshot.changes.length > 0) {
        throw new Error("A clean checked-out branch is required.");
      }
      const targetOids = targetRefs.map((target) =>
        browserSnapshot.branches.find((branch) => branch.fullName === target || branch.name === target)?.oid ?? target,
      );
      const commitCount = kind === "cherryPick" ? targetRefs.length : kind === "squash" ? 2 : 1;
      return {
        kind,
        repositoryRoot,
        startHeadOid: head,
        startHeadRef: `refs/heads/${headName}`,
        targetRefs,
        targetOids,
        commitCount,
        summary: `${kind} ${targetRefs.join(", ")}`,
        message,
        previewToken: [kind, repositoryRoot, head, ...targetRefs, message ?? ""].join("|"),
      };
    }
    return invoke<GitOperationPlan>("prepare_git_operation", {
      repositoryRoot,
      kind,
      targetRefs,
      message,
    });
  },

  async executeGitOperation(
    repositoryRoot: string,
    plan: GitOperationPlan,
  ): Promise<RepositoryMutationOutcome> {
    if (!isTauri) {
      await demoDelay(280);
      if (plan.startHeadOid !== browserSnapshot.branch.oid) {
        throw new Error("The reviewed operation plan is stale.");
      }
      return completeDemoMutation();
    }
    return invoke<RepositoryMutationOutcome>("execute_git_operation", { repositoryRoot, plan });
  },

  async runGitOperationAction(
    repositoryRoot: string,
    action: GitOperationAction,
  ): Promise<RepositoryMutationOutcome> {
    if (!isTauri) throw new Error(`No demo Git operation can ${action}.`);
    return invoke<RepositoryMutationOutcome>("run_git_operation_action", {
      repositoryRoot,
      action,
    });
  },

  async readConflictContent(
    repositoryRoot: string,
    path: string,
  ): Promise<GitConflictContent> {
    if (!isTauri) throw new Error("The browser demo has no conflicted index.");
    return invoke<GitConflictContent>("read_conflict_content", { repositoryRoot, path });
  },

  async resolveConflict(
    repositoryRoot: string,
    path: string,
    expectedRevisionToken: string,
    content: string | null,
  ): Promise<GitOperationMutationOutcome> {
    if (!isTauri) throw new Error("The browser demo has no conflicted index.");
    return invoke<GitOperationMutationOutcome>("resolve_conflict", {
      repositoryRoot,
      path,
      expectedRevisionToken,
      content,
    });
  },

  async startTerminal(workspaceRoot: string): Promise<TerminalStarted> {
    if (demoTerminalSession) throw new Error("A terminal is already running in this window.");
    demoTerminalSession = {
      protocolVersion: 1,
      sessionId: "demo-terminal-1",
      shell: "demo-shell",
      cwd: workspaceRoot,
    };
    demoTerminalSequence = 0;
    return structuredClone(demoTerminalSession);
  },

  async writeTerminal(sessionId: string, dataBase64: string): Promise<void> {
    if (demoTerminalSession?.sessionId !== sessionId) {
      throw new Error("The terminal session is no longer current.");
    }
    demoTerminalSequence += 1;
    const event: TerminalEvent = {
      protocolVersion: 1,
      kind: "output",
      sessionId,
      sequence: demoTerminalSequence,
      dataBase64,
    };
    demoTerminalListeners.forEach((listener) => listener(event));
  },

  async resizeTerminal(sessionId: string): Promise<void> {
    if (demoTerminalSession?.sessionId !== sessionId) {
      throw new Error("The terminal session is no longer current.");
    }
  },

  async closeTerminal(sessionId: string): Promise<boolean> {
    if (demoTerminalSession?.sessionId !== sessionId) return false;
    demoTerminalSession = null;
    const event: TerminalEvent = {
      protocolVersion: 1,
      kind: "exited",
      sessionId,
      exitCode: 0,
      signal: null,
    };
    demoTerminalListeners.forEach((listener) => listener(event));
    return true;
  },

  async subscribeTerminal(listener: (event: TerminalEvent) => void): Promise<() => void> {
    demoTerminalListeners.add(listener);
    return () => demoTerminalListeners.delete(listener);
  },
};

export const demoDesktopBridge: DesktopBridge = isTauri ? tauriDesktopBridge : demoBridge;
export type { DirectoryChoice } from "../../protocol/desktop-bridge";

const COMPLETE_DEMO_REPOSITORY_SLICES = [
  "workspaceCatalog",
  "openDocuments",
  "workingTree",
  "head",
  "refs",
  "history",
  "operation",
] as const;

function demoPushPreview(
  remote: string,
  tagMode: PushTagMode,
  offset: number,
  pageSize: number,
): PushPreview {
  const branch = browserSnapshot.branch;
  if (!branch.head || !branch.oid || branch.detached || branch.unborn) {
    throw new Error("A checked-out branch with a commit is required.");
  }
  if (!browserSnapshot.remotes.some((item) => item.name === remote && item.pushSupported)) {
    throw new Error("Select a supported push remote.");
  }
  const sourceRef = `refs/heads/${branch.head}`;
  const targetsUpstream = branch.upstreamRemote === remote;
  const destinationRef = targetsUpstream ? branch.upstreamRef ?? sourceRef : sourceRef;
  const comparisonBaseOid = browserSnapshot.branches.find(
    (candidate) =>
      candidate.kind === "remote" &&
      candidate.fullName ===
        `refs/remotes/${remote}/${destinationRef.replace(/^refs\/heads\//, "")}`,
  )?.oid ?? null;
  const publish = comparisonBaseOid === null;
  const totalCommits = publish
    ? Math.max(branch.ahead, 1)
    : branch.ahead;
  const commits = browserSnapshot.commits.slice(
    offset,
    Math.min(offset + pageSize, totalCommits),
  );
  const previewToken = [
    "demo-v3",
    remote,
    sourceRef,
    destinationRef,
    branch.oid,
    comparisonBaseOid ?? "new",
    publish ? "publish" : "existing-destination",
    branch.upstreamRemote ? "keep-upstream" : "configure-upstream",
    tagMode,
  ].join("|");
  const filesByPath = new Map<string, CommitFileChange>();
  for (const commit of browserSnapshot.commits.slice(0, totalCommits)) {
    for (const file of browserCommitFiles.get(commit.oid) ?? demoCommitDetails(commit.oid).files) {
      filesByPath.set(file.path, file);
    }
  }
  const files = [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  const ordinaryAllowed = branch.behind === 0;
  return {
    remote,
    branch: branch.head,
    sourceRef,
    destinationRef,
    headOid: branch.oid,
    comparisonBaseOid,
    publish,
    ordinaryAllowed,
    ordinaryBlockReason: ordinaryAllowed
      ? null
      : "The local branch is not a descendant of the last-fetched remote branch.",
    forceWithLeaseAllowed: comparisonBaseOid !== null,
    forceWithLeaseBlockReason: comparisonBaseOid === null
      ? "No last-fetched destination object exists for an exact lease."
      : null,
    tagMode,
    tags: [],
    files,
    filesTruncated: false,
    commits,
    offset,
    totalCommits,
    hasMore: offset + commits.length < totalCommits,
    truncated: false,
    previewToken,
  };
}

function remoteOperationKey(repositoryRoot: string, operationId: string): string {
  return `${repositoryRoot}\0${operationId}`;
}

function searchOperationKey(repositoryRoot: string, requestId: string): string {
  return `${repositoryRoot}\0${requestId}`;
}

function demoDelay(milliseconds = 160): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function demoBlameRanges(path: string): Array<{ start: number; count: number }> {
  const ranges = [{
    start: 1,
    count: Math.max(1, (demoTextFiles.get(path)?.content ?? "").split("\n").length),
  }];
  const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  for (const match of demoDiff(path, false).patch.matchAll(header)) {
    for (const [startValue, countValue] of [[match[1], match[2]], [match[3], match[4]]]) {
      const start = Number(startValue);
      const count = countValue === undefined ? 1 : Number(countValue);
      if (Number.isSafeInteger(start) && start > 0 && Number.isSafeInteger(count) && count > 0) {
        ranges.push({ start, count });
      }
    }
  }
  ranges.sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; count: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.start + previous.count) {
      merged.push({ ...range });
      continue;
    }
    const end = Math.max(previous.start + previous.count, range.start + range.count);
    previous.count = end - previous.start;
  }
  return merged;
}

function demoTextRevision(
  path: string,
  file: { content: string; utf8Bom: boolean; revision: number },
): string {
  return `demo:${path}:${file.revision}:${file.utf8Bom ? "bom" : "plain"}`;
}

function demoTextComparisonPatch(path: string, before: string, after: string): string {
  if (before === after) return "";
  const removed = before.replace(/\r\n?/gu, "\n").split("\n").map((line) => `-${line}`).join("\n");
  const added = after.replace(/\r\n?/gu, "\n").split("\n").map((line) => `+${line}`).join("\n");
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${removed}\n${added}\n`;
}

function reconcileDemoTextChange(
  path: string,
  file: { content: string; utf8Bom: boolean },
): void {
  const baseline = demoTextBaselines.get(path);
  if (!baseline) return;
  const modified = file.content !== baseline.content || file.utf8Bom !== baseline.utf8Bom;
  const index = browserSnapshot.changes.findIndex((change) => change.path === path);
  const existing = index >= 0 ? browserSnapshot.changes[index] : null;
  if (existing?.worktreeStatus === "untracked") return;
  if (!existing && modified) {
    browserSnapshot.changes.push({
      path,
      originalPath: null,
      indexStatus: "unmodified",
      worktreeStatus: "modified",
      conflicted: false,
      submodule: false,
    });
    return;
  }
  if (!existing) return;
  existing.worktreeStatus = modified ? "modified" : "unmodified";
  if (existing.indexStatus === "unmodified" && !modified) {
    browserSnapshot.changes.splice(index, 1);
  }
}

function demoWorkspaceSearch(
  requestId: string,
  query: string,
  options: WorkspaceTextSearchOptions,
): WorkspaceTextSearchReport {
  const encoder = new TextEncoder();
  if (
    query.length === 0 ||
    query.includes("\n") ||
    query.includes("\r") ||
    query.includes("\0") ||
    encoder.encode(query).length > 4_096
  ) {
    throw {
      kind: "invalidSearch",
      message: "Search text must be one non-empty line of at most 4096 UTF-8 bytes.",
    };
  }
  if (
    options.contextLines < 0 ||
    options.contextLines > 3 ||
    !Number.isInteger(options.contextLines)
  ) {
    throw { kind: "invalidSearch", message: "Search context must be between 0 and 3 lines." };
  }
  const include = compileDemoGlobs("include", options.includeGlobs, encoder);
  const exclude = compileDemoGlobs("exclude", options.excludeGlobs, encoder);
  const regularExpression = options.mode === "regex" ? demoCompileRegex(query) : null;
  const entries = Array.from(demoTextFiles.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const eligible = entries.filter(([path]) =>
    (include.length === 0 || include.some((pattern) => pattern.test(path))) &&
    !exclude.some((pattern) => pattern.test(path)),
  );
  const matches: WorkspaceTextSearchReport["matches"] = [];
  let bytesRead = 0;
  let filesSearched = 0;
  for (const [path, file] of eligible) {
    const normalized = file.content.replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    bytesRead += encoder.encode(file.content).length;
    filesSearched += 1;
    let documentOffset = 0;
    for (const [lineIndex, line] of lines.entries()) {
      const ranges = regularExpression
        ? demoRegexRanges(regularExpression, line)
        : demoLiteralRanges(query, line);
      for (const [fromInLine, toInLine] of ranges) {
        const preview = demoSearchPreview(
          lines,
          lineIndex,
          fromInLine,
          toInLine,
          options.contextLines,
        );
        matches.push({
          repositoryId: browserGitEnabled ? "." : "workspace",
          path,
          workspacePath: path,
          revision: demoTextRevision(path, file),
          fromUtf16: documentOffset + fromInLine,
          toUtf16: documentOffset + toInLine,
          line: lineIndex + 1,
          columnUtf16: fromInLine + 1,
          preview: preview.text,
          previewFromUtf16: preview.from,
          previewToUtf16: preview.to,
          leadingClipped: preview.leadingClipped,
          trailingClipped: preview.trailingClipped,
        });
        if (matches.length === 500) {
          return demoSearchReport(
            requestId,
            matches,
            entries.length,
            eligible.length,
            filesSearched,
            bytesRead,
            ["matchLimit"],
          );
        }
      }
      documentOffset += line.length + (lineIndex + 1 < lines.length ? 1 : 0);
    }
  }
  return demoSearchReport(
    requestId,
    matches,
    entries.length,
    eligible.length,
    filesSearched,
    bytesRead,
    [],
  );
}

function demoSearchReport(
  requestId: string,
  matches: WorkspaceTextSearchReport["matches"],
  catalogCandidates: number,
  eligibleCandidates: number,
  filesSearched: number,
  bytesRead: number,
  coverageReasons: WorkspaceTextSearchReport["coverageReasons"],
): WorkspaceTextSearchReport {
  return {
    requestId,
    matches,
    catalogCandidates,
    eligibleCandidates,
    filesSearched,
    bytesRead,
    skippedCount: 0,
    skippedFiles: [],
    coverageReasons,
  };
}

function demoReplacementPreview(
  planId: string,
  query: string,
  replacement: string,
  options: WorkspaceTextSearchOptions,
): WorkspaceReplacementPreview {
  if (new TextEncoder().encode(replacement).length > 16 * 1024 || replacement.includes("\0")) {
    throw {
      kind: "invalidReplacement",
      message: "Replacement text must contain no NUL and be at most 16384 UTF-8 bytes.",
    };
  }
  const report = demoWorkspaceSearch(planId, query, options);
  if (report.coverageReasons.some((reason) => reason !== "skippedFiles")) {
    throw {
      kind: "invalidReplacement",
      message: "Replacement preview requires complete candidate and match coverage.",
    };
  }
  const matchesByPath = new Map<string, number>();
  for (const match of report.matches) {
    matchesByPath.set(match.workspacePath, (matchesByPath.get(match.workspacePath) ?? 0) + 1);
  }
  const files: DemoReplacementFile[] = [];
  const previews: WorkspaceReplacementPreview["files"] = [];
  const encoder = new TextEncoder();
  for (const [workspacePath, matchCount] of matchesByPath) {
    const file = demoTextFiles.get(workspacePath);
    if (!file) continue;
    const replacementContent = demoReplaceLineLocal(file.content, query, replacement, options.mode);
    if (replacementContent === file.content) continue;
    const [beforePreview, afterPreview] = demoChangePreview(file.content, replacementContent);
    files.push({
      workspacePath,
      originalContent: file.content,
      replacementContent,
      utf8Bom: file.utf8Bom,
      originalRevision: file.revision,
    });
    previews.push({
      repositoryId: browserGitEnabled ? "." : "workspace",
      path: workspacePath,
      workspacePath,
      matchCount,
      byteDelta:
        encoder.encode(replacementContent).length - encoder.encode(file.content).length,
      beforePreview,
      afterPreview,
    });
  }
  if (previews.length === 0) {
    throw { kind: "invalidReplacement", message: "The replacement would not change any file." };
  }
  if (previews.length > 200) {
    throw { kind: "invalidReplacement", message: "Replacement preview accepts at most 200 files." };
  }
  demoReplacementPlans.clear();
  demoReplacementPlans.set(planId, { planId, files });
  return {
    planId,
    files: previews,
    totalMatches: previews.reduce((total, file) => total + file.matchCount, 0),
    skippedCount: report.skippedCount,
    coverageReasons: report.coverageReasons,
  };
}

function demoApplyReplacement(
  planId: string,
  selectedPaths: string[],
): ReplacementApplyResult {
  const plan = demoReplacementPlans.get(planId);
  const selected = new Set(selectedPaths);
  if (!plan || selected.size === 0 || selected.size !== selectedPaths.length) {
    throw { kind: "invalidReplacement", message: "Replacement preview is stale or empty." };
  }
  const files = plan.files.filter((file) => selected.has(file.workspacePath));
  if (files.length !== selected.size) {
    throw { kind: "invalidReplacement", message: "Selection is outside the reviewed preview." };
  }
  for (const planned of files) {
    const current = demoTextFiles.get(planned.workspacePath);
    if (
      !current ||
      current.revision !== planned.originalRevision ||
      current.content !== planned.originalContent ||
      current.utf8Bom !== planned.utf8Bom
    ) {
      throw { kind: "conflict", currentRevision: current?.revision.toString() ?? "missing" };
    }
  }
  const recovery: DemoReplacementRecovery = { ...plan, files, selectedPaths: [...selectedPaths] };
  demoReplacementRecoveries.set(planId, recovery);
  for (const planned of files) {
    const current = demoTextFiles.get(planned.workspacePath)!;
    current.content = planned.replacementContent;
    current.revision += 1;
  }
  demoReplacementPlans.delete(planId);
  return {
    ...demoRecoverySummary(recovery),
    message: null,
  };
}

function demoRollbackReplacement(recoveryId: string): ReplacementApplyResult {
  const recovery = demoReplacementRecoveries.get(recoveryId);
  if (!recovery) {
    throw { kind: "invalidReplacement", message: "Replacement recovery is unavailable." };
  }
  for (const planned of recovery.files) {
    const current = demoTextFiles.get(planned.workspacePath);
    if (!current) continue;
    if (current.content === planned.replacementContent && current.utf8Bom === planned.utf8Bom) {
      current.content = planned.originalContent;
      current.revision += 1;
    }
  }
  const summary = demoRecoverySummary(recovery);
  if (summary.files.every((file) => file.state === "original")) {
    demoReplacementRecoveries.delete(recoveryId);
    return { ...summary, status: "rolledBack", message: null };
  }
  return { ...summary, status: "needsRecovery", message: null };
}

function demoFinalizeReplacement(recoveryId: string): void {
  const recovery = demoReplacementRecoveries.get(recoveryId);
  if (!recovery) {
    throw { kind: "invalidReplacement", message: "Replacement recovery is unavailable." };
  }
  const summary = demoRecoverySummary(recovery);
  if (!summary.files.every((file) => file.state === "replaced")) {
    throw {
      kind: "invalidReplacement",
      message: "Recovery can be kept only while every file still contains the reviewed replacement.",
    };
  }
  demoReplacementRecoveries.delete(recoveryId);
}

function demoRecoverySummary(recovery: DemoReplacementRecovery): ReplacementRecoverySummary {
  return {
    recoveryId: recovery.planId,
    status: recovery.files.every((planned) => {
      const current = demoTextFiles.get(planned.workspacePath);
      return current?.content === planned.replacementContent && current.utf8Bom === planned.utf8Bom;
    })
      ? "applied"
      : "needsRecovery",
    files: recovery.files.map((planned) => {
      const current = demoTextFiles.get(planned.workspacePath);
      const state = !current
        ? "unavailable"
        : current.content === planned.originalContent && current.utf8Bom === planned.utf8Bom
          ? "original"
          : current.content === planned.replacementContent && current.utf8Bom === planned.utf8Bom
            ? "replaced"
            : "conflict";
      return { workspacePath: planned.workspacePath, state };
    }),
  };
}

function demoReplaceLineLocal(
  content: string,
  query: string,
  replacement: string,
  mode: WorkspaceTextSearchOptions["mode"],
): string {
  const separator = demoDominantSeparator(content);
  const inserted = replacement.replace(/\r\n?|\n/gu, "\n").replaceAll("\n", separator);
  const parts = content.split(/(\r\n|\r|\n)/u);
  const expression = mode === "regex" ? demoCompileRegex(query) : null;
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return expression ? part.replace(expression, inserted) : part.split(query).join(inserted);
    })
    .join("");
}

function demoDominantSeparator(content: string): string {
  const separators = content.match(/\r\n|\r|\n/gu) ?? [];
  const counts = new Map<string, number>();
  for (const separator of separators) counts.set(separator, (counts.get(separator) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "\n";
}

function demoChangePreview(before: string, after: string): [string, string] {
  let offset = 0;
  while (offset < before.length && offset < after.length && before[offset] === after[offset]) {
    offset += 1;
  }
  const line = (value: string) => {
    const start = Math.max(value.lastIndexOf("\n", offset - 1), value.lastIndexOf("\r", offset - 1)) + 1;
    const endings = [value.indexOf("\n", offset), value.indexOf("\r", offset)].filter((index) => index >= 0);
    const end = endings.length > 0 ? Math.min(...endings) : value.length;
    const text = value.slice(start, end);
    return text.length > 320 ? `${safePrefixUtf16(text, 320)}…` : text;
  };
  return [line(before), line(after)];
}

function demoCompileRegex(query: string): RegExp {
  let source = query;
  let flags = "gu";
  if (source.startsWith("(?i)")) {
    source = source.slice(4);
    flags += "i";
  }
  try {
    return new RegExp(source, flags);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw {
      kind: "invalidSearch",
      message: detail.toLocaleLowerCase().startsWith("invalid regular expression")
        ? detail
        : `Invalid regular expression: ${detail}`,
    };
  }
}

function demoRegexRanges(expression: RegExp, line: string): Array<[number, number]> {
  expression.lastIndex = 0;
  const ranges: Array<[number, number]> = [];
  let found: RegExpExecArray | null;
  while ((found = expression.exec(line)) !== null) {
    ranges.push([found.index, found.index + found[0].length]);
    if (found[0].length === 0) expression.lastIndex = nextUnicodeOffset(line, expression.lastIndex);
  }
  return ranges;
}

function nextUnicodeOffset(value: string, offset: number): number {
  if (offset >= value.length) return value.length + 1;
  const code = value.codePointAt(offset);
  return offset + (code !== undefined && code > 0xffff ? 2 : 1);
}

function demoLiteralRanges(query: string, line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  while (cursor <= line.length - query.length) {
    const from = line.indexOf(query, cursor);
    if (from < 0) break;
    ranges.push([from, from + query.length]);
    cursor = from + query.length;
  }
  return ranges;
}

function demoSearchPreview(
  lines: string[],
  lineIndex: number,
  fromInLine: number,
  toInLine: number,
  contextLines: number,
): { text: string; from: number; to: number; leadingClipped: boolean; trailingClipped: boolean } {
  const firstLine = Math.max(0, lineIndex - contextLines);
  const lastLine = Math.min(lines.length - 1, lineIndex + contextLines);
  const beforeMatch = lines
    .slice(firstLine, lineIndex)
    .reduce((length, line) => length + line.length + 1, 0);
  const window = lines.slice(firstLine, lastLine + 1).join("\n");
  const from = beforeMatch + fromInLine;
  const to = beforeMatch + toInLine;
  const matched = window.slice(from, to);
  if (matched.length > 320) {
    const visible = safePrefixUtf16(matched, 320);
    return {
      text: visible,
      from: 0,
      to: visible.length,
      leadingClipped: from > 0,
      trailingClipped: true,
    };
  }
  const context = 320 - matched.length;
  const before = safeSuffixUtf16(window.slice(0, from), Math.floor(context / 2));
  const after = safePrefixUtf16(window.slice(to), context - before.length);
  return {
    text: `${before}${matched}${after}`,
    from: before.length,
    to: before.length + matched.length,
    leadingClipped: before.length < from,
    trailingClipped: after.length < window.length - to,
  };
}

function safePrefixUtf16(value: string, limit: number): string {
  let end = Math.min(value.length, limit);
  if (end > 0 && end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}

function safeSuffixUtf16(value: string, limit: number): string {
  let start = Math.max(0, value.length - limit);
  if (start > 0 && start < value.length && /[\uDC00-\uDFFF]/u.test(value[start]!)) start += 1;
  return value.slice(start);
}
