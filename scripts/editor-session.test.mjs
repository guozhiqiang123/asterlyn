import assert from "node:assert/strict";
import test from "node:test";

import {
  TEXT_TAB_LIMIT,
  activatePreview,
  beginTextSave,
  closeTextTab,
  completeTextLoad,
  completeTextSave,
  createEditorSession,
  dirtyTextTabs,
  failTextSave,
  markTextEdited,
  openTextDocument,
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
  session = markTextEdited(session, opened.tabId);
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

test("edits during save remain dirty and conflicts retain content", () => {
  let session = loaded(createEditorSession(), "one.ts");
  const tabId = session.textTabs[0].id;
  session = markTextEdited(session, tabId);
  let saving = beginTextSave(session, tabId, "first edit", "save-1");
  session = markTextEdited(saving.session, tabId);
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

test("clean tabs close and the session enforces its text-tab bound", () => {
  let session = createEditorSession();
  for (let index = 0; index < TEXT_TAB_LIMIT; index += 1) {
    session = loaded(session, `${index}.ts`);
  }
  const overflow = openTextDocument(session, document("overflow.ts"));
  assert.equal(overflow.limitReached, true);
  assert.equal(overflow.session.textTabs.length, TEXT_TAB_LIMIT);

  const first = session.textTabs[0].id;
  const closed = closeTextTab(session, first);
  assert.equal(closed.blocked, false);
  assert.equal(closed.session.textTabs.length, TEXT_TAB_LIMIT - 1);
});
