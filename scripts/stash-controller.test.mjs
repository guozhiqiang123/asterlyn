import assert from "node:assert/strict";
import test from "node:test";

import { StashController, stashDomKey, stashKey } from "../src/features/git-stash/stash-controller.ts";
import { renderStashDetails, renderStashList } from "../src/features/git-stash/stash-view.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { DEFAULT_LOCALIZATION } from "../src/localization/localization.ts";

test("stash catalog preserves an exact selected object across reference renumbering", async () => {
  const catalogs = [
    catalog([entry("stash@{0}", "a", "first"), entry("stash@{1}", "b", "second")]),
    catalog([entry("stash@{0}", "c", "new"), entry("stash@{1}", "a", "first"), entry("stash@{2}", "b", "second")]),
  ];
  const controller = new StashController(gateway({ catalogs }));
  await controller.load("/repo", false);
  await controller.ensureSelectedDetails(controller.state.entries[1]);
  assert.equal(controller.state.selectedKey, stashKey(entry("stash@{1}", "b", "second")));

  await controller.load("/repo", true);
  assert.equal(controller.selectedEntry().oid, oid("b"));
  assert.equal(controller.selectedEntry().reference, "stash@{2}");
});

test("stale detail and patch completions cannot replace the latest stash selection", async () => {
  const firstDetails = deferred();
  const firstPatch = deferred();
  let detailsCalls = 0;
  let patchCalls = 0;
  const entries = [entry("stash@{0}", "a", "first"), entry("stash@{1}", "b", "second")];
  const controller = new StashController(gateway({
    catalogs: [catalog(entries)],
    readStashDetails(_root, _repositoryId, stashOid) {
      detailsCalls += 1;
      return detailsCalls === 1 ? firstDetails.promise : Promise.resolve(details(stashOid, "b.txt"));
    },
    readStashDiff(_root, repositoryId, stashOid, path) {
      patchCalls += 1;
      return patchCalls === 1 ? firstPatch.promise : Promise.resolve(diff(repositoryId, stashOid, path));
    },
  }));
  const loading = controller.load("/repo", false);
  controller.select(entries[1]);
  firstDetails.resolve(details(entries[0].oid, "a.txt"));
  await loading;
  await controller.ensureSelectedDetails(entries[1]);
  assert.equal(controller.state.details.oid, entries[1].oid);

  controller.selectFile("b.txt");
  const patch = controller.loadSelectedDiff();
  controller.select(entries[0]);
  firstPatch.resolve(diff(".", entries[1].oid, "b.txt"));
  await patch;
  assert.equal(controller.state.patch, null);
});

test("stash views expose list identity, changed files, and direct Apply/Pop actions", async () => {
  const controller = new StashController(gateway({ catalogs: [catalog([entry("stash@{0}", "a", "work")])] }));
  await controller.load("/repo", false);
  const list = renderStashList(controller.state, EN_US.stash, "en-US");
  const detail = renderStashDetails(controller.state, EN_US.stash, DEFAULT_LOCALIZATION);
  assert.match(list, new RegExp(`data-stash-key="${stashDomKey(controller.state.entries[0])}"`));
  assert.doesNotMatch(list, /\u0000/);
  assert.match(list, /stash@\{0\}/);
  assert.match(detail, /id="stash-file-view-toggle"/);
  assert.match(detail, /data-stash-file-directory="\."/);
  assert.match(detail, /data-stash-file="src\/app.ts"/);
  assert.match(detail, /data-stash-action="apply"/);
  assert.match(detail, /data-stash-action="pop"/);

  controller.toggleFileView();
  const flatDetail = renderStashDetails(controller.state, EN_US.stash, DEFAULT_LOCALIZATION);
  assert.match(flatDetail, /commit-file-list compact-file-tree flat/);
  assert.doesNotMatch(flatDetail, /data-stash-file-directory=/);
});

test("stash file tree tracks collapsed folders independently from the selected file", async () => {
  const controller = new StashController(gateway({
    catalogs: [catalog([entry("stash@{0}", "a", "work")])],
    readStashDetails: (_root, _repositoryId, stashOid) => Promise.resolve(detailsWithFiles(stashOid, [
      "src/features/app.ts", "src/features/view.ts", "README.md",
    ])),
  }));
  await controller.load("/repo", false);
  controller.setDirectoryExpanded("src/features", false);
  assert.equal(controller.state.collapsedDirectories.has("src/features"), true);
  assert.match(renderStashDetails(controller.state, EN_US.stash, DEFAULT_LOCALIZATION), /data-stash-file-directory="src\/features"[^>]*data-stash-file-rendered-expanded="false"/);
  controller.expandDirectories();
  assert.equal(controller.state.collapsedDirectories.size, 0);
});

test("flat stash files sort by file name instead of directory path", async () => {
  const controller = new StashController(gateway({
    catalogs: [catalog([entry("stash@{0}", "a", "work")])],
    readStashDetails: (_root, _repositoryId, stashOid) => Promise.resolve(detailsWithFiles(stashOid, [
      "aardvark/zeta.ts", "zebra/alpha.ts",
    ])),
  }));
  await controller.load("/repo", false);
  controller.toggleFileView();

  const html = renderStashDetails(controller.state, EN_US.stash, DEFAULT_LOCALIZATION);
  assert.ok(html.indexOf('data-stash-file="zebra/alpha.ts"') < html.indexOf('data-stash-file="aardvark/zeta.ts"'));
});

function gateway(overrides = {}) {
  const catalogs = [...(overrides.catalogs ?? [catalog([])])];
  return {
    readStashCatalog() { return Promise.resolve(catalogs.shift() ?? catalog([])); },
    readStashDetails: overrides.readStashDetails ?? ((_root, _repositoryId, stashOid) => Promise.resolve(details(stashOid, "src/app.ts"))),
    readStashDiff: overrides.readStashDiff ?? ((_root, repositoryId, stashOid, path) => Promise.resolve(diff(repositoryId, stashOid, path))),
  };
}

function catalog(entries) { return { entries, truncatedRepositoryIds: [] }; }
function entry(reference, seed, subject) {
  return { repositoryId: ".", reference, oid: oid(seed), parentOid: oid("p"), authoredAt: 1_700_000_000, subject };
}
function details(stashOid, path) {
  return { repositoryId: ".", oid: stashOid, parentOid: oid("p"), files: [{ path, originalPath: null, status: "modified" }] };
}
function detailsWithFiles(stashOid, paths) {
  return { repositoryId: ".", oid: stashOid, parentOid: oid("p"), files: paths.map((path) => ({ path, originalPath: null, status: "modified" })) };
}
function diff(repositoryId, stashOid, path) {
  return { repositoryId, oid: stashOid, path, patch: "@@ -1 +1 @@", binary: false, truncated: false };
}
function oid(seed) { return seed.repeat(40).slice(0, 40); }
function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}
