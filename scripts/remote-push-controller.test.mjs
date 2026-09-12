import assert from "node:assert/strict";
import test from "node:test";

import { RemotePushController } from "../src/features/remote-push/remote-push-controller.ts";

test("diverged Update defaults to Merge and rejects unavailable fast-forward selection", () => {
  const controller = new RemotePushController(createGateway());
  const repository = snapshot();
  repository.branch.ahead = 2;
  repository.branch.behind = 3;
  controller.installSnapshot(repository);

  assert.equal(controller.openDialog("update"), true);
  assert.equal(controller.state.updateStrategy, "merge");
  controller.setUpdateStrategy("ffOnly");
  assert.equal(controller.state.updateStrategy, "merge");
  controller.setUpdateStrategy("rebase");
  assert.equal(controller.state.updateStrategy, "rebase");
  controller.dispose();
});

test("latest remote preview owns completion after a remote switch", async () => {
  const origin = deferred();
  const team = deferred();
  const gateway = createGateway({ previewResponses: [origin.promise, team.promise] });
  const controller = new RemotePushController(gateway);
  controller.installSnapshot(snapshot());

  assert.equal(controller.openDialog("push"), true);
  assert.equal(controller.selectRemote("team"), true);
  origin.resolve(preview("origin", "origin-token"));
  await settle();
  assert.equal(controller.state.pushPreview, null);

  team.resolve(preview("team", "team-token"));
  await settle();
  assert.equal(controller.state.pushPreview?.remote, "team");
  assert.equal(controller.state.pushPreview?.previewToken, "team-token");
});

test("tag refresh preserves reviewed content and replaces it atomically", async () => {
  const refresh = deferred();
  const gateway = createGateway({
    previewResponses: [
      Promise.resolve(preview("origin", "without-tags")),
      refresh.promise,
    ],
  });
  const controller = new RemotePushController(gateway);
  const changes = [];
  controller.subscribe((change) => changes.push(change));
  controller.installSnapshot(snapshot());
  controller.openDialog("push");
  await settle();

  controller.setPushTagsEnabled(true);
  assert.equal(controller.state.pushPreview?.previewToken, "without-tags");
  assert.equal(controller.state.pushPreviewRefreshing, true);
  assert.equal(changes.at(-1)?.preserveDialogDom, true);

  refresh.resolve(preview("origin", "with-tags", "all"));
  await settle();
  assert.equal(controller.state.pushPreview?.previewToken, "with-tags");
  assert.equal(controller.state.pushPreview?.tagMode, "all");
  assert.equal(controller.state.pushPreviewRefreshing, false);
});

test("commit details are cached and stale selections cannot replace the review", async () => {
  const late = deferred();
  const calls = [];
  const gateway = createGateway({
    previewResponses: [Promise.resolve(preview("origin", "token"))],
    readCommitDetails(_root, _repositoryId, oid) {
      calls.push(oid);
      return oid === "one" ? Promise.resolve(details("one", "one.txt")) : late.promise;
    },
  });
  const controller = new RemotePushController(gateway);
  controller.installSnapshot(snapshot());
  controller.openDialog("push");
  await settle();

  await controller.selectPushCommit("one");
  assert.equal(controller.state.pushCommitDetails?.oid, "one");
  const pending = controller.selectPushCommit("two");
  await controller.selectPushCommit("one");
  late.resolve(details("two", "two.txt"));
  await pending;
  assert.equal(controller.state.pushCommitDetails?.oid, "one");
  assert.deepEqual(calls, ["one", "two"]);
});

test("switching files invalidates an older push Diff request", async () => {
  const firstCommit = deferred();
  const gateway = createGateway({
    previewResponses: [Promise.resolve(preview("origin", "token"))],
    readPushFileCommit(_root, _remote, _tagMode, _token, path) {
      return path === "one.txt"
        ? firstCommit.promise
        : Promise.resolve(details("two", "two.txt"));
    },
  });
  const controller = new RemotePushController(gateway);
  controller.installSnapshot(snapshot());
  controller.openDialog("push");
  await settle();

  controller.selectPushFile("one.txt");
  const first = controller.openSelectedPushFileDiff();
  controller.selectPushFile("two.txt");
  await controller.openSelectedPushFileDiff();
  assert.equal(controller.state.pushDiff?.file.path, "two.txt");
  firstCommit.resolve(details("one", "one.txt"));
  await first;
  assert.equal(controller.state.pushDiff?.file.path, "two.txt");
  assert.equal(controller.state.pushFileActionLoading, false);
});

