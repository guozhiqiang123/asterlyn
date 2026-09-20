import type {
  BranchMutationPlan,
  BranchMutationRequest,
  ChangeKind,
  CommitDetails,
  CommitDiffResult,
  CommitFileChange,
  CommitSummary,
  DiffResult,
  HistoryQuery,
  RepositorySnapshot,
  UntrackedScan,
} from "./models";

export const demoSnapshot: RepositorySnapshot = {
  root: "/workspace/asterlyn",
  gitDir: "/workspace/asterlyn/.git",
  repositoryRoots: [
    {
      id: ".",
      relativePath: ".",
      displayName: "asterlyn",
      kind: "main",
    },
  ],
  branch: {
    head: "feature/git-workbench",
    oid: "df535785471311c9cdd936ff023d7d65dafb74a3",
    upstream: "origin/feature/git-workbench",
    upstreamRemote: "origin",
    upstreamRef: "refs/heads/feature/git-workbench",
    ahead: 2,
    behind: 0,
    detached: false,
    unborn: false,
  },
  operation: null,
  changes: [
    {
      path: "crates/asterlyn-git/src/repository.rs",
      originalPath: null,
      indexStatus: "modified",
      worktreeStatus: "modified",
      conflicted: false,
      submodule: false,
    },
    {
      path: "src/app.ts",
      originalPath: null,
      indexStatus: "unmodified",
      worktreeStatus: "modified",
      conflicted: false,
      submodule: false,
    },
    {
      path: "src/diff-editor.ts",
      originalPath: null,
      indexStatus: "added",
      worktreeStatus: "unmodified",
      conflicted: false,
      submodule: false,
    },
    {
      path: "docs/product/roadmap.md",
      originalPath: null,
      indexStatus: "unmodified",
      worktreeStatus: "modified",
      conflicted: false,
      submodule: false,
    },
    {
      path: "docs/notes/m1-benchmark.md",
      originalPath: null,
      indexStatus: "unmodified",
      worktreeStatus: "untracked",
      conflicted: false,
      submodule: false,
    },
  ],
  commits: [
    {
      repositoryId: ".",
      oid: "df535785471311c9cdd936ff023d7d65dafb74a3",
      shortOid: "df53578",
      parents: [
        "c333333333333333333333333333333333333333",
        "b4c3d2e1f09876543210fedcba9876543210abcd",
      ],
      authorName: "Guozhiqiang",
      authorEmail: "developer@example.invalid",
      authoredAt: 1788839400,
      decorations: ["HEAD -> feature/git-workbench"],
      subject: "merge: complete the Git workbench foundation",
    },
    {
      repositoryId: ".",
      oid: "c333333333333333333333333333333333333333",
      shortOid: "c333333",
      parents: ["c222222222222222222222222222222222222222"],
      authorName: "Guozhiqiang",
      authorEmail: "developer@example.invalid",
      authoredAt: 1788839300,
      decorations: [],
      subject: "test(git): cover safe remote synchronization",
    },
    {
      repositoryId: ".",
      oid: "c222222222222222222222222222222222222222",
      shortOid: "c222222",
      parents: ["c111111111111111111111111111111111111111"],
      authorName: "Guozhiqiang",
      authorEmail: "developer@example.invalid",
      authoredAt: 1788839200,
      decorations: [],
      subject: "feat(diff): link horizontal and vertical scrolling",
    },
    {
      repositoryId: ".",
      oid: "c111111111111111111111111111111111111111",
      shortOid: "c111111",
      parents: ["a68b48279c6b51f8adcf1bb20ca7e7c61284bf31"],
      authorName: "Guozhiqiang",
      authorEmail: "developer@example.invalid",
      authoredAt: 1788839100,
      decorations: [],
      subject: "feat(workbench): add resizable Git panes",
    },
    {
      repositoryId: ".",
      oid: "a68b48279c6b51f8adcf1bb20ca7e7c61284bf31",
      shortOid: "a68b482",
      parents: ["54978419e233f8b5f53c55197e2742a3440ef894"],
      authorName: "Guozhiqiang",
      authorEmail: "developer@example.invalid",
      authoredAt: 1788839000,
      decorations: ["origin/feature/git-workbench"],
      subject: "feat(git): add tested repository core",
    },
    {
      repositoryId: ".",
      oid: "b4c3d2e1f09876543210fedcba9876543210abcd",
      shortOid: "b4c3d2e",
      parents: ["54978419e233f8b5f53c55197e2742a3440ef894"],
      authorName: "Asterlyn Contributor",
      authorEmail: "contributor@example.invalid",
      authoredAt: 1788838500,
      decorations: ["feature/graph-rendering"],
      subject: "feat(history): prototype topology graph lanes",
    },
    {
      repositoryId: ".",
      oid: "54978419e233f8b5f53c55197e2742a3440ef894",
      shortOid: "5497841",
      parents: [],
      authorName: "Guozhiqiang",
      authorEmail: "developer@example.invalid",
      authoredAt: 1788837600,
      decorations: ["main", "origin/main", "tag: v0.1.0"],
      subject: "docs: establish Asterlyn roadmap and architecture",
    },
  ],
  branches: [
    {
      repositoryId: ".",
      fullName: "refs/heads/feature/git-workbench",
      name: "feature/git-workbench",
      oid: "df535785471311c9cdd936ff023d7d65dafb74a3",
      current: true,
      kind: "local",
      upstream: "origin/feature/git-workbench",
      tracking: "[ahead 2]",
      committedAt: 1788839400,
      subject: "merge: complete the Git workbench foundation",
    },
    {
      repositoryId: ".",
      fullName: "refs/heads/feature/graph-rendering",
      name: "feature/graph-rendering",
      oid: "b4c3d2e1f09876543210fedcba9876543210abcd",
      current: false,
      kind: "local",
      upstream: null,
      tracking: null,
      committedAt: 1788838500,
      subject: "feat(history): prototype topology graph lanes",
    },
    {
      repositoryId: ".",
      fullName: "refs/heads/main",
      name: "main",
      oid: "54978419e233f8b5f53c55197e2742a3440ef894",
      current: false,
      kind: "local",
      upstream: "origin/main",
      tracking: null,
      committedAt: 1788837600,
      subject: "docs: establish Asterlyn roadmap and architecture",
    },
    {
      repositoryId: ".",
      fullName: "refs/remotes/origin/feature/git-workbench",
      name: "origin/feature/git-workbench",
      oid: "a68b48279c6b51f8adcf1bb20ca7e7c61284bf31",
      current: false,
      kind: "remote",
      upstream: null,
      tracking: null,
      committedAt: 1788839000,
      subject: "feat(git): add tested repository core",
    },
    {
      repositoryId: ".",
      fullName: "refs/remotes/origin/main",
      name: "origin/main",
      oid: "54978419e233f8b5f53c55197e2742a3440ef894",
      current: false,
      kind: "remote",
      upstream: null,
      tracking: null,
      committedAt: 1788837600,
      subject: "docs: establish Asterlyn roadmap and architecture",
    },
    {
      repositoryId: ".",
      fullName: "refs/tags/v0.1.0",
      name: "v0.1.0",
      oid: "54978419e233f8b5f53c55197e2742a3440ef894",
      current: false,
      kind: "tag",
      upstream: null,
      tracking: null,
      committedAt: 1788837600,
      subject: "docs: establish Asterlyn roadmap and architecture",
    },
  ],
  remotes: [
    {
      name: "origin",
      fetchSupported: true,
      pushSupported: true,
    },
    {
      name: "backup",
      fetchSupported: true,
      pushSupported: true,
    },
  ],
  untrackedState: "complete",
};

