import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectFilesOperationController,
  destinationDirectory,
  validateWorkspaceEntryName,
} from "../src/features/files-editor/project-files-operation-controller.ts";

const messages = {
  invalidName: "invalid name", unsafeSource: "unsafe source", sourceChanged: "source changed",
  destinationExists: "destination exists", operationFailed: "failed", copied: "copied", cut: "cut",
  created: "created", stagedCreated: "staged", leftCreatedUntracked: "left untracked",
  stageCreatedFailed: "stage failed", renamed: "renamed", pasted: "pasted", trashed: "trashed",
};

function target(overrides = {}) {
  return {
    workspaceRoot: "/workspace", workspaceGeneration: 4, workspacePath: "src/app.ts",
    kind: "file", file: { repositoryId: ".", path: "src/app.ts", workspacePath: "src/app.ts" },
    status: "unmodified", readOnly: false, ...overrides,
  };
}

function inspection(path = "src/app.ts", kind = "file", fingerprint = "fingerprint") {
  return {
    source: { workspacePath: path, kind, revision: "revision", mode: 420, byteLength: 4 },
    entryCount: 1, totalBytes: 4, hiddenEntryCount: 0, symlinkPaths: [],
    nestedRepositoryPaths: [], multipleLinkPaths: [], truncated: false, fingerprint,
  };
}

function preview(planId, operation, source = null, fingerprint = null) {
  return {
    planId, operation, collisionPolicy: "cancel", source, entryCount: source ? 1 : 0,
    totalBytes: source?.byteLength ?? 0, hiddenEntryCount: 0, fingerprint, blockers: [],
  };
}

function outcome(planId, operation) {
  const destination = "destination" in operation ? operation.destination : null;
  return {
    planId, status: "completed", affectedPaths: destination ? [destination] : [operation.source],
    pathRemaps: operation.kind === "move" ? [{ source: operation.source, destination }] : [],
    invalidatedSlices: ["workspaceCatalog", "openDocuments", "workingTree"],
    recoveryId: null, error: null,
  };
}

function fixture({ stagePreference = "ask", canStage = true, stageFails = false } = {}) {
  const records = {
    plans: [], executions: [], completed: [], status: [], errors: [], remembered: [], staged: [],
    cancels: 0,
  };
  let nextPlan = null;
  const mutations = {
    plan(identity, operation, collisionPolicy, editorRequest = null) {
      records.plans.push({ identity, operation, collisionPolicy, editorRequest });
      const planId = `plan-${records.plans.length}`;
      const result = nextPlan ?? {
        status: "ready",
        preview: preview(planId, operation, operation.kind === "createFile" ? null : inspection(operation.source).source,
          operation.kind === "createFile" ? null : "fingerprint"),
      };
      nextPlan = null;
      return { planId, completion: Promise.resolve(result) };
    },
    async execute(_identity, planId) {
      const operation = records.plans.at(-1).operation;
      records.executions.push(planId);
      return { status: "completed", outcome: outcome(planId, operation) };
    },
    cancel() { records.cancels += 1; },
  };
  const runtime = {
    currentIdentity: () => ({ root: "/workspace", generation: 4 }),
    isTargetCurrent: (candidate) => candidate.workspaceGeneration === 4,
    repositoryLocation: (path) => ({ repositoryId: ".", path }),
    canStageCreatedFile: () => canStage,
    newFileStageBehavior: () => stagePreference,
    rememberNewFileStageBehavior: (behavior) => records.remembered.push(behavior),
    stageCreatedFile: async (path) => {
      records.staged.push(path);
      if (stageFails) throw new Error("git add failed");
    },
    completed: (...args) => records.completed.push(args),
    status: (message) => records.status.push(message),
    error: (error) => records.errors.push(error instanceof Error ? error.message : String(error)),
  };
  const controller = new ProjectFilesOperationController(
    { inspectWorkspaceEntry: async (_root, path) => inspection(path) },
    mutations,
    runtime,
    () => messages,
    { busy: () => false, async request(candidate) { records.trashTarget = candidate; } },
  );
  return { controller, records, setNextPlan: (value) => { nextPlan = value; } };
}

