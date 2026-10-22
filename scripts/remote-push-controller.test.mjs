import assert from "node:assert/strict";
import test from "node:test";

import {
  PUSH_TAGS_ENABLED_KEY,
  PUSH_TAG_MODE_KEY,
  RemotePushController,
  resolveRemoteUpdateActivation,
} from "../src/features/remote-push/remote-push-controller.ts";
import { ZH_CN } from "../src/localization/zh-CN.ts";

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

test("ahead-only Update can still perform a fast-forward safety check", () => {
  const controller = new RemotePushController(createGateway());
  const repository = snapshot();
  repository.branch.ahead = 2;
  repository.branch.behind = 0;
  controller.installSnapshot(repository);

  assert.equal(controller.openDialog("update"), true);
  assert.equal(controller.state.updateStrategy, "ffOnly");
  controller.setUpdateStrategy("merge");
  controller.setUpdateStrategy("ffOnly");
  assert.equal(controller.state.updateStrategy, "ffOnly");
  controller.dispose();
});

test("Update review retains the selected remember choice across strategy rendering", () => {
  const controller = new RemotePushController(createGateway());
  controller.installSnapshot(snapshot());

  assert.equal(controller.openDialog("update", {
    strategy: "merge",
    rememberStrategy: true,
  }), true);
  assert.equal(controller.state.updateStrategy, "merge");
  assert.equal(controller.state.rememberUpdateStrategy, true);
  controller.setUpdateStrategy("rebase");
  assert.equal(controller.state.rememberUpdateStrategy, true);
  controller.setRememberUpdateStrategy(false);
  assert.equal(controller.state.rememberUpdateStrategy, false);
  controller.dispose();
});

test("remembered Update executes only while its strategy is currently available", () => {
  const repository = snapshot();
  assert.deepEqual(resolveRemoteUpdateActivation(repository, {
    askBeforeRemoteUpdate: false,
    preferredRemoteUpdateStrategy: "merge",
  }), { kind: "execute", strategy: "merge" });

  repository.branch.behind = 3;
  assert.deepEqual(resolveRemoteUpdateActivation(repository, {
    askBeforeRemoteUpdate: false,
    preferredRemoteUpdateStrategy: "ffOnly",
  }), { kind: "review", strategy: "merge", rememberStrategy: true });

  repository.branch.ahead = 0;
  assert.deepEqual(resolveRemoteUpdateActivation(repository, {
    askBeforeRemoteUpdate: false,
    preferredRemoteUpdateStrategy: "rebase",
  }), { kind: "review", strategy: "ffOnly", rememberStrategy: true });
});