const patches: Record<string, string> = {
  "crates/asterlyn-git/src/repository.rs": `diff --git a/crates/asterlyn-git/src/repository.rs b/crates/asterlyn-git/src/repository.rs
index a42bb66..f732c11 100644
--- a/crates/asterlyn-git/src/repository.rs
+++ b/crates/asterlyn-git/src/repository.rs
@@ -46,7 +46,11 @@ impl GitRepository {
-    pub fn snapshot(&self) -> Result<RepositorySnapshot, GitError> {
+    pub fn snapshot(&self, commit_limit: usize) -> Result<RepositorySnapshot, GitError> {
+        let limit = commit_limit.clamp(1, 500);
         let status = self.run_read(
             "read working tree status",
             ["status", "--porcelain=v2", "--branch", "-z"],
         )?;
+        // Query history only after status identifies an unborn branch.
`,
  "src/app.ts": `diff --git a/src/app.ts b/src/app.ts
index 2e191b1..a802147 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -81,6 +81,12 @@ export class App {
   private async refresh(): Promise<void> {
+    const generation = ++this.requestGeneration;
     const snapshot = await bridge.openRepository(this.repositoryPath);
+    if (generation !== this.requestGeneration) {
+      return;
+    }
     this.state.snapshot = snapshot;
   }
`,
  "src/diff-editor.ts": `diff --git a/src/diff-editor.ts b/src/diff-editor.ts
new file mode 100644
--- /dev/null
+++ b/src/diff-editor.ts
@@ -0,0 +1,7 @@
+import { EditorState } from "@codemirror/state";
+import { EditorView } from "@codemirror/view";
+
+export class DiffEditor {
+  // CodeMirror remains a presentation adapter.
+  private view: EditorView | null = null;
+}
`,
};

