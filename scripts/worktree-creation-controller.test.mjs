import assert from "node:assert/strict";
import test from "node:test";

import {
  WorktreeCreationController,
  worktreeDestination,
} from "../src/features/git-history/worktree-creation-controller.ts";

const branch = (name, oidValue) => ({
  repositoryId: ".",
  kind: "local",
  fullName: `refs/heads/${name}`,
  name,
  current: name === "main",
  upstream: null,
  tracking: null,
  oid: oidValue.repeat(40),
  subject: name,
  committedAt: 1,
  primaryWorktreePath: name === "main" ? "/projects/app" : null,
  linkedWorktreePath: null,
});
const remoteBranch = (name, oidValue) => ({
  ...branch(name, oidValue),
  kind: "remote",
  fullName: `refs/remotes/${name}`,
  current: false,
  primaryWorktreePath: null,
});

test("new worktree dialog derives Android Studio-style defaults and executes an exact plan", async () => {
  const requests = [];
  const executed = [];
  const main = branch("main", "a");
  const topic = branch("feature/topic", "b");
  const controller = new WorktreeCreationController({
    chooseDirectory: async () => ({ kind: "selected", path: "/worktrees" }),
    prepare: async (root, request) => {
      requests.push([root, structuredClone(request)]);
      return {
        repositoryRoot: root,
        sourceFullName: request.sourceFullName,
        sourceName: "feature/topic",
        sourceOid: request.sourceOid,
        parentDirectory: request.parentDirectory,
        projectName: request.projectName,
        destinationPath: `${request.parentDirectory}/${request.projectName}`,
        newBranch: request.newBranch,
        startHeadRef: "refs/heads/main",
        startHeadOid: main.oid,
        previewToken: "reviewed",
      };
    },
    execute: async (plan) => { executed.push(plan); return true; },
    errorMessage: String,
  });

  controller.open("/projects/app", [main, topic], topic);
  assert.equal(controller.state.dialog.parentDirectory, "/projects");
  assert.equal(controller.state.dialog.projectName, "app-topic");
  assert.equal(worktreeDestination("/projects", "app-topic"), "/projects/app-topic");
  await controller.chooseDirectory();
  controller.updateNewBranchEnabled(true);
  controller.updateNewBranch("feature/review");
  controller.updateProjectName("review-project");
  await controller.submit();

  assert.deepEqual(requests, [["/projects/app", {
    sourceFullName: topic.fullName,
    sourceOid: topic.oid,
    parentDirectory: "/worktrees",
    projectName: "review-project",
    newBranch: "feature/review",
  }]]);
  assert.equal(executed[0].destinationPath, "/worktrees/review-project");
  assert.equal(controller.state.dialog, null);
});

test("folder cancellation preserves location and required new branch is validated before prepare", async () => {
  let prepared = 0;
  const main = branch("main", "a");
  const controller = new WorktreeCreationController({
    chooseDirectory: async () => ({ kind: "cancelled" }),
    prepare: async () => { prepared += 1; throw new Error("unexpected"); },
    execute: async () => false,
    errorMessage: (error) => String(error),
  });
  controller.open("/projects/app", [main], main);
  await controller.chooseDirectory();
  assert.equal(controller.state.dialog.parentDirectory, "/projects");
  controller.updateNewBranchEnabled(true);
  await controller.submit();
  assert.equal(controller.state.dialog.error, "branch-name-required");
  assert.equal(prepared, 0);
});

test("remote-tracking branches are exact selectable worktree sources", async () => {
  const requests = [];
  const main = branch("main", "a");
  const remote = remoteBranch("origin/topic", "d");
  const controller = new WorktreeCreationController({
    chooseDirectory: async () => ({ kind: "cancelled" }),
    prepare: async (root, request) => {
      requests.push([root, structuredClone(request)]);
      return {
        repositoryRoot: root,
        sourceFullName: request.sourceFullName,
        sourceName: remote.name,
        sourceOid: request.sourceOid,
        parentDirectory: request.parentDirectory,
        projectName: request.projectName,
        destinationPath: `${request.parentDirectory}/${request.projectName}`,
        newBranch: request.newBranch,
        startHeadRef: "refs/heads/main",
        startHeadOid: main.oid,
        previewToken: "reviewed-remote",
      };
    },
    execute: async () => true,
    errorMessage: String,
  });

  controller.open("/projects/app", [main, remote], remote);
  assert.equal(controller.state.dialog.sourceFullName, remote.fullName);
  assert.deepEqual(
    controller.state.dialog.branches.map((candidate) => candidate.fullName),
    [main.fullName, remote.fullName],
  );
  assert.equal(controller.state.dialog.projectName, "app-topic");
  controller.updateNewBranchEnabled(true);
  controller.updateNewBranch("topic-worktree");
  await controller.submit();
  assert.equal(requests[0][1].sourceFullName, remote.fullName);
  assert.equal(requests[0][1].newBranch, "topic-worktree");
});

test("default project names use the primary checkout name and stay compact", () => {
  const primary = branch("main", "a");
  primary.primaryWorktreePath = "/projects/asterlyn";
  const source = branch("codex/delete-worktree-action", "b");
  const controller = new WorktreeCreationController({
    chooseDirectory: async () => ({ kind: "cancelled" }),
    prepare: async () => { throw new Error("unexpected"); },
    execute: async () => false,
    errorMessage: String,
  });

  controller.open(
    "/projects/asterlyn-github-update-settings",
    [primary, source],
    source,
  );
  assert.equal(controller.state.dialog.projectName, "asterlyn-delete-worktree-action");

  const longSource = branch(`codex/${"long-feature-name-".repeat(5)}`, "c");
  controller.open(
    `/projects/${"long-primary-repository-".repeat(4)}`,
    [longSource],
    longSource,
  );
  assert.equal(Array.from(controller.state.dialog.projectName).length, 64);
  assert.match(controller.state.dialog.projectName, /^long-primary-repository-/u);
});
