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
  ReplacementApplyResult,
  ReplacementRecoverySummary,
  RepositorySnapshot,
  SaveTextFileResult,
  TextFileSnapshot,
  UntrackedScan,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchReport,
  WorkspaceReplacementPreview,
} from "./models";

const isTauri = "__TAURI_INTERNALS__" in window;
let browserSnapshot = structuredClone(demoSnapshot);
const browserCommitFiles = new Map<string, CommitFileChange[]>();
const cancelledDemoScans = new Set<string>();
const cancelledDemoRemoteOperations = new Set<string>();
const cancelledDemoSearches = new Set<string>();
const cancelledDemoReplacements = new Set<string>();
const demoReplacementPlans = new Map<string, DemoReplacementPlan>();
const demoReplacementRecoveries = new Map<string, DemoReplacementRecovery>();
const demoTextFiles = new Map<string, { content: string; utf8Bom: boolean; revision: number }>([
  ["README.md", { content: "# Asterlyn\n\nA lightweight developer workspace.\n", utf8Bom: false, revision: 1 }],
  ["package.json", { content: '{\n  "name": "asterlyn"\n}\n', utf8Bom: false, revision: 1 }],
  ["src/app.ts", { content: "export class AsterlynApp {\r\n  // Browser demo\n}\r\n", utf8Bom: false, revision: 1 }],
  ["src/bridge.ts", { content: "export const bridge = {};\n", utf8Bom: false, revision: 1 }],
  ["src/diff-editor.ts", { content: "export class DiffEditor {}\n", utf8Bom: false, revision: 1 }],
  ["src/styles.css", { content: ":root {\n  color-scheme: dark;\n}\n", utf8Bom: false, revision: 1 }],
]);

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
      for (const path of paths) {
        if (!demoTextFiles.has(path)) {
          demoTextFiles.set(path, {
            content: `Demo content for ${path}\n`,
            utf8Bom: false,
            revision: 1,
          });
        }
      }
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
      if (repositoryId !== "." || !file) {
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
      if (repositoryId !== "." || !file) {
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

function searchOperationKey(repositoryRoot: string, requestId: string): string {
  return `${repositoryRoot}\0${requestId}`;
}

function demoDelay(milliseconds = 160): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function demoTextRevision(
  path: string,
  file: { content: string; utf8Bom: boolean; revision: number },
): string {
  return `demo:${path}:${file.revision}:${file.utf8Bom ? "bom" : "plain"}`;
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
  const include = demoCompileGlobs("include", options.includeGlobs, encoder);
  const exclude = demoCompileGlobs("exclude", options.excludeGlobs, encoder);
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
          repositoryId: ".",
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
      repositoryId: ".",
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

function demoCompileGlobs(
  kind: "include" | "exclude",
  sources: string[],
  encoder: TextEncoder,
): RegExp[] {
  if (sources.length > 32) {
    throw { kind: "invalidSearch", message: `Search accepts at most 32 ${kind} path patterns.` };
  }
  return sources.map((source) => {
    const invalidComponent = source.split("/").some((part) => part === "." || part === "..");
    if (
      source.length === 0 ||
      encoder.encode(source).length > 256 ||
      source.startsWith("/") ||
      /[\0\r\n\\{}]/u.test(source) ||
      source.includes("//") ||
      invalidComponent
    ) {
      throw {
        kind: "invalidSearch",
        message: `${kind} path patterns must be relative '/'-separated globs of at most 256 bytes.`,
      };
    }
    return new RegExp(`^${demoGlobSource(source)}$`, "u");
  });
}

function demoGlobSource(pattern: string): string {
  let result = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        result += ".*";
        index += 1;
      } else {
        result += "[^/]*";
      }
    } else if (character === "?") {
      result += "[^/]";
    } else if (character === "[") {
      const closing = pattern.indexOf("]", index + 1);
      if (closing < 0) throw { kind: "invalidSearch", message: `Invalid path pattern '${pattern}'.` };
      const body = pattern.slice(index + 1, closing);
      const negated = body.startsWith("!");
      result += `[${negated ? "^" : ""}${body.slice(negated ? 1 : 0).replaceAll("/", "\\/")}]`;
      index = closing;
    } else {
      result += character.replace(/[.+^$()|]/gu, "\\$&");
    }
  }
  return result;
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