export function demoDiff(path: string, staged: boolean): DiffResult {
  return {
    path,
    staged,
    patch:
      patches[path] ??
      `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old content\n+updated content\n`,
    binary: false,
    truncated: false,
  };
}

export function demoCommitDetails(oid: string): CommitDetails {
  const commit = demoSnapshot.commits.find((candidate) => candidate.oid === oid);
  const files: CommitFileChange[] =
    commit?.parents.length === 0
      ? [
          {
            path: "docs/product/roadmap.md",
            originalPath: null,
            status: "added",
          },
          {
            path: "docs/architecture/overview.md",
            originalPath: null,
            status: "added",
          },
        ]
      : commit?.subject === "test(git): cover safe remote synchronization"
        ? [
            {
              path: "crates/asterlyn-git/src/repository.rs",
              originalPath: null,
              status: "modified",
            },
          ]
      : [
          {
            path: "crates/asterlyn-git/src/repository.rs",
            originalPath: null,
            status: "modified",
          },
          {
            path: "src/diff-editor.ts",
            originalPath: null,
            status: "added",
          },
        ];
  return {
    repositoryId: ".",
    oid,
    parentOid: commit?.parents[0] ?? null,
    files,
  };
}

export function demoCommitDiff(oid: string, path: string): CommitDiffResult {
  return {
    repositoryId: ".",
    oid,
    path,
    patch:
      patches[path] ??
      `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old content\n+committed content\n`,
    binary: false,
    truncated: false,
  };
}

export function demoStage(
  snapshot: RepositorySnapshot,
  paths: string[],
): RepositorySnapshot {
  const next = structuredClone(snapshot);
  for (const change of next.changes) {
    if (!paths.includes(change.path)) continue;
    change.indexStatus = stageKind(change.worktreeStatus);
    change.worktreeStatus = "unmodified";
  }
  return next;
}

export function demoUnstage(
  snapshot: RepositorySnapshot,
  paths: string[],
): RepositorySnapshot {
  const next = structuredClone(snapshot);
  for (const change of next.changes) {
    if (!paths.includes(change.path)) continue;
    if (change.worktreeStatus === "unmodified") {
      change.worktreeStatus = unstageKind(change.indexStatus);
    }
    change.indexStatus = "unmodified";
  }
  return next;
}

export function demoTrackedSnapshot(
  snapshot: RepositorySnapshot,
): RepositorySnapshot {
  const next = structuredClone(snapshot);
  next.commits = demoHistoryFromTips(
    snapshot,
    snapshot.branches.map((branch) => branch.oid),
  );
  next.changes = next.changes.filter(
    (change) => change.worktreeStatus !== "untracked",
  );
  next.untrackedState = "pending";
  return next;
}