test("entry names and target directories stay within one parent", () => {
  assert.equal(validateWorkspaceEntryName("new file.ts"), "new file.ts");
  for (const value of ["", ".", "..", "a/b", "a\\b", "a\0b"]) {
    assert.equal(validateWorkspaceEntryName(value), null);
  }
  assert.equal(destinationDirectory(target()), "src");
  assert.equal(destinationDirectory(target({ workspacePath: "src", kind: "directory", file: null })), "src");
});

test("create and rename use reviewed coordinator plans", async () => {
  const created = fixture();
  assert.equal(created.controller.beginCreate(target()), true);
  created.controller.updateInlineValue("new.ts");
  await created.controller.submitInline();
  assert.deepEqual(created.records.plans[0].operation, { kind: "createFile", destination: "src/new.ts" });
  assert.equal(created.records.completed[0][0], "create");

  const renamed = fixture();
  renamed.controller.beginRename(target());
  renamed.controller.updateInlineValue("renamed.ts");
  await renamed.controller.submitInline();
  assert.deepEqual(renamed.records.plans[0].operation, {
    kind: "move", source: "src/app.ts", destination: "src/renamed.ts",
  });
  assert.equal(renamed.records.plans[0].editorRequest.kind, "move");
});

test("create blur cancels an empty name and submits a non-empty name", async () => {
  const empty = fixture();
  empty.controller.beginCreate(target());
  await empty.controller.blurInline("   ");
  assert.equal(empty.controller.state.inlineEdit, null);
  assert.deepEqual(empty.records.plans, []);

  const named = fixture();
  named.controller.beginCreate(target());
  await named.controller.blurInline("notes.txt");
  assert.deepEqual(named.records.plans[0].operation, {
    kind: "createFile", destination: "src/notes.txt",
  });
  assert.equal(named.controller.state.inlineEdit, null);
});

test("new Git files stay untracked until the staging choice is explicit", async () => {
  const prompted = fixture();
  prompted.controller.beginCreate(target());
  prompted.controller.updateInlineValue("prompted.txt");
  await prompted.controller.submitInline();
  assert.equal(prompted.controller.state.dialog.kind, "stage-created");
  assert.equal(prompted.controller.state.dialog.remember, false);
  assert.deepEqual(prompted.records.staged, []);

  prompted.controller.updateStageCreatedRemember(true);
  await prompted.controller.resolveCreatedFileStaging(false);
  assert.deepEqual(prompted.records.remembered, ["leaveUntracked"]);
  assert.deepEqual(prompted.records.staged, []);
  assert.equal(prompted.controller.state.dialog, null);

  const staged = fixture();
  staged.controller.beginCreate(target());
  staged.controller.updateInlineValue("staged.txt");
  await staged.controller.submitInline();
  staged.controller.updateStageCreatedRemember(true);
  await staged.controller.resolveCreatedFileStaging(true);
  assert.deepEqual(staged.records.staged, ["src/staged.txt"]);
  assert.deepEqual(staged.records.remembered, ["stage"]);
  assert.equal(staged.controller.state.dialog, null);
});

test("remembered staging behavior skips the prompt without staging ordinary folders", async () => {
  const automatic = fixture({ stagePreference: "stage" });
  automatic.controller.beginCreate(target());
  automatic.controller.updateInlineValue("automatic.txt");
  await automatic.controller.submitInline();
  assert.deepEqual(automatic.records.staged, ["src/automatic.txt"]);
  assert.equal(automatic.controller.state.dialog, null);

  const ordinary = fixture({ stagePreference: "stage", canStage: false });
  ordinary.controller.beginCreate(target());
  ordinary.controller.updateInlineValue("ordinary.txt");
  await ordinary.controller.submitInline();
  assert.deepEqual(ordinary.records.staged, []);
  assert.equal(ordinary.controller.state.dialog, null);
});

