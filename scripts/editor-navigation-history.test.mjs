import assert from "node:assert/strict";
import test from "node:test";
import { EditorNavigationHistory } from "../src/features/files-editor/editor-navigation-history.ts";
import { editorDocumentKey } from "../src/editor-document.ts";

const doc = path => ({ kind: "project-file", repositoryRoot: "/repo", repositoryId: ".", path, workspacePath: path });
function fixture(limit = 100) {
  let now = 0; const opened = [], selected = [], outcomes = [], missing = new Set();
  const f = { opened, selected, outcomes, missing, blocked: false, pending: null };
  const history = new EditorNavigationHistory({
    open: async document => { if (f.pending) await f.pending; opened.push(document.path); return missing.has(document.path) ? "missing" : f.blocked ? "blocked" : "opened"; },
    select: (anchor, head) => { selected.push({anchor, head}); return true; },
    diagnostic: (direction, outcome) => outcomes.push({direction, outcome}),
  }, () => now, limit);
  history.reset("/repo");
  return { ...f, control: f, history, observe(path, head, kind = "jump", line = head, anchor = head) {
    now += 1000; history.observe(doc(path), { tabId: editorDocumentKey(doc(path)), anchor, head, line, kind });
  }, tick(delta = 1) { now += delta; }, update(path, update) {history.observe(doc(path), {tabId: editorDocumentKey(doc(path)), ...update});} };
}
test("Back and Forward restore locations across files and within one file without replay history", async () => {
  const f = fixture(); f.observe("a.ts", 3); f.observe("b.ts", 20); f.observe("b.ts", 50);
  await f.history.navigate(-1); await f.history.navigate(-1); await f.history.navigate(1);
  assert.deepEqual(f.opened, ["b.ts", "a.ts", "b.ts"]);
  assert.deepEqual(f.selected, [{anchor:20,head:20},{anchor:3,head:3},{anchor:20,head:20}]);
  assert.equal(f.history.size, 3);
  f.observe("c.ts", 8); assert.equal(f.history.available(1), false);
});
test("activation's initial caret and a pointer drag coalesce, but later jumps remain separate", async () => {
  const f = fixture(); f.observe("a.ts", 2);
  f.observe("b.ts", 0, "activation"); f.tick(); f.update("b.ts", {anchor:40,head:40,line:4,kind:"jump"});
  assert.equal(f.history.size, 2);
  f.tick(1000); f.update("b.ts", {anchor:60,head:70,line:7,kind:"pointer"});
  f.tick(); f.update("b.ts", {anchor:60,head:90,line:9,kind:"pointer"});
  assert.equal(f.history.size, 3);
  await f.history.navigate(-1); assert.deepEqual(f.selected.at(-1), {anchor:40,head:40});
  await f.history.navigate(1); assert.deepEqual(f.selected.at(-1), {anchor:60,head:90});
});
test("minor keyboard moves do not create a history entry per key; edits map saved selections once", async () => {
  const f = fixture(); f.observe("a.ts", 0);
  for(let line=1;line<=5;line++)f.observe("a.ts",line,"move",line);
  assert.equal(f.history.size,2);
  f.update("a.ts",{anchor:15,head:15,line:6,kind:"edit",mapPosition:position=>position+10});
  await f.history.navigate(-1); assert.deepEqual(f.selected.at(-1),{anchor:10,head:10});
  await f.history.navigate(1); assert.deepEqual(f.selected.at(-1),{anchor:15,head:15});
});
test("missing files are skipped, blocked opens preserve history, and leaving a preview returns to source", async () => {
  const f=fixture(); f.observe("a.ts",3); f.observe("b.ts",4); f.observe("c.ts",5); f.missing.add("b.ts");
  f.control.blocked=true; await f.history.navigate(-1); assert.equal(f.history.available(-1),true);
  f.control.blocked=false; await f.history.navigate(-1); assert.deepEqual(f.selected.at(-1),{anchor:3,head:3});
  f.history.leave(); await f.history.navigate(-1); assert.equal(f.opened.at(-1),"a.ts");
});
test("history is bounded, workspace-local and cancels a late open during a project switch", async () => {
  const f=fixture(10);for(let i=0;i<1000;i++)f.observe(`f${i}.ts`,i);
  assert.equal(f.history.size,10);
  let release;f.control.pending=new Promise(resolve=>{release=resolve;});
  const pending=f.history.navigate(-1);f.history.reset("/other");release();await pending;
  assert.equal(f.history.size,0);assert.equal(f.selected.length,0);assert.equal(f.outcomes.at(-1).outcome,"stale");
  f.observe("old.ts",1);assert.equal(f.history.size,0);
});
test("a newly activated file cancels a pending history replay without stealing its cursor", async () => {
  const f=fixture(); f.observe("a.ts",3); f.observe("b.ts",4);
  let release; f.control.pending=new Promise(resolve=>{release=resolve;});
  const pending=f.history.navigate(-1); f.observe("c.ts",7,"activation"); release(); await pending;
  assert.equal(f.selected.length,0); assert.equal(f.outcomes.at(-1).outcome,"stale");
  f.control.pending=null; await f.history.navigate(-1);
  assert.equal(f.opened.at(-1),"b.ts"); assert.deepEqual(f.selected.at(-1),{anchor:4,head:4});
});