export function demoCommitHistory(
  snapshot: RepositorySnapshot,
  fullName: string,
): CommitSummary[] {
  const reference = snapshot.branches.find((branch) => branch.fullName === fullName);
  if (!reference) throw new Error("The selected ref no longer exists.");
  return demoHistoryFromOid(snapshot, reference.oid);
}

export function demoQueryHistory(
  snapshot: RepositorySnapshot,
  query: HistoryQuery,
): CommitSummary[] {
  if (query.repositoryIds.length > 0 && !query.repositoryIds.includes(".")) return [];
  if (query.startCommit && query.startCommit.repositoryId !== ".") return [];
  if (query.startCommit && query.refs.length > 0) {
    throw new Error("An exact History start cannot be combined with selected refs.");
  }
  const refs = query.refs.filter((reference) => reference.repositoryId === ".");
  if (query.refs.length > 0 && refs.length === 0) return [];
  const tips = query.startCommit
    ? [query.startCommit.oid]
    : refs.length === 0
      ? snapshot.branches.map((branch) => branch.oid)
      : refs.map(({ fullName }) => {
          const reference = snapshot.branches.find(
            (branch) => branch.fullName === fullName,
          );
          if (!reference) throw new Error("The selected ref no longer exists.");
          return reference.oid;
        });
  let commits = demoHistoryFromTips(snapshot, tips, query.firstParent);
  const authors = new Set(query.authorEmails);
  if (query.currentAuthor) authors.add("developer@example.invalid");
  if (authors.size > 0) {
    commits = commits.filter((commit) => authors.has(commit.authorEmail));
  }
  if (query.sinceEpoch !== null) {
    commits = commits.filter((commit) => commit.authoredAt >= query.sinceEpoch!);
  }
  const paths = query.paths.filter((path) => path.repositoryId === ".");
  if (query.paths.length > 0 && paths.length === 0) return [];
  if (paths.length > 0) {
    commits = commits.filter((commit) =>
      demoCommitDetails(commit.oid).files.some(
        (file) =>
          paths.some(
            (path) =>
              file.path === path.path || file.path.startsWith(`${path.path}/`) ||
              file.originalPath === path.path || file.originalPath?.startsWith(`${path.path}/`),
          ),
      ),
    );
  }
  if (query.excludeMerges) {
    commits = commits.filter((commit) => commit.parents.length < 2);
  }
  if (query.order === "date") {
    commits.sort((left, right) => right.authoredAt - left.authoredAt);
  }
  return commits;
}

function demoHistoryFromOid(
  snapshot: RepositorySnapshot,
  tip: string | null,
): CommitSummary[] {
  return demoHistoryFromTips(snapshot, tip ? [tip] : []);
}

function demoHistoryFromTips(
  snapshot: RepositorySnapshot,
  tips: string[],
  firstParent = false,
): CommitSummary[] {
  const byOid = new Map(snapshot.commits.map((commit) => [commit.oid, commit]));
  const reachable = new Set<string>();
  const pending = [...tips];
  while (pending.length > 0) {
    const oid = pending.pop();
    if (!oid || reachable.has(oid)) continue;
    reachable.add(oid);
    const parents = byOid.get(oid)?.parents ?? [];
    pending.push(...(firstParent ? parents.slice(0, 1) : parents));
  }
  return structuredClone(snapshot.commits.filter((commit) => reachable.has(commit.oid)));
}

export function demoUntrackedScan(
  snapshot: RepositorySnapshot,
): UntrackedScan {
  return {
    root: snapshot.root,
    changes: structuredClone(
      snapshot.changes.filter(
        (change) => change.worktreeStatus === "untracked",
      ),
    ),
  };
}

