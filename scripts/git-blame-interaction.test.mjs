import assert from "node:assert/strict";
import test from "node:test";

import {
  GIT_BLAME_TOGGLE_ACTION,
  gitBlameContextSession,
} from "../src/features/files-editor/editor-gutter-context-actions.ts";
import { gitBlameHistoryTarget } from "../src/features/files-editor/git-blame-history-navigation.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("line-number Git Blame action reports state and invokes only the current target", async () => {
  let toggles = 0;
  const state = {
    active: false,
    loading: false,
    enabled: true,
    unavailableReason: null,
    copy: EN_US.editor,
    isCurrent: () => true,
    toggle: () => { toggles += 1; },
    blocked() {},
    restoreFocus() {},
  };
  const session = gitBlameContextSession("fixture", state);
  assert.equal(session.model.items[0].actionId, GIT_BLAME_TOGGLE_ACTION);
  assert.equal(session.model.items[0].checked, false);
  assert.equal(session.model.items[0].label, EN_US.editor.annotateGitBlame);
  await session.invoke(GIT_BLAME_TOGGLE_ACTION);
  assert.equal(toggles, 1);

  const stale = gitBlameContextSession("fixture", { ...state, isCurrent: () => false });
  await stale.invoke(GIT_BLAME_TOGGLE_ACTION);
  assert.equal(toggles, 1);
});

test("clickable Git Blame metadata scopes History to the exact repository commit", () => {
  const source = {
    repositoryRoot: "/repo",
    repositoryId: "vendor/library",
    path: "src/Feature.kt",
    commitOid: null,
    parent: false,
  };
  const oid = "0123456789abcdef0123456789abcdef01234567";
  const target = gitBlameHistoryTarget(source, oid, {
    root: "/repo",
    repositoryRoots: [{ id: "vendor/library" }],
  }, 7);
  assert.deepEqual(target, {
    intent: {
      workspaceRoot: "/repo",
      workspaceGeneration: 7,
      query: {
        repositoryIds: ["vendor/library"],
        refs: [],
        startCommit: { repositoryId: "vendor/library", oid },
        authorEmails: [],
        currentAuthor: false,
        sinceEpoch: null,
        paths: [],
        firstParent: false,
        excludeMerges: false,
        order: "topological",
      },
    },
    commitKey: `vendor%2Flibrary:${oid}`,
  });
  assert.equal(gitBlameHistoryTarget(source, "not-an-oid", {
    root: "/repo",
    repositoryRoots: [{ id: "vendor/library" }],
  }, 7), null);
});