test("failed staging keeps the file and prompt without remembering an automatic write", async () => {
  const failed = fixture({ stageFails: true });
  failed.controller.beginCreate(target());
  failed.controller.updateInlineValue("still-untracked.txt");
  await failed.controller.submitInline();
  failed.controller.updateStageCreatedRemember(true);
  await failed.controller.resolveCreatedFileStaging(true);

  assert.equal(failed.records.completed.length, 1, "file creation already completed");
  assert.deepEqual(failed.records.staged, ["src/still-untracked.txt"]);
  assert.deepEqual(failed.records.remembered, []);
  assert.equal(failed.controller.state.dialog.kind, "stage-created");
  assert.equal(failed.controller.state.dialog.error, "stage failed");
});

test("copy/paste binds the plan to the captured recursive fingerprint", async () => {
  const { controller, records } = fixture();
  await controller.capture("copy", target());
  await controller.paste(target({ workspacePath: "dest", kind: "directory", file: null }));
  assert.deepEqual(records.plans[0].operation, {
    kind: "copy", source: "src/app.ts", destination: "dest/app.ts",
  });
  assert.deepEqual(records.executions, ["plan-1"]);
  assert.equal(records.status.at(-1), "pasted");
});

test("destination collision requests a new name and changed source cancels safely", async () => {
  const collision = fixture();
  await collision.controller.capture("copy", target());
  collision.setNextPlan({
    status: "blocked", source: "workspace",
    preview: preview("plan-1", { kind: "copy", source: "src/app.ts", destination: "dest/app.ts" }),
    reason: "destinationExists",
  });
  await collision.controller.paste(target({ workspacePath: "dest", kind: "directory", file: null }));
  assert.equal(collision.controller.state.dialog.kind, "paste-name");
  assert.equal(collision.controller.state.dialog.error, "destination exists");

  const changed = fixture();
  await changed.controller.capture("copy", target());
  changed.setNextPlan({
    status: "ready",
    preview: preview("plan-1", { kind: "copy", source: "src/app.ts", destination: "dest/app.ts" },
      inspection().source, "different"),
  });
  await changed.controller.paste(target({ workspacePath: "dest", kind: "directory", file: null }));
  assert.equal(changed.records.cancels, 1);
  assert.deepEqual(changed.records.executions, []);
  assert.equal(changed.records.errors.at(-1), "source changed");
});

test("trash delegates the exact current target to the shared reviewed workflow", async () => {
  const { controller, records } = fixture();
  await controller.requestTrash(target());
  assert.equal(records.trashTarget.workspacePath, "src/app.ts");
  assert.deepEqual(records.executions, []);
});

test("a plan is cancelled and local busy state is cleared when the workspace changes", async () => {
  let resolvePlan;
  let identity = { root: "/workspace", generation: 4 };
  let cancels = 0;
  const controller = new ProjectFilesOperationController(
    { inspectWorkspaceEntry: async (_root, path) => inspection(path) },
    {
      plan() {
        return {
          planId: "stale-plan",
          completion: new Promise((resolve) => { resolvePlan = resolve; }),
        };
      },
      async execute() { throw new Error("stale plans must not execute"); },
      cancel() { cancels += 1; },
    },
    {
      currentIdentity: () => identity,
      isTargetCurrent: (candidate) => candidate.workspaceGeneration === identity.generation,
      repositoryLocation: (path) => ({ repositoryId: ".", path }),
      canStageCreatedFile: () => false,
      newFileStageBehavior: () => "ask",
      rememberNewFileStageBehavior() {},
      async stageCreatedFile() {},
      completed() {}, status() {}, error() {},
    },
    () => messages,
    { busy: () => false, async request() {} },
  );
  controller.beginCreate(target());
  controller.updateInlineValue("new.ts");
  const pending = controller.submitInline();
  identity = { root: "/other", generation: 5 };
  resolvePlan({ status: "cancelled" });

  await pending;

  assert.equal(cancels, 1);
  assert.equal(controller.state.inlineEdit, null);
  assert.equal(controller.busy, false);
});