export function demoSwitchBranch(
  snapshot: RepositorySnapshot,
  targetFullName: string,
): RepositorySnapshot {
  ensureDemoBranchMutationIsSafe(snapshot);
  const next = structuredClone(snapshot);
  const target = next.branches.find(
    (branch) => branch.kind === "local" && branch.fullName === targetFullName,
  );
  if (!target) throw new Error("Select an existing local branch.");
  if (target.current) throw new Error(`${target.name} is already checked out.`);
  for (const branch of next.branches) branch.current = branch === target;
  next.branch = {
    head: target.name,
    oid: target.oid,
    upstream: target.upstream,
    upstreamRemote: target.upstream ? "origin" : null,
    upstreamRef: target.upstream
      ? `refs/heads/${target.upstream.split("/").slice(1).join("/")}`
      : null,
    ahead: 0,
    behind: 0,
    detached: false,
    unborn: false,
  };
  return next;
}

export function demoCreateBranch(
  snapshot: RepositorySnapshot,
  name: string,
): RepositorySnapshot {
  ensureDemoBranchMutationIsSafe(snapshot);
  const normalized = name.trim();
  if (!/^(?![-.])(?!.*\.\.)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(normalized)) {
    throw new Error("Enter a valid literal local branch name.");
  }
  const fullName = `refs/heads/${normalized}`;
  if (snapshot.branches.some((branch) => branch.fullName === fullName)) {
    throw new Error(`${normalized} already exists.`);
  }
  const next = structuredClone(snapshot);
  for (const branch of next.branches) branch.current = false;
  const tip = next.commits[0];
  next.branches.unshift({
    repositoryId: ".",
    fullName,
    name: normalized,
    oid: next.branch.oid ?? tip?.oid ?? "0".repeat(40),
    current: true,
    kind: "local",
    upstream: null,
    tracking: null,
    committedAt: tip?.authoredAt ?? Math.floor(Date.now() / 1000),
    subject: tip?.subject ?? "Unborn branch",
  });
  next.branch = {
    ...next.branch,
    head: normalized,
    upstream: null,
    upstreamRemote: null,
    upstreamRef: null,
    ahead: 0,
    behind: 0,
    detached: false,
  };
  return next;
}

