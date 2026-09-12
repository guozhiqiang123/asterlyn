import assert from "node:assert/strict";
import test from "node:test";

import {
  GitHistoryDetailsController,
} from "../src/features/git-history/history-details-controller.ts";
import { defaultHistoryQuery } from "../src/workbench/history-query.ts";
import { commitKey } from "../src/workbench/history-identity.ts";

test("latest history query owns completion and rejects stale responses", async () => {
  const first = deferred();
  const second = deferred();
  const gateway = gatewayWithHistory([first.promise, second.promise]);
  const controller = createController(gateway);
  const query = defaultHistoryQuery();

  controller.loadQuery("/workspace", {
    ...query,
    refs: [{ repositoryId: ".", fullName: "refs/heads/first" }],
  });
  controller.loadQuery("/workspace", {
    ...query,
    refs: [{ repositoryId: ".", fullName: "refs/heads/second" }],
  });

  first.resolve(page([commit("stale")], 0, false));
  await settle();
  assert.equal(controller.state.history.status, "loading");
  assert.deepEqual(controller.state.history.commits, []);

  second.resolve(page([commit("second")], 0, false));
  await settle();
  assert.equal(controller.state.history.status, "ready");
  assert.deepEqual(controller.state.history.commits.map(({ oid }) => oid), ["second"]);
  assert.equal(controller.state.selectedCommit, commitKey(commit("second")));
});

test("paging preserves selection and refresh drops details only when selection disappears", async () => {
  const historyResponses = [
    Promise.resolve(page([commit("b"), commit("c")], 2, false)),
    Promise.resolve(page([commit("new"), commit("a"), commit("b"), commit("c")], 0, false)),
    Promise.resolve(page([commit("replacement")], 0, false)),
  ];
  const gateway = gatewayWithHistory(historyResponses);
  const controller = createController(gateway);
  const query = defaultHistoryQuery();
  controller.installSnapshot("/workspace", [commit("a"), commit("b")], query, true);
  assert.equal(controller.state.hasMore, true);
  const selected = controller.state.selectedCommit;

  await controller.loadOlder();
  assert.deepEqual(controller.state.history.commits.map(({ oid }) => oid), ["a", "b", "c"]);
  assert.equal(controller.state.selectedCommit, selected);

  await controller.refreshLoaded();
  assert.equal(controller.state.selectedCommit, selected);

  await controller.refreshLoaded();
  assert.equal(controller.state.selectedCommit, commitKey(commit("replacement")));
  assert.equal(controller.state.details, null);
  assert.equal(controller.state.selectedFile, null);
});

test("commit detail cache avoids native reads and late detail responses are ignored", async () => {
  const detailB = deferred();
  const detailCalls = [];
  const gateway = {
    async readHistoryPage() {
      throw new Error("history not expected");
    },
    readCommitDetails(root, repositoryId, oid) {
      detailCalls.push({ root, repositoryId, oid });
      return oid === "a" ? Promise.resolve(details("a", ["a.txt"])) : detailB.promise;
    },
  };
  const controller = createController(gateway);
  controller.installSnapshot(
    "/workspace",
    [commit("a"), commit("b")],
    defaultHistoryQuery(),
    true,
  );

  controller.ensureSelectedDetails("/workspace");
  await settle();
  assert.equal(controller.state.details?.oid, "a");
  controller.selectCommit("/workspace", commitKey(commit("b")), true);
  controller.selectCommit("/workspace", commitKey(commit("a")), true);
  detailB.resolve(details("b", ["b.txt"]));
  await settle();
  assert.equal(controller.state.details?.oid, "a");
  assert.equal(controller.state.selectedFile, "a.txt");
  assert.equal(detailCalls.length, 2);
});

test("dispose invalidates requests and removes listeners", async () => {
  const response = deferred();
  const controller = createController(gatewayWithHistory([response.promise]));
  let changes = 0;
  controller.subscribe(() => changes += 1);
  controller.loadQuery("/workspace", defaultHistoryQuery());
  assert.equal(changes, 1);
  controller.dispose();
  response.resolve(page([commit("late")], 0, false));
  await settle();
  assert.equal(changes, 1);
  assert.equal(controller.state.history.status, "loading");
});

test("scroll boundaries append older commits and refresh the loaded window", async () => {
  let now = 1_000;
  const gateway = gatewayWithHistory([
    Promise.resolve(page([commit("c")], 2, false)),
    Promise.resolve(page([commit("new"), commit("a"), commit("b"), commit("c")], 0, false)),
  ]);
  const controller = new GitHistoryDetailsController(gateway, {
    pageSize: 2,
    rowLimit: 10,
    now: () => now,
  });
  controller.installSnapshot(
    "/workspace",
    [commit("a"), commit("b")],
    defaultHistoryQuery(),
    true,
  );

  controller.handleScroll({ scrollTop: 200, scrollHeight: 300, clientHeight: 100 });
  await settle();
  assert.deepEqual(controller.state.history.commits.map(({ oid }) => oid), ["a", "b", "c"]);

  now = 2_000;
  controller.handleScroll({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 });
  await settle();
  assert.deepEqual(controller.state.history.commits.map(({ oid }) => oid), [
    "new",
    "a",
    "b",
    "c",
  ]);
});

function createController(gateway) {
  return new GitHistoryDetailsController(gateway, {
    pageSize: 2,
    rowLimit: 10,
    detailsCacheLimit: 4,
  });
}

function gatewayWithHistory(responses) {
  let index = 0;
  return {
    readHistoryPage() {
      const response = responses[index++];
      if (!response) throw new Error("unexpected history request");
      return response;
    },
    async readCommitDetails(_root, _repositoryId, oid) {
      return details(oid, []);
    },
  };
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
}

function page(commits, offset, hasMore) {
  return { commits, offset, hasMore };
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

function details(oid, files) {
  return {
    ...commit(oid),
    parentOid: null,
    files: files.map((path) => ({ path, originalPath: null, status: "modified" })),
  };
}