test("same-root worktree completion makes Update available to the remote controller", () => {
  const controller = new RemotePushController(createGateway());
  const pending = snapshot({ untrackedState: "pending" });
  controller.installSnapshot(pending);

  assert.equal(controller.openDialog("update"), false);

  controller.installSnapshot({ ...pending, untrackedState: "complete" });
  assert.equal(controller.openDialog("update"), true);
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

test("non-current branch Push binds preview and execution to the exact source ref", async () => {
  const calls = [];
  const gateway = createGateway({
    async readPushPreview(...args) {
      calls.push(["preview", ...args]);
      return preview("origin", "topic-token");
    },
    async pushCurrent(...args) {
      calls.push(["push", ...args]);
      return snapshot();
    },
  });
  const controller = new RemotePushController(gateway);
  const repository = snapshot();
  repository.branches = [{
    repositoryId: ".", kind: "local", fullName: "refs/heads/topic", name: "topic",
    oid: "c".repeat(40), current: false, upstream: "origin/topic", tracking: "[ahead 1]",
    upstreamRemote: "origin", upstreamRef: "refs/heads/topic", ahead: 1, behind: 0,
    committedAt: 1, subject: "Topic", primaryWorktreePath: null, linkedWorktreePath: null,
  }];
  controller.installSnapshot(repository);

  assert.equal(controller.openBranchPush("refs/heads/topic", "origin"), true);
  await settle();
  assert.equal(controller.state.sourceBranch, "refs/heads/topic");
  assert.equal(calls[0].at(-1), "refs/heads/topic");
  const result = await controller.runOperation("push");
  assert.equal(result.status, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].at(-1), "refs/heads/topic");
  controller.closeDialog();
  assert.equal(controller.state.sourceBranch, null);
  controller.dispose();
});

test("Push selects an outgoing submodule and keeps preview and execution repository-scoped", async () => {
  const calls = [];
  const repository = snapshot({
    repositoryRoots: [
      { id: ".", relativePath: ".", displayName: "repo", kind: "main" },
      { id: "modules/lib", relativePath: "modules/lib", displayName: "lib", kind: "submodule" },
    ],
    branch: { ahead: 0 },
    branches: [{
      repositoryId: "modules/lib", kind: "local", fullName: "refs/heads/topic", name: "topic",
      oid: "c".repeat(40), current: true, upstream: "origin/topic", tracking: "[ahead 1]",
      upstreamRemote: "origin", upstreamRef: "refs/heads/topic", ahead: 1, behind: 0,
      committedAt: 1, subject: "Topic", primaryWorktreePath: null, linkedWorktreePath: null,
    }],
    remotes: [
      { repositoryId: ".", name: "origin", fetchSupported: true, pushSupported: true },
      { repositoryId: "modules/lib", name: "origin", fetchSupported: true, pushSupported: true },
    ],
  });
  const gateway = createGateway({
    async readPushPreview(_root, repositoryId, remote) {
      calls.push(["preview", repositoryId, remote]);
      return {
        ...preview(remote, `${repositoryId}-token`), repositoryId, branch: repositoryId === "." ? "main" : "topic",
        commits: preview(remote, "unused").commits.map((entry) => ({ ...entry, repositoryId })),
      };
    },
    async pushCurrent(_root, repositoryId, remote) {
      calls.push(["push", repositoryId, remote]);
      return repository;
    },
  });
  const controller = new RemotePushController(gateway);
  controller.installSnapshot(repository);

  assert.equal(controller.openDialog("push"), true);
  await settle();
  assert.equal(controller.state.pushRepositoryId, "modules/lib");
  assert.deepEqual(calls[0], ["preview", "modules/lib", "origin"]);
  assert.equal(controller.state.pushPreview?.repositoryId, "modules/lib");
  const { renderRemoteDialogContent } = await import("../src/features/remote-push/remote-push-view.ts");
  const html = renderRemoteDialogContent({ snapshot: repository, state: controller.state });
  assert.match(html, /data-push-repository-id="\."/u);
  assert.match(html, /class="push-repository-option selected"[^>]*data-push-repository-id="modules\/lib"/u);
  assert.match(html, />lib<\/strong><small>topic<\/small>/u);
  assert.equal((await controller.runOperation("push")).status, "success");
  assert.deepEqual(calls[1], ["push", "modules/lib", "origin"]);

  controller.closeDialog();
  controller.dispose();
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

test("Push mode menu closes explicitly and cannot open for an empty preview", async () => {
  const emptyPreview = {
    ...preview("origin", "empty"),
    headOid: "same",
    comparisonBaseOid: "same",
    commits: [],
    files: [],
    totalCommits: 0,
  };
  const controller = new RemotePushController(createGateway({
    previewResponses: [Promise.resolve(emptyPreview)],
  }));
  controller.installSnapshot(snapshot());
  controller.openDialog("push");
  await settle();

  controller.togglePushModeMenu();
  assert.equal(controller.state.pushModeMenuOpen, false);

  controller.state.pushPreview = preview("origin", "outgoing");
  controller.togglePushModeMenu();
  assert.equal(controller.state.pushModeMenuOpen, true);
  assert.equal(controller.closePushModeMenu(), true);
  assert.equal(controller.state.pushModeMenuOpen, false);
  assert.equal(controller.closePushModeMenu(), false);
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
  const firstDiff = deferred();
  const gateway = createGateway({
    previewResponses: [Promise.resolve(preview("origin", "token"))],
    readCommitComparisonDiff(_root, repositoryId, beforeOid, afterOid, path) {
      return path === "one.txt"
        ? firstDiff.promise
        : Promise.resolve(comparisonDiff(repositoryId, beforeOid, afterOid, path));
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
  firstDiff.resolve(comparisonDiff(".", "b".repeat(40), "a".repeat(40), "one.txt"));
  await first;
  assert.equal(controller.state.pushDiff?.file.path, "two.txt");
  assert.equal(controller.state.pushFileActionLoading, false);
});

test("expanding omitted Push Diff context requests the complete patch", async () => {
  const requested = [];
  const controller = new RemotePushController(createGateway({
    previewResponses: [Promise.resolve(preview("origin", "token"))],
    async readCommitComparisonDiff(
      _root,
      _repositoryId,
      _beforeOid,
      _afterOid,
      _path,
      _originalPath,
      expandedUnchanged,
    ) {
      requested.push(expandedUnchanged);
      return comparisonDiff(".", "b".repeat(40), "a".repeat(40), "one.txt");
    },
  }));
  controller.installSnapshot(snapshot());
  controller.openDialog("push");
  await settle();

  controller.selectPushFile("one.txt");
  await controller.openSelectedPushFileDiff();
  assert.equal(controller.state.pushDiff?.expandedUnchanged, false);
  await controller.togglePushDiffUnchangedLines();
  assert.equal(controller.state.pushDiff?.expandedUnchanged, true);
  assert.deepEqual(requested, [false, true]);
  controller.dispose();
});

test("aggregate Push Diff compares the reviewed destination and head for a remote-only path", async () => {
  const calls = [];
  const reviewed = {
    ...preview("origin", "diverged-token"),
    ordinaryAllowed: false,
    files: [file("remote-only.txt")],
    commits: [commit("local-only")],
    totalCommits: 1,
  };
  const controller = new RemotePushController(createGateway({
    previewResponses: [Promise.resolve(reviewed)],
    async readPushFileCommit() {
      throw new Error("aggregate range inspection must not require a containing outgoing commit");
    },
    async readCommitComparisonDiff(
      root,
      repositoryId,
      beforeOid,
      afterOid,
      path,
      originalPath,
      expandedUnchanged,
    ) {
      calls.push({ root, repositoryId, beforeOid, afterOid, path, originalPath, expandedUnchanged });
      return comparisonDiff(repositoryId, beforeOid, afterOid, path);
    },
  }));
  controller.installSnapshot(snapshot({ branch: { ahead: 1, behind: 1 } }));
  controller.openDialog("push");
  await settle();

  controller.selectPushFile("remote-only.txt");
  await controller.openSelectedPushFileDiff();

  assert.deepEqual(calls, [{
    root: "/repo",
    repositoryId: ".",
    beforeOid: reviewed.comparisonBaseOid,
    afterOid: reviewed.headOid,
    path: "remote-only.txt",
    originalPath: null,
    expandedUnchanged: false,
  }]);
  assert.equal(controller.state.pushDiff?.comparison, true);
  assert.equal(controller.state.pushDiff?.parentOid, reviewed.comparisonBaseOid);
  assert.equal(controller.state.pushDiff?.oid, reviewed.headOid);
  assert.equal(controller.state.pushDiff?.error, null);
  assert.equal(controller.state.pushDiff?.patch?.path, "remote-only.txt");
  controller.dispose();
});

test("a selected outgoing commit still opens that commit Diff", async () => {
  let commitDiffReads = 0;
  let comparisonDiffReads = 0;
  const controller = new RemotePushController(createGateway({
    previewResponses: [Promise.resolve(preview("origin", "token"))],
    async readCommitDiff(_root, repositoryId, oid, path) {
      commitDiffReads += 1;
      return { repositoryId, oid, path, patch: "@@ -1 +1 @@\n-a\n+b", binary: false, truncated: false };
    },
    async readCommitComparisonDiff() {
      comparisonDiffReads += 1;
      throw new Error("selected commit must not open an aggregate comparison");
    },
  }));
  controller.installSnapshot(snapshot());
  controller.openDialog("push");
  await settle();

  await controller.selectPushCommit("one");
  controller.selectPushFile("one.txt");
  await controller.openSelectedPushFileDiff();

  assert.equal(commitDiffReads, 1);
  assert.equal(comparisonDiffReads, 0);
  assert.equal(controller.state.pushDiff?.comparison, false);
  assert.equal(controller.state.pushDiff?.oid, "one");
  controller.dispose();
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

test("automatic Fetch is identified as background work while manual Fetch remains interactive", async () => {
  const firstFetch = deferred();
  const secondFetch = deferred();
  let calls = 0;
  const controller = new RemotePushController(createGateway({
    fetchRemote() { return ++calls === 1 ? firstFetch.promise : secondFetch.promise; },
  }));
  controller.installSnapshot(snapshot());

  const automatic = controller.runOperation("fetch", true);
  assert.equal(controller.state.operation?.background, true);
  firstFetch.resolve(snapshot());
  assert.equal((await automatic).status, "success");
  assert.equal(controller.state.operation, null);

  const manual = controller.runOperation("fetch");
  assert.equal(controller.state.operation?.background, false);
  secondFetch.resolve(snapshot());
  assert.equal((await manual).status, "success");
  controller.dispose();
});

test("structured remote failures retain their localized actionable reason in the dialog", async () => {
  const remoteError = {
    kind: "remoteFailed",
    operation: "push",
    remote: "origin",
    reason: "authentication",
  };
  const gateway = createGateway({
    previewResponses: [Promise.resolve(preview("origin", "token"))],
    async pushCurrent() {
      throw remoteError;
    },
  });
  const controller = new RemotePushController(gateway, {
    messages: ZH_CN.remote,
    errorMessages: ZH_CN.errors,
  });
  controller.installSnapshot(snapshot());
  controller.openDialog("push");
  await settle();

  const result = await controller.runOperation("push");

  assert.deepEqual(result, { status: "failure", error: remoteError });
  assert.equal(controller.state.dialogError?.summary, ZH_CN.remote.unexpectedError);
  assert.equal(controller.state.dialogError?.detail, ZH_CN.errors.authenticationFailed);
  assert.notEqual(controller.state.dialogError?.detail, ZH_CN.remote.unexpectedError);
});

test("tag collisions identify the failed tag and can exclude tags without retrying Push", async () => {
  const remoteError = {
    kind: "remoteFailed",
    operation: "push",
    remote: "origin",
    reason: "rejected",
    refFailures: [
      { refKind: "branch", refName: "main", reason: "atomicPushFailed", primary: false },
      { refKind: "tag", refName: "release-1", reason: "alreadyExists", primary: true },
    ],
  };
  let pushCalls = 0;
  const controller = new RemotePushController(createGateway({
    previewResponses: [
      Promise.resolve(preview("origin", "without-tags")),
      Promise.resolve(preview("origin", "with-tags", "all")),
      Promise.resolve(preview("origin", "recovered")),
    ],
    async pushCurrent() {
      pushCalls += 1;
      throw remoteError;
    },
  }), {
    messages: ZH_CN.remote,
    errorMessages: ZH_CN.errors,
  });
  controller.installSnapshot(snapshot());
  controller.openDialog("push");
  await settle();
  controller.setPushTagsEnabled(true);
  await settle();

  const result = await controller.runOperation("push");

  assert.deepEqual(result, { status: "failure", error: remoteError });
  assert.equal(pushCalls, 1);
  assert.equal(controller.state.dialogError?.summary, "无法推送标签");
  assert.match(controller.state.dialogError?.detail ?? "", /origin.*release-1/);
  assert.match(controller.state.dialogError?.guidance ?? "", /原子推送/);
  assert.deepEqual(controller.state.dialogError?.recovery, {
    kind: "excludePushTags",
    label: "排除标签并重新审查",
  });

  controller.setPushTagsEnabled(false);
  await settle();
  assert.equal(controller.state.pushTagsEnabled, false);
  assert.equal(controller.state.dialogError, null);
  assert.equal(controller.state.pushPreview?.previewToken, "recovered");
  assert.equal(pushCalls, 1);
  controller.dispose();
});

test("Push scroll paging appends once, blocks duplicates, and exposes an inline retry", async () => {
  const failure = deferred();
  const calls = [];
  const first = {
    ...preview("origin", "paging-token"),
    totalCommits: 4,
    hasMore: true,
  };
  const finalPage = {
    ...preview("origin", "paging-token"),
    commits: [commit("three"), commit("four")],
    offset: 2,
    totalCommits: 4,
    hasMore: false,
  };
  const responses = [Promise.resolve(first), failure.promise, Promise.resolve(finalPage)];
  const controller = new RemotePushController(createGateway({
    readPushPreview(...args) {
      calls.push({ offset: args[4], pageSize: args[5] });
      const response = responses.shift();
      if (!response) throw new Error("unexpected preview read");
      return response;
    },
  }));
  const changes = [];
  controller.subscribe((change) => changes.push(change));
  const repository = snapshot();
  controller.installSnapshot(repository);
  controller.openDialog("push");
  await settle();

  const failedPage = controller.loadMorePushPreview();
  assert.equal(controller.state.pushPreviewLoadingMore, true);
  assert.deepEqual(changes.at(-1), { reason: "preview-page-start" });
  void controller.loadMorePushPreview();
  assert.equal(calls.length, 2);

  failure.reject(new Error("page failed"));
  await failedPage;
  assert.equal(controller.state.pushPreviewLoadingMore, false);
  assert.equal(controller.state.pushPreviewPagingError?.detail, "page failed");
  assert.equal(changes.at(-1)?.reason, "preview-page-error");

  const { renderRemoteDialogContent } = await import("../src/features/remote-push/remote-push-view.ts");
  const failedHtml = renderRemoteDialogContent({ snapshot: repository, state: controller.state });
  assert.doesNotMatch(failedHtml, /id="push-load-more"/u);
  assert.match(failedHtml, /id="push-commit-page-retry"/u);

  await controller.loadMorePushPreview();
  assert.deepEqual(calls.map((call) => call.offset), [0, 2, 2]);
  assert.deepEqual(
    controller.state.pushPreview?.commits.map((entry) => entry.oid),
    ["one", "two", "three", "four"],
  );
  assert.equal(controller.state.pushPreview?.hasMore, false);
  assert.equal(controller.state.pushPreviewPagingError, null);
  assert.equal(changes.at(-1)?.reason, "preview-page-complete");
  controller.dispose();
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
    async readPushFileCommit(_root, _repositoryId, _remote, _tagMode, _token, path) {
      return details(path, path);
    },
    async readCommitDiff(_root, repositoryId, oid, path) {
      return { repositoryId, oid, path, patch: `diff --git a/${path} b/${path}`, binary: false, truncated: false };
    },
    async readCommitComparisonDiff(_root, repositoryId, beforeOid, afterOid, path) {
      return comparisonDiff(repositoryId, beforeOid, afterOid, path);
    },
    async readCommitImageDiff(_root, _repositoryId, _oid, path) {
      return { path, before: null, after: null };
    },
    async readCommitComparisonImageDiff(_root, _repositoryId, _beforeOid, _afterOid, path) {
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

function comparisonDiff(repositoryId, beforeOid, afterOid, path) {
  return {
    repositoryId,
    beforeOid,
    afterOid,
    path,
    patch: `diff --git a/${path} b/${path}`,
    binary: false,
    truncated: false,
  };
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

test("push tags enabled and mode are remembered in storage across dialog reset and controller restarts", async () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };

  const gateway = createGateway();
  const controller = new RemotePushController(gateway, { storage });
  controller.installSnapshot(snapshot());

  assert.equal(controller.state.pushTagsEnabled, false);
  assert.equal(controller.state.pushTagMode, "all");

  assert.equal(controller.openDialog("push"), true);
  await settle();

  controller.setPushTagsEnabled(true);
  controller.setPushTagMode("currentBranch");
  await settle();

  assert.equal(controller.state.pushTagsEnabled, true);
  assert.equal(controller.state.pushTagMode, "currentBranch");
  assert.equal(store.get(PUSH_TAGS_ENABLED_KEY), "true");
  assert.equal(store.get(PUSH_TAG_MODE_KEY), "currentBranch");

  assert.equal(controller.closeDialog(), true);
  assert.equal(controller.state.pushTagsEnabled, true);
  assert.equal(controller.state.pushTagMode, "currentBranch");

  assert.equal(controller.openDialog("push"), true);
  await settle();
  assert.equal(controller.state.pushTagsEnabled, true);
  assert.equal(controller.state.pushTagMode, "currentBranch");
  controller.dispose();

  const newController = new RemotePushController(gateway, { storage });
  newController.installSnapshot(snapshot());
  assert.equal(newController.state.pushTagsEnabled, true);
  assert.equal(newController.state.pushTagMode, "currentBranch");

  assert.equal(newController.openDialog("push"), true);
  await settle();
  assert.equal(newController.state.pushTagsEnabled, true);
  assert.equal(newController.state.pushTagMode, "currentBranch");

  newController.setPushTagsEnabled(false);
  assert.equal(store.get(PUSH_TAGS_ENABLED_KEY), "false");
  newController.dispose();
});

test("selecting destination branch reloads push preview and forwards to push", async () => {
  const previewCalls = [];
  const pushCalls = [];
  const gateway = createGateway({
    previewResponses: [
      Promise.resolve(preview("origin", "t1")),
      Promise.resolve(preview("origin", "t2")),
      Promise.resolve(preview("origin", "t3")),
    ],
    readPushPreview(_root, _repositoryId, remote, tagMode, _offset, _pageSize, destinationBranch) {
      previewCalls.push({ remote, tagMode, destinationBranch });
      return gateway.previewResponses.shift();
    },
    pushCurrent(_root, _repositoryId, remote, mode, tagMode, _token, _opId, destinationBranch) {
      pushCalls.push({ remote, mode, tagMode, destinationBranch });
      return Promise.resolve(snapshot());
    },
  });
  gateway.previewResponses = [
    Promise.resolve(preview("origin", "t1")),
    Promise.resolve(preview("origin", "t2")),
    Promise.resolve(preview("origin", "t3")),
  ];

  const controller = new RemotePushController(gateway);
  controller.installSnapshot(snapshot());

  assert.equal(controller.openDialog("push"), true);
  await settle();
  assert.equal(controller.state.destinationBranch, null);
  assert.equal(previewCalls.length, 1);
  assert.equal(previewCalls[0].destinationBranch, "main");

  assert.equal(controller.setDestinationBranch("new-feature"), true);
  await settle();
  assert.equal(controller.state.destinationBranch, "new-feature");
  assert.equal(previewCalls.length, 2);
  assert.equal(previewCalls[1].destinationBranch, "new-feature");

  await controller.runOperation("push");
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].destinationBranch, "new-feature");

  controller.dispose();
});

test("custom branch mode validates branch name and handles custom branch push", async () => {
  const previewCalls = [];
  const pushCalls = [];
  const gateway = createGateway({
    previewResponses: [
      Promise.resolve(preview("origin", "p1")),
      Promise.resolve(preview("origin", "p2")),
    ],
    readPushPreview(_root, _repositoryId, remote, tagMode, _offset, _pageSize, destinationBranch) {
      previewCalls.push({ remote, destinationBranch });
      return gateway.previewResponses.shift();
    },
    pushCurrent(_root, _repositoryId, remote, mode, tagMode, _token, _opId, destinationBranch) {
      pushCalls.push({ remote, destinationBranch });
      return Promise.resolve(snapshot());
    },
  });
  gateway.previewResponses = [
    Promise.resolve(preview("origin", "p1")),
    Promise.resolve(preview("origin", "p2")),
  ];

  const controller = new RemotePushController(gateway);
  controller.installSnapshot(snapshot());
  assert.equal(controller.openDialog("push"), true);
  await settle();

  // Enable custom branch
  assert.equal(controller.enableCustomBranch("feature/user-custom"), true);
  assert.equal(controller.state.pushCustomBranch, true);
  assert.equal(controller.state.pushCustomBranchInput, "feature/user-custom");

  // Invalid branch name should cause push operation to be unavailable
  controller.setCustomBranchInput("invalid branch name..");
  assert.equal(controller.state.pushCustomBranchInput, "invalid branch name..");
  const result = await controller.runOperation("push");
  assert.equal(result.status, "unavailable");
  assert.equal(pushCalls.length, 0);

  // Valid branch name triggers preview reload and allows push
  controller.setCustomBranchInput("feature/valid-name");
  await new Promise((r) => setTimeout(r, 200)); // wait for debounce
  await settle();
  assert.equal(previewCalls[previewCalls.length - 1].destinationBranch, "feature/valid-name");

  await controller.runOperation("push");
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].destinationBranch, "feature/valid-name");

  // Disabling custom branch reverts mode
  assert.equal(controller.disableCustomBranch(), true);
  assert.equal(controller.state.pushCustomBranch, false);

  controller.dispose();
});

test("push dialog consumes backend-filtered remote branches and includes __new__", async () => {
  const { renderRemoteDialogContent } = await import("../src/features/remote-push/remote-push-view.ts");
  const repo = snapshot({
    branches: [
      { name: "main", fullName: "refs/heads/main", kind: "local" },
      { name: "origin/feature-x", fullName: "refs/remotes/origin/feature-x", kind: "remote" },
    ],
  });
  const gateway = createGateway();
  const controller = new RemotePushController(gateway);
  controller.installSnapshot(repo);
  controller.openDialog("push");

  const html = renderRemoteDialogContent({
    snapshot: repo,
    state: controller.state,
    activeTab: "push",
  });

  const branchSelectMatch = html.match(/<select id="push-branch-select"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(branchSelectMatch);
  const branchOptionsHtml = branchSelectMatch[1];

  // Verify __new__ option exists with editable branch metadata
  assert.match(branchOptionsHtml, /<option value="__new__"[^>]*data-editable="branch"/);
  assert.match(branchOptionsHtml, /data-placeholder=/);
  assert.match(branchOptionsHtml, /data-error=/);
  // Verify feature-x is present
  assert.match(branchOptionsHtml, /<option value="feature-x"/);
  // New destinations keep the standalone badge without duplicating "New" in the option label.
  assert.match(branchOptionsHtml, /<option value="main" selected>main<\/option>/);
  assert.doesNotMatch(branchOptionsHtml, /main \(New\)/);
  assert.match(html, /class="push-branch-control" data-selected-value="main"/);
  assert.match(html, /id="push-branch-select"[^>]*title="main"/);
  assert.match(html, /class="push-branch-badge new">New<\/span>/);
  controller.dispose();
});