export function demoPrepareBranchMutation(
  snapshot: RepositorySnapshot,
  request: BranchMutationRequest,
): BranchMutationPlan {
  if (!snapshot.branch.head || !snapshot.branch.oid || snapshot.branch.detached || snapshot.branch.unborn) {
    throw new Error("A checked-out local branch with an existing HEAD is required.");
  }
  if (snapshot.operation) throw new Error("Finish the active Git operation first.");
  const branch = snapshot.branches.find((candidate) =>
    candidate.repositoryId === "." && candidate.fullName === request.sourceFullName
  );
  const commit = snapshot.commits.find((candidate) =>
    candidate.repositoryId === "." && candidate.oid === request.sourceOid
  );
  const source = request.kind === "create" && request.sourceFullName === request.sourceOid
    ? {
        kind: "commit" as const,
        name: request.sourceOid.slice(0, 12),
        oid: commit?.oid ?? request.sourceOid,
        upstream: null,
      }
    : branch;
  if (!source || source.oid !== request.sourceOid) {
    throw new Error("The selected branch or commit changed; prepare it again.");
  }
  if (["switch", "rename", "delete"].includes(request.kind) && source.kind !== "local") {
    throw new Error("Select an existing local branch.");
  }
  if (request.kind === "checkoutRemote" && source.kind !== "remote") {
    throw new Error("Select an existing remote-tracking branch.");
  }
  if (source.kind === "tag") {
    throw new Error("Select a local branch, remote branch, or exact commit.");
  }
  if (["switch", "create", "checkoutRemote"].includes(request.kind)) {
    ensureDemoBranchMutationIsSafe(snapshot);
  }
  const startHeadRef = `refs/heads/${snapshot.branch.head}`;
  if (request.kind === "switch" && request.sourceFullName === startHeadRef) {
    throw new Error("The selected branch is already checked out.");
  }
  if (request.kind === "delete" && request.sourceFullName === startHeadRef) {
    throw new Error("The checked-out branch cannot be deleted.");
  }
  let newName: string | null = null;
  let targetFullName: string | null = null;
  if (["create", "checkoutRemote", "rename"].includes(request.kind)) {
    newName = request.newName?.trim() ?? "";
    if (!/^(?![-.])(?!.*\.\.)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(newName)) {
      throw new Error("Enter a valid literal local branch name.");
    }
    targetFullName = `refs/heads/${newName}`;
    if (targetFullName === request.sourceFullName || snapshot.branches.some(
      (candidate) => candidate.fullName === targetFullName,
    )) throw new Error(`${newName} already exists.`);
  }
  const mergedIntoCurrent = request.kind === "delete"
    ? demoHistoryFromOid(snapshot, snapshot.branch.oid).some((candidate) => candidate.oid === source.oid)
    : null;
  if (request.kind === "delete" && !mergedIntoCurrent) {
    throw new Error("Only a branch already merged into the current HEAD can be deleted.");
  }
  if (request.deleteRemote && request.kind !== "delete") {
    throw new Error("Remote deletion is available only while deleting a local branch.");
  }
  const remoteDeletion = request.deleteRemote
    ? demoRemoteDeletionTarget(snapshot, source.upstream)
    : null;
  const fields = [
    request.kind, request.sourceFullName, source.oid, source.kind, newName ?? "", startHeadRef,
    snapshot.branch.oid, source.upstream ?? "", mergedIntoCurrent ? "merged" : "",
    request.deleteRemote ? "delete-remote" : "local-only", remoteDeletion?.remote ?? "",
    remoteDeletion?.branchFullName ?? "", remoteDeletion?.trackingFullName ?? "",
    remoteDeletion?.oid ?? "",
  ];
  return {
    repositoryRoot: snapshot.root,
    kind: request.kind,
    sourceFullName: request.sourceFullName,
    sourceOid: source.oid,
    sourceKind: source.kind,
    sourceName: source.name,
    targetFullName,
    newName,
    startHeadRef,
    startHeadOid: snapshot.branch.oid,
    upstream: source.upstream,
    mergedIntoCurrent,
    deleteRemote: request.deleteRemote,
    remoteDeletion,
    previewToken: JSON.stringify(fields),
  };
}

export function demoExecuteBranchMutation(
  snapshot: RepositorySnapshot,
  plan: BranchMutationPlan,
): RepositorySnapshot {
  const refreshed = demoPrepareBranchMutation(snapshot, {
    kind: plan.kind,
    sourceFullName: plan.sourceFullName,
    sourceOid: plan.sourceOid,
    newName: plan.newName,
    deleteRemote: plan.deleteRemote,
  });
  if (refreshed.previewToken !== plan.previewToken) {
    throw new Error("The reviewed branch plan is stale; prepare it again.");
  }
  if (plan.kind === "switch") return demoSwitchBranch(snapshot, plan.sourceFullName);
  const next = structuredClone(snapshot);
  if (plan.kind === "delete") {
    next.branches = next.branches.filter((branch) => branch.fullName !== plan.sourceFullName);
    if (plan.remoteDeletion) {
      next.branches = next.branches.filter((branch) => (
        branch.fullName !== plan.remoteDeletion?.trackingFullName
      ));
    }
    return next;
  }
  if (plan.kind === "rename") {
    const source = next.branches.find((branch) => branch.fullName === plan.sourceFullName)!;
    source.name = plan.newName!;
    source.fullName = plan.targetFullName!;
    if (source.current) next.branch.head = plan.newName;
    return next;
  }
  for (const branch of next.branches) branch.current = false;
  const commit = next.commits.find((candidate) => candidate.oid === plan.sourceOid);
  const upstream = plan.kind === "checkoutRemote" ? plan.sourceName : null;
  next.branches.unshift({
    repositoryId: ".", fullName: plan.targetFullName!, name: plan.newName!, oid: plan.sourceOid,
    current: true, kind: "local", upstream, tracking: null,
    committedAt: commit?.authoredAt ?? Math.floor(Date.now() / 1000),
    subject: commit?.subject ?? plan.sourceName,
  });
  next.branch = {
    head: plan.newName,
    oid: plan.sourceOid,
    upstream,
    upstreamRemote: upstream?.split("/")[0] ?? null,
    upstreamRef: upstream ? `refs/heads/${upstream.split("/").slice(1).join("/")}` : null,
    ahead: 0,
    behind: 0,
    detached: false,
    unborn: false,
  };
  return next;
}

