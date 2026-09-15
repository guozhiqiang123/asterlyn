import assert from "node:assert/strict";
import test from "node:test";

import {
  TEXT_TAB_LIMIT,
  activatePreview,
  applyEditorPathMutation,
  beginTextReload,
  beginTextSave,
  closeTextTab,
  completeTextLoad,
  completeTextSave,
  createEditorSession,
  dirtyTextTabs,
  failTextSave,
  markTextEdited,
  openTextDocument,
  prepareEditorPathMutation,
  reconcileExternalTextSnapshot,
  setTextTabMarkdownMode,
} from "../src/workbench/editor-session.ts";

function document(path) {
  return {
    kind: "project-file",
    repositoryRoot: "/repo",
    repositoryId: ".",
    path,
    workspacePath: path,
  };
}

function loaded(session, path) {
  const opened = openTextDocument(session, document(path));
  return completeTextLoad(opened.session, opened.tabId, opened.loadEpoch, {
    workspacePath: path,
    content: `${path}\n`,
    utf8Bom: false,
    revision: `revision-${path}`,
    byteLength: path.length + 1,
  });
}

test("text tabs deduplicate while one diff preview is replaced", () => {
  let session = loaded(createEditorSession(), "one.ts");
  const reopened = openTextDocument(session, document("one.ts"));
  assert.equal(reopened.session.textTabs.length, 1);
  assert.equal(reopened.needsLoad, false);

  session = activatePreview(reopened.session, {
    kind: "working-diff",
    repositoryRoot: "/repo",
    selection: { path: "one.ts", staged: false },
  });
  session = activatePreview(session, {
    kind: "commit-diff",
    repositoryRoot: "/repo",
    repositoryId: ".",
    oid: "a".repeat(40),
    path: "two.ts",
  });
  assert.equal(session.textTabs.length, 1);
  assert.equal(session.preview.kind, "commit-diff");
});

test("Markdown presentation mode belongs to one text tab", () => {
  let session = loaded(createEditorSession(), "README.md");
  session = loaded(session, "notes.md");
  const firstId = session.textTabs[0].id;

  session = setTextTabMarkdownMode(session, firstId, "split");
  assert.equal(session.textTabs[0].markdownMode, "split");
  assert.equal(session.textTabs[1].markdownMode, "source");

  const unchanged = setTextTabMarkdownMode(session, firstId, "split");
  assert.equal(unchanged, session);
});

test("a new Markdown tab accepts its restored presentation mode", () => {
  const opened = openTextDocument(
    createEditorSession(),
    document("README.md"),
    "preview",
  );
  assert.equal(opened.session.textTabs[0].markdownMode, "preview");
});

test("read-only project files cannot become dirty or start a save", () => {
  const readOnly = { ...document("ignored.txt"), readOnly: true };
  const opened = openTextDocument(createEditorSession(), readOnly);
  const session = completeTextLoad(opened.session, opened.tabId, opened.loadEpoch, {
    workspacePath: "ignored.txt",
    content: "ignored\n",
    utf8Bom: false,
    revision: "ignored-revision",
    byteLength: 8,
  });

  const edited = markTextEdited(session, opened.tabId, "changed\n");
  const saving = beginTextSave(edited, opened.tabId, "changed\n", "save-ignored");
  assert.equal(edited, session);
  assert.equal(saving.session, session);
  assert.equal(saving.request, null);
  assert.deepEqual(dirtyTextTabs(session), []);
});

test("stale loads and saves cannot replace newer tab state", () => {
  const opened = openTextDocument(createEditorSession(), document("one.ts"));
  const stale = completeTextLoad(opened.session, opened.tabId, 0, {
    workspacePath: "one.ts",
    content: "stale",
    utf8Bom: false,
    revision: "stale",
    byteLength: 5,
  });
  assert.equal(stale.textTabs[0].status, "loading");

  let session = completeTextLoad(opened.session, opened.tabId, opened.loadEpoch, {
    workspacePath: "one.ts",
    content: "ready",
    utf8Bom: false,
    revision: "one",
    byteLength: 5,
  });
  session = markTextEdited(session, opened.tabId, "edited");
  const saving = beginTextSave(session, opened.tabId, "edited", "save-1");
  session = completeTextSave(saving.session, opened.tabId, {
    workspacePath: "one.ts",
    revision: "ignored",
    byteLength: 6,
    requestId: "other-save",
    alreadySaved: false,
  });
  assert.equal(session.textTabs[0].saveRequest.id, "save-1");
});

test("a repository-session replacement drops an old-root load completion", () => {
  const old = openTextDocument(createEditorSession(), document("one.ts"));
  const replacement = createEditorSession();
  const completed = completeTextLoad(replacement, old.tabId, old.loadEpoch, {
    workspacePath: "one.ts",
    content: "old root",
    utf8Bom: false,
    revision: "old",
    byteLength: 8,
  });
  assert.equal(completed, replacement);
  assert.equal(completed.textTabs.length, 0);
});

