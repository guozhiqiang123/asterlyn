import assert from "node:assert/strict";
import test from "node:test";
import { EditorContentContextRuntime, editorContentMenuModel } from "../src/features/files-editor/editor-content-context.ts";
import { createEditorFileContext } from "../src/features/files-editor/editor-file-context.ts";
import { EN_US } from "../src/localization/en-US.ts";
const copy = EN_US.editor.contentContext;
const enabled = {kind:"enabled"};
function fixture(selection = true) {
  const calls = [], statuses = [], errors = [];
  let session, current = true, clipboard = "pasted 😀", fail = false, pending = null;
  const request = {handle:{tabId:"a",path:"a.ts",loadEpoch:1},anchor:{x:10,y:10},hasSelection:selection,selectedText:"chosen 😀",readOnly:false,
    isCurrent:()=>current,replaceSelection:(...args)=>calls.push(args),replaceDocument:text=>calls.push(["document",text]),restoreFocus(){}};
  const file = {changed:false,reveal:enabled,history:enabled,diff:enabled,rollback:enabled,isCurrent:()=>current,
    revealFile:()=>calls.push("reveal"),showHistory:()=>calls.push("history"),showDiff:()=>calls.push("diff"),rollBack:()=>calls.push("rollback")};
  const runtime = new EditorContentContextRuntime({host:{open:(_anchor,value)=>{session=value;}},file:()=>file,copy:()=>copy,
    clipboard:{writeText:async text=>{if(pending)await pending;if(fail)throw Error("denied");clipboard=text;},readText:async()=>{if(pending)await pending;if(fail)throw Error("denied");return clipboard;}},
    find:text=>calls.push(["find",text]),status:text=>statuses.push(text),error:error=>errors.push(error.message)});
  return {request,file,runtime,calls,statuses,errors,get session(){return session;},get clipboard(){return clipboard;},set current(v){current=v;},set fail(v){fail=v;},set pending(v){pending=v;}};
}
const actions = model => model.items.filter(item=>item.kind==="command");
test("selection and caret menus have exact action sets and hide clean-file Diff/Rollback",()=>{
  const f=fixture();
  assert.deepEqual(actions(editorContentMenuModel(f.request,f.file,copy)).map(item=>item.label),["Cut","Copy","Paste","Find in Files"]);
  f.request.hasSelection=false;
  assert.deepEqual(actions(editorContentMenuModel(f.request,f.file,copy)).map(item=>item.label),["Paste","Reveal in File Manager","Show History"]);
  f.file.changed=true;
  assert.deepEqual(actions(editorContentMenuModel(f.request,f.file,copy)).map(item=>item.label),["Paste","Reveal in File Manager","Show History","Show Diff","Rollback"]);
  f.request.hasSelection=true;f.request.readOnly=true;
  assert.deepEqual(actions(editorContentMenuModel(f.request,null,copy)).map(item=>item.availability.kind),["blocked","enabled","blocked","enabled"]);
});
test("Cut writes exact selected text before modifying; denied clipboard preserves the source",async()=>{
  const f=fixture();f.runtime.open(f.request);f.fail=true;await f.session.invoke("cut");
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.errors,["denied"]);
  f.fail=false;await f.session.invoke("cut");assert.equal(f.clipboard,"chosen 😀");assert.deepEqual(f.calls,[["","cut"]]);
});
test("late clipboard reads and writes cannot edit another document or selection",async()=>{
  for(const action of ["cut","paste"]){
    const f=fixture();let release;f.pending=new Promise(resolve=>{release=resolve;});f.runtime.open(f.request);
    const run=f.session.invoke(action);f.current=false;release();await run;
    assert.deepEqual(f.calls,[]);assert.equal(f.statuses.at(-1),copy.changed);
  }
});
test("Copy and Find preserve selection text; blocked or absent actions cannot be invoked",async()=>{
  const f=fixture();f.runtime.open(f.request);await f.session.invoke("copy");await f.session.invoke("find");await f.session.invoke("rollback");
  assert.equal(f.clipboard,"chosen 😀");assert.deepEqual(f.calls,[["find","chosen 😀"]]);
  f.request.readOnly=true;f.runtime.open(f.request);await f.session.invoke("cut");await f.session.invoke("paste");assert.equal(f.calls.length,1);
});
test("menu focus can retain its target while action execution still requires the exact selection",async()=>{
  const f=fixture();f.file.isCurrent=()=>true;f.request.isTargetCurrent=()=>true;f.runtime.open(f.request);f.current=false;
  assert.equal(f.session.isCurrent(),true);await f.session.invoke("cut");assert.deepEqual(f.calls,[]);
  assert.equal(f.statuses.at(-1),copy.changed);
});
test("Paste replaces the captured selection and never writes when clipboard read fails",async()=>{
  const f=fixture(false);f.runtime.open(f.request);await f.session.invoke("paste");assert.deepEqual(f.calls,[["pasted 😀","paste"]]);
  f.fail=true;await f.session.invoke("paste");assert.equal(f.calls.length,1);assert.deepEqual(f.errors,["denied"]);
});
test("non-text clipboard gives feedback without an edit",async()=>{
  const f=fixture(false);f.runtime.open(f.request);f.request.hasSelection=false;
  // A separate empty-text clipboard represents image/file-only clipboard formats.
  const runtime=new EditorContentContextRuntime({host:{open:(_a,s)=>{f.emptySession=s;}},file:()=>null,copy:()=>copy,
    clipboard:{readText:async()=>"",writeText:async()=>{}},find(){},status:text=>f.statuses.push(text),error:error=>f.errors.push(error)});
  runtime.open(f.request);await f.emptySession.invoke("paste");assert.deepEqual(f.calls,[]);assert.equal(f.statuses.at(-1),copy.emptyClipboard);
});
function fileFixture({dirty=false,changed=false,repositoryId="."}={}){
  const document={kind:"project-file",repositoryRoot:"/repo",repositoryId,path:"a.ts",workspacePath:repositoryId==="."?"a.ts":"nested/a.ts"};
  const tab={id:"a",document,status:"ready",loadEpoch:1,editVersion:3,dirty,persistedContent:"saved\r\n",saveRequest:null};
  const change={repositoryId,path:"a.ts",workspacePath:document.workspacePath,indexStatus:"unmodified",worktreeStatus:"modified",conflicted:false,submodule:false};
  const snapshot={root:"/repo",repositoryRoots:[{id:"."},{id:"nested"}],branch:{oid:"a".repeat(40),unborn:false},branches:[{kind:"local",current:true,repositoryId:"nested",name:"feature",oid:"b".repeat(40)}],changes:changed?[change]:[]};
  const state={root:"/repo",generation:2,snapshot,tab,busy:false},calls=[];
  let confirm=true,confirmGate=null;
  const create=()=>createEditorFileContext({tabId:"a",path:"a.ts",loadEpoch:1},{source:()=>state,headOid:(snapshot,id)=>id==="."?snapshot.branch.oid:snapshot.branches.find(b=>b.repositoryId===id)?.oid??null,
    reasons:{unavailable:"unavailable",busy:"busy",saveFirst:"saveFirst",readOnly:"readOnly",restoreUnavailable:"restoreUnavailable"},
    reveal:doc=>calls.push(["reveal",doc]),history:intent=>calls.push(["history",intent]),diff:change=>calls.push(["diff",change]),
    compareBuffer:source=>calls.push(["compare",source]),restore:change=>calls.push(["restore",change]),
    confirmBufferRollback:async()=>{if(confirmGate)await confirmGate;return confirm;}});
  return {state,tab,change,calls,create,set confirm(v){confirm=v;},set confirmGate(v){confirmGate=v;}};
}
test("file History/reveal/Diff keep exact nested repository identities and never save a buffer",()=>{
  const f=fileFixture({dirty:true,changed:true,repositoryId:"nested"}),file=f.create();
  file.showHistory();file.revealFile();file.showDiff();
  assert.deepEqual(f.calls[0][1].query.paths,[{repositoryId:"nested",path:"a.ts"}]);
  assert.equal(f.calls[1][1].workspacePath,"nested/a.ts");
  assert.equal(f.calls[2][0],"compare");assert.equal(f.calls[2][1].commitOid,"b".repeat(40));
  assert.equal(file.rollback.kind,"blocked");
});
test("saved changes reuse reviewed restore; untracked/read-only/conflicts stay protected",async()=>{
  const f=fileFixture({changed:true}),file=f.create();await file.rollBack({});assert.deepEqual(f.calls,[["restore",f.change]]);
  f.change.worktreeStatus="untracked";assert.equal(f.create().rollback.kind,"blocked");assert.equal(f.create().history.kind,"blocked");
  f.tab.document.readOnly=true;assert.equal(f.create().rollback.kind,"blocked");
});
test("staged new files keep the existing reviewed restore route while History stays unavailable",async()=>{
  const f=fileFixture({changed:true});f.change.indexStatus="added";f.change.worktreeStatus="unmodified";
  const file=f.create();assert.equal(file.history.kind,"blocked");assert.equal(file.rollback.kind,"enabled");
  await file.rollBack({});assert.deepEqual(f.calls,[["restore",f.change]]);
});
test("unsaved-only Rollback confirms, is cancellable, and cannot apply after a workspace switch",async()=>{
  const f=fileFixture({dirty:true});let valid=true;const request={isCurrent:()=>valid,replaceDocument:text=>f.calls.push(["buffer",text])};
  f.confirm=false;await f.create().rollBack(request);assert.deepEqual(f.calls,[]);
  f.confirm=true;await f.create().rollBack(request);assert.deepEqual(f.calls,[["buffer","saved\r\n"]]);
  f.calls.length=0;let release;f.confirmGate=new Promise(resolve=>{release=resolve;});
  const pending=f.create().rollBack(request);f.state.generation++;release();await pending;assert.deepEqual(f.calls,[]);
  valid=false;await f.create().rollBack(request);assert.deepEqual(f.calls,[]);
});
test("file identity rejects reloaded tabs, a new snapshot, pending saves and closed sources",()=>{
  const f=fileFixture({changed:true}),file=f.create();
  f.tab.editVersion++;assert.equal(file.isCurrent(),false);
  const file2=f.create();f.state.snapshot={...f.state.snapshot};assert.equal(file2.isCurrent(),false);
  f.tab.saveRequest={id:"save"};assert.equal(f.create().rollback.kind,"blocked");
  f.state.tab=null;assert.equal(f.create(),null);
});