function demoRemoteDeletionTarget(
  snapshot: RepositorySnapshot,
  upstream: string | null,
): NonNullable<BranchMutationPlan["remoteDeletion"]> {
  const [remote, ...branchParts] = upstream?.split("/") ?? [];
  const branch = branchParts.join("/");
  const trackingFullName = remote && branch ? `refs/remotes/${remote}/${branch}` : "";
  const tracking = snapshot.branches.find((candidate) => (
    candidate.repositoryId === "." && candidate.fullName === trackingFullName
  ));
  if (!remote || !branch || !tracking) {
    throw new Error("The selected local branch has no last-fetched remote upstream to delete.");
  }
  return {
    remote,
    branchFullName: `refs/heads/${branch}`,
    trackingFullName,
    oid: tracking.oid,
  };
}

export function demoFetchRemote(
  snapshot: RepositorySnapshot,
  remoteName: string,
): RepositorySnapshot {
  const remote = snapshot.remotes.find((candidate) => candidate.name === remoteName);
  if (!remote?.fetchSupported) throw new Error("Select a supported remote.");
  return structuredClone(snapshot);
}

export function demoPullCurrent(snapshot: RepositorySnapshot): RepositorySnapshot {
  ensureDemoBranchMutationIsSafe(snapshot);
  if (!snapshot.branch.head || !snapshot.branch.upstreamRemote) {
    throw new Error("The current branch has no supported remote upstream.");
  }
  if (snapshot.operation) throw new Error(`Finish the active ${snapshot.operation} first.`);
  if (snapshot.branch.ahead > 0 && snapshot.branch.behind > 0) {
    throw new Error("The branch has diverged. Merge or rebase explicitly.");
  }
  const next = structuredClone(snapshot);
  next.branch.behind = 0;
  return next;
}

export function demoPushCurrent(
  snapshot: RepositorySnapshot,
  remoteName: string,
): RepositorySnapshot {
  const remote = snapshot.remotes.find((candidate) => candidate.name === remoteName);
  if (!remote?.pushSupported) throw new Error("Select a supported non-mirror remote.");
  if (!snapshot.branch.head || snapshot.branch.unborn || snapshot.branch.detached) {
    throw new Error("A checked-out branch with a commit is required.");
  }
  if (snapshot.operation) throw new Error(`Finish the active ${snapshot.operation} first.`);
  if (snapshot.branch.behind > 0) {
    throw new Error("Fetch and reconcile the branch before pushing.");
  }
  const next = structuredClone(snapshot);
  const branchName = next.branch.head;
  if (!next.branch.upstreamRemote) {
    next.branch.upstream = `${remoteName}/${branchName}`;
    next.branch.upstreamRemote = remoteName;
    next.branch.upstreamRef = `refs/heads/${branchName}`;
    const local = next.branches.find((branch) => branch.current);
    if (local) {
      local.upstream = next.branch.upstream;
      local.tracking = null;
    }
  }
  next.branch.ahead = 0;
  return next;
}

function ensureDemoBranchMutationIsSafe(snapshot: RepositorySnapshot): void {
  if (snapshot.untrackedState !== "complete") {
    throw new Error("Wait for the working-tree scan to finish.");
  }
  if (snapshot.changes.length > 0) {
    throw new Error("Commit, stash, or remove working-tree changes before continuing.");
  }
}

function stageKind(kind: ChangeKind): ChangeKind {
  return kind === "untracked" ? "added" : kind;
}

function unstageKind(kind: ChangeKind): ChangeKind {
  return kind === "added" ? "untracked" : kind;
}
