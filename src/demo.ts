import type {
  ChangeKind,
  DiffResult,
  RepositorySnapshot,
  UntrackedScan,
} from "./models";

export const demoSnapshot: RepositorySnapshot = {
  root: "/workspace/asterlyn",
  gitDir: "/workspace/asterlyn/.git",
  branch: {
    head: "feature/git-workbench",
    oid: "df535785471311c9cdd936ff023d7d65dafb74a3",
    upstream: "origin/feature/git-workbench",
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
      oid: "df535785471311c9cdd936ff023d7d65dafb74a3",
      shortOid: "df53578",
      parents: ["54978419e233f8b5f53c55197e2742a3440ef894"],
      authorName: "Guozhiqiang",
      authorEmail: "developer@example.invalid",
      authoredAt: 1788839400,
      decorations: ["HEAD -> feature/git-workbench"],
      subject: "feat(git): add tested repository core",
    },
    {
      oid: "54978419e233f8b5f53c55197e2742a3440ef894",
      shortOid: "5497841",
      parents: [],
      authorName: "Guozhiqiang",
      authorEmail: "developer@example.invalid",
      authoredAt: 1788837600,
      decorations: ["main"],
      subject: "docs: establish Asterlyn roadmap and architecture",
    },
  ],
  branches: [
    {
      fullName: "refs/heads/feature/git-workbench",
      name: "feature/git-workbench",
      oid: "df535785471311c9cdd936ff023d7d65dafb74a3",
      current: true,
      kind: "local",
      upstream: "origin/feature/git-workbench",
      tracking: "[ahead 2]",
      committedAt: 1788839400,
      subject: "feat(git): add tested repository core",
    },
    {
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
  next.changes = next.changes.filter(
    (change) => change.worktreeStatus !== "untracked",
  );
  next.untrackedState = "pending";
  return next;
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

function stageKind(kind: ChangeKind): ChangeKind {
  return kind === "untracked" ? "added" : kind;
}

function unstageKind(kind: ChangeKind): ChangeKind {
  return kind === "added" ? "untracked" : kind;
}