test("a clean tab can start a fresh guarded reload but dirty or saving tabs cannot", () => {
  let session = loaded(createEditorSession(), "one.ts");
  const tabId = session.textTabs[0].id;
  const reloading = beginTextReload(session, tabId);
  assert.equal(reloading.loadEpoch, 2);
  assert.equal(reloading.session.textTabs[0].status, "loading");

  session = markTextEdited(session, tabId, "edited");
  assert.equal(beginTextReload(session, tabId).loadEpoch, null);

  const saving = beginTextSave(session, tabId, "edited", "save-1");
  assert.equal(beginTextReload(saving.session, tabId).loadEpoch, null);
});

test("a move lease remaps folder descendants without replacing editor state", () => {
  let session = loaded(createEditorSession(), "src/a.ts");
  session = loaded(session, "src/nested/b.ts");
  session = markTextEdited(session, session.textTabs[0].id, "unsaved");
  session = activatePreview(session, {
    kind: "project-image",
    repositoryRoot: "/repo",
    repositoryId: ".",
    path: "src/logo.png",
    workspacePath: "src/logo.png",
  });
  const request = {
    kind: "move",
    mapping: {
      sourceWorkspacePath: "src",
      destinationWorkspacePath: "lib",
      sourceRepositoryId: ".",
      destinationRepositoryId: ".",
      sourcePath: "src",
      destinationPath: "lib",
    },
  };
  const prepared = prepareEditorPathMutation(session, request);
  assert.equal(prepared.status, "ready");
  const result = applyEditorPathMutation(session, prepared.lease);

  assert.equal(result.status, "applied");
  assert.deepEqual(result.session.textTabs.map((tab) => tab.document.workspacePath), [
    "lib/a.ts",
    "lib/nested/b.ts",
  ]);
  assert.equal(result.session.textTabs[0].content, "unsaved");
  assert.equal(result.session.preview.workspacePath, "lib/logo.png");
  assert.deepEqual(result.remaps.map((remap) => remap.destinationPath), [
    "lib/a.ts",
    "lib/nested/b.ts",
  ]);
});

test("path leases block saves, destination collisions, and dirty deletion", () => {
  let session = loaded(createEditorSession(), "a.ts");
  session = loaded(session, "b.ts");
  const first = session.textTabs[0];
  const collision = prepareEditorPathMutation(session, {
    kind: "move",
    mapping: {
      sourceWorkspacePath: "a.ts",
      destinationWorkspacePath: "b.ts",
      sourceRepositoryId: ".",
      destinationRepositoryId: ".",
      sourcePath: "a.ts",
      destinationPath: "b.ts",
    },
  });
  assert.deepEqual(collision, { status: "blocked", reason: "destinationOpen" });

  session = markTextEdited(session, first.id, "dirty");
  assert.deepEqual(
    prepareEditorPathMutation(session, { kind: "trash", sourceWorkspacePath: "a.ts" }),
    { status: "blocked", reason: "dirtyDelete" },
  );
  const saving = beginTextSave(session, first.id, "dirty", "save-before-move");
  assert.deepEqual(
    prepareEditorPathMutation(saving.session, {
      kind: "move",
      mapping: {
        sourceWorkspacePath: "a.ts",
        destinationWorkspacePath: "c.ts",
        sourceRepositoryId: ".",
        destinationRepositoryId: ".",
        sourcePath: "a.ts",
        destinationPath: "c.ts",
      },
    }),
    { status: "blocked", reason: "saveInFlight" },
  );
});

test("a trash lease becomes stale after an edit and clean trash closes only affected tabs", () => {
  let session = loaded(createEditorSession(), "folder/a.ts");
  session = loaded(session, "keep.ts");
  const request = { kind: "trash", sourceWorkspacePath: "folder" };
  const prepared = prepareEditorPathMutation(session, request);
  assert.equal(prepared.status, "ready");
  const changed = markTextEdited(session, session.textTabs[0].id, "late edit");
  assert.deepEqual(applyEditorPathMutation(changed, prepared.lease), { status: "stale" });

  const result = applyEditorPathMutation(session, prepared.lease);
  assert.equal(result.status, "applied");
  assert.deepEqual(result.disposedTabIds, [session.textTabs[0].id]);
  assert.deepEqual(result.session.textTabs.map((tab) => tab.document.workspacePath), ["keep.ts"]);
});

test("edits during save remain dirty and conflicts retain content", () => {
  let session = loaded(createEditorSession(), "one.ts");
  const tabId = session.textTabs[0].id;
  session = markTextEdited(session, tabId, "first edit");
  let saving = beginTextSave(session, tabId, "first edit", "save-1");
  session = markTextEdited(saving.session, tabId, "second edit");
  session = completeTextSave(session, tabId, {
    workspacePath: "one.ts",
    revision: "revision-two",
    byteLength: 10,
    requestId: "save-1",
    alreadySaved: false,
  });
  assert.equal(dirtyTextTabs(session).length, 1);

  saving = beginTextSave(session, tabId, "second edit", "save-2");
  session = failTextSave(
    saving.session,
    tabId,
    "save-2",
    "File changed outside Asterlyn",
    true,
  );
  assert.equal(session.textTabs[0].content, "second edit");
  assert.equal(session.textTabs[0].conflict, true);
  assert.equal(closeTextTab(session, tabId).blocked, true);
});