test("operation ownership rejects completions after repository replacement", async () => {
  const fetch = deferred();
  const gateway = createGateway({ fetchResponse: fetch.promise });
  const controller = new RemotePushController(gateway);
  controller.installSnapshot(snapshot());
  const operation = controller.runOperation("fetch");
  assert.equal(controller.state.operation?.kind, "fetch");

  controller.installSnapshot(snapshot({ root: "/other", gitDir: "/other/.git" }));
  fetch.resolve(snapshot({ branch: { ahead: 2 } }));
  assert.deepEqual(await operation, { status: "stale" });
  assert.equal(controller.state.operation, null);
});

function createGateway(overrides = {}) {
  const previewResponses = overrides.previewResponses ?? [];
  let previewIndex = 0;
  return {
    readPushPreview() {
      const response = previewResponses[previewIndex++];
      if (!response) throw new Error("unexpected preview read");
      return response;
    },
    async readCommitDetails(_root, _repositoryId, oid) {
      return details(oid, `${oid}.txt`);
    },
    async readPushFileCommit(_root, _remote, _tagMode, _token, path) {
      return details(path, path);
    },
    async readCommitDiff(_root, repositoryId, oid, path) {
      return { repositoryId, oid, path, patch: `diff --git a/${path} b/${path}`, binary: false, truncated: false };
    },
    async readCommitImageDiff(_root, _repositoryId, _oid, path) {
      return { path, before: null, after: null };
    },
    fetchRemote() {
      return overrides.fetchResponse ?? Promise.resolve(snapshot());
    },
    async pullCurrent() {
      return snapshot();
    },
    async pushCurrent() {
      return snapshot();
    },
    async cancelRemoteOperation() {},
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  const { branch: branchOverrides = {}, ...rest } = overrides;
  return {
    root: "/repo",
    gitDir: "/repo/.git",
    repositoryRoots: [{ id: ".", path: ".", displayName: "repo" }],
    branch: {
      head: "main",
      oid: "a".repeat(40),
      upstream: "origin/main",
      upstreamRemote: "origin",
      upstreamRef: "refs/heads/main",
      ahead: 2,
      behind: 0,
      detached: false,
      unborn: false,
      ...branchOverrides,
    },
    operation: null,
    changes: [],
    commits: [],
    branches: [],
    remotes: [
      { name: "origin", fetchSupported: true, pushSupported: true },
      { name: "team", fetchSupported: true, pushSupported: true },
    ],
    untrackedState: "complete",
    ...rest,
  };
}

function preview(remote, previewToken, tagMode = "none") {
  return {
    remote,
    branch: "main",
    sourceRef: "refs/heads/main",
    destinationRef: "refs/heads/main",
    headOid: "a".repeat(40),
    comparisonBaseOid: "b".repeat(40),
    publish: false,
    ordinaryAllowed: true,
    ordinaryBlockReason: null,
    forceWithLeaseAllowed: true,
    forceWithLeaseBlockReason: null,
    tagMode,
    tags: [],
    files: [file("one.txt"), file("two.txt")],
    filesTruncated: false,
    commits: [commit("one"), commit("two")],
    offset: 0,
    totalCommits: 2,
    hasMore: false,
    truncated: false,
    previewToken,
  };
}

function commit(oid) {
  return {
    repositoryId: ".",
    oid,
    shortOid: oid,
    parents: [],
    authorName: "Test",
    authorEmail: "test@example.invalid",
    authoredAt: 1,
    decorations: [],
    subject: oid,
  };
}

function details(oid, path) {
  return { repositoryId: ".", oid, parentOid: null, files: [file(path)] };
}

function file(path) {
  return { path, originalPath: null, status: "modified" };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