test("undoing exactly to the persisted content clears the dirty state", () => {
  let session = loaded(createEditorSession(), "one.ts");
  const tabId = session.textTabs[0].id;
  const original = session.textTabs[0].content;

  session = markTextEdited(session, tabId, "changed\n");
  assert.equal(dirtyTextTabs(session).length, 1);

  session = markTextEdited(session, tabId, original);
  assert.equal(dirtyTextTabs(session).length, 0);
  assert.equal(beginTextSave(session, tabId, original, "save-after-undo").request, null);
});

test("external snapshots reload clean tabs but preserve dirty buffers as conflicts", () => {
  let clean = loaded(createEditorSession(), "one.ts");
  const tabId = clean.textTabs[0].id;
  const refreshed = reconcileExternalTextSnapshot(clean, tabId, "revision-one.ts", {
    workspacePath: "one.ts",
    content: "external\n",
    utf8Bom: false,
    revision: "external-revision",
    byteLength: 9,
  });
  assert.equal(refreshed.status, "reloaded");
  assert.equal(refreshed.session.textTabs[0].content, "external\n");

  clean = markTextEdited(clean, tabId, "local edit");
  const conflicted = reconcileExternalTextSnapshot(clean, tabId, "revision-one.ts", {
    workspacePath: "one.ts",
    content: "external\n",
    utf8Bom: false,
    revision: "external-revision",
    byteLength: 9,
  });
  assert.equal(conflicted.status, "conflict");
  assert.equal(conflicted.session.textTabs[0].content, "local edit");
  assert.equal(conflicted.session.textTabs[0].conflict, true);

  const stale = reconcileExternalTextSnapshot(
    refreshed.session,
    tabId,
    "revision-one.ts",
    {
      workspacePath: "one.ts",
      content: "stale\n",
      utf8Bom: false,
      revision: "another-revision",
      byteLength: 6,
    },
  );
  assert.equal(stale.status, "stale");
  assert.equal(stale.session, refreshed.session);
});

test("save completion advances the content baseline captured by that request", () => {
  let session = loaded(createEditorSession(), "one.ts");
  const tabId = session.textTabs[0].id;
  session = markTextEdited(session, tabId, "captured edit");
  const saving = beginTextSave(session, tabId, "captured edit", "save-1");
  session = markTextEdited(saving.session, tabId, "newer edit");
  session = completeTextSave(session, tabId, {
    workspacePath: "one.ts",
    revision: "revision-two",
    byteLength: 13,
    requestId: "save-1",
    alreadySaved: false,
  });

  assert.equal(session.textTabs[0].persistedContent, "captured edit");
  assert.equal(session.textTabs[0].content, "newer edit");
  assert.equal(dirtyTextTabs(session).length, 1);
});

test("opening beyond the tab bound retires the oldest inactive clean tab", () => {
  let session = createEditorSession();
  for (let index = 0; index < TEXT_TAB_LIMIT; index += 1) {
    session = loaded(session, `${index}.ts`);
  }
  const overflow = openTextDocument(session, document("overflow.ts"));
  assert.equal(overflow.limitReached, false);
  assert.equal(overflow.session.textTabs.length, TEXT_TAB_LIMIT);
  assert.equal(
    overflow.session.textTabs.some((tab) => tab.document.path === "0.ts"),
    false,
  );
  assert.equal(
    overflow.session.textTabs.at(-1).document.path,
    "overflow.ts",
  );

  const first = overflow.session.textTabs[0].id;
  const closed = closeTextTab(overflow.session, first);
  assert.equal(closed.blocked, false);
  assert.equal(closed.session.textTabs.length, TEXT_TAB_LIMIT - 1);
});

test("the tab bound refuses a new file only when every buffer must be retained", () => {
  let session = createEditorSession();
  for (let index = 0; index < TEXT_TAB_LIMIT; index += 1) {
    session = loaded(session, `${index}.ts`);
    const tabId = session.textTabs.at(-1).id;
    session = markTextEdited(session, tabId, `dirty-${index}`);
  }
  const overflow = openTextDocument(session, document("overflow.ts"));
  assert.equal(overflow.limitReached, true);
  assert.equal(overflow.session, session);
  assert.equal(overflow.session.textTabs.length, TEXT_TAB_LIMIT);

  const existing = openTextDocument(session, document("0.ts"));
  assert.equal(existing.limitReached, false);
  assert.equal(existing.session.active.id, session.textTabs[0].id);
});
