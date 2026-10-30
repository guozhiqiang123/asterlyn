import assert from "node:assert/strict";
import test from "node:test";
import {createLanguageServicesRuntime} from "../src/composition/language-services-runtime.ts";
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){for(let n=0;n<200&&!check();n++)await tick();assert.ok(check(),"lifecycle did not settle");}
const provider={kind:"language-service",qualifiedId:"dev.asterlyn.lsp:android",pluginId:"dev.asterlyn.lsp",pluginVersion:"0.3.7",serverId:"android-jvm",label:"Java / Kotlin",languageIds:["java","kotlin"],extensions:[".java",".kt"]};
const handle={tabId:"editor",path:"src/Main.kt",loadEpoch:1};
function harness(){
  let scope={root:"/repo",generation:1},factory,next=0;const calls=[],statuses=[],listeners=new Set();let held=null;
  const native={
    workspace:async root=>{calls.push(["workspace",root]);return{startupProfiles:[{pluginId:provider.pluginId,serverId:provider.serverId}],debugTracing:false};},
    prepare:async(root,pluginId,serverId)=>{calls.push(["prepare",root]);if(held)await held;return{reviewId:`r${++next}`,pluginId,serverId,pluginVersion:provider.pluginVersion,packageDigest:"package",resourceDigest:"resource",executableIdentity:"node",expiresAt:Date.now()+60000,remembered:true};},
    confirm:async()=>{calls.push(["confirm"]);return true;},
    start:async(root,_review,_server,_remember,refreshModel)=>{const id=`session-${++next}`;calls.push(["start",root,id,refreshModel]);for(const listener of listeners)listener({sessionId:id,kind:"ready",progress:{phase:"ready"}});return id;},
    open:async(...args)=>calls.push(["open",...args]),change:async(...args)=>calls.push(["change",...args]),close:async(...args)=>calls.push(["close",...args]),stop:async(...args)=>calls.push(["stop",...args]),cancel:async()=>{},
    request:async(root,sessionId,uri,version)=>({sessionId,uri,version,result:[]}),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    forget:async root=>calls.push(["forget",root]),setDebug:async enabled=>calls.push(["debug",enabled]),
  };
  const runtime=createLanguageServicesRuntime({registry:{list:()=>[provider],subscribe:()=>()=>{}},native,workspace:()=>scope,document:h=>({workspacePath:h.path,loadEpoch:h.loadEpoch,readOnly:false}),bind:value=>{factory=value;},navigate(){},reportError:error=>{throw error;},status:state=>statuses.push(state)});
  return{native,runtime,calls,statuses,listeners,get factory(){return factory;},set scope(value){scope=value;},hold(){let release;held=new Promise(resolve=>{release=resolve;});return()=>{held=null;release();};},emit(event){for(const l of listeners)l(event);},count:name=>calls.filter(call=>call[0]===name).length};
}
test("model-backed services start without a document and share the transport with later source opens",async()=>{
  const h=harness();try{
    h.runtime.refresh();await until(()=>h.count("start")===1);await tick();
    assert.equal(h.count("confirm"),0);assert.equal(h.count("open"),0);
    assert.equal(h.statuses.at(-1).state,"ready","early native readiness must not be lost before start returns");
    const port=h.factory(handle);port.open(handle,{version:1,text:"class Main"});await until(()=>h.count("open")===1);
    for(let n=0;n<5;n++)h.runtime.refresh();assert.equal(h.count("start"),1);
    port.close(handle);await tick();assert.equal(h.count("stop"),0,"project indexing survives closing the last source");
  }finally{h.runtime.dispose();}assert.equal(h.listeners.size,0);
});
test("degraded or terminated sessions have visible failure and explicit retry creates a fresh transport",async()=>{
  const h=harness();try{
    h.runtime.refresh();await until(()=>h.count("start")===1);await tick();
    let id=h.calls.find(call=>call[0]==="start")[2];h.emit({sessionId:id,kind:"degraded",code:"model-unavailable",progress:{phase:"failed"}});
    assert.equal(h.statuses.at(-1).state,"failed");assert.equal(h.statuses.at(-1).code,"model-unavailable");
    h.emit({sessionId:id,kind:"terminated",code:"backend-exited"});await h.runtime.retry();await until(()=>h.count("start")===2);await tick();
    assert.equal(h.statuses.at(-1).state,"ready");assert.equal(h.count("confirm"),0);assert.equal(h.calls.filter(call=>call[0]==="start").at(-1)[3],true,"retry explicitly refreshes the failed model");
  }finally{h.runtime.dispose();}
});
test("project replacement discards a delayed warm-up and cannot start an obsolete project",async()=>{
  const h=harness();try{
    const release=h.hold();h.runtime.refresh();await until(()=>h.count("prepare")===1);
    h.scope={root:"/other",generation:2};h.runtime.refresh();await until(()=>h.count("prepare")===2);release();await until(()=>h.count("start")===1);
    assert.equal(h.calls.find(call=>call[0]==="start")[1],"/other");
    assert.ok(h.statuses.filter(state=>state.state==="ready").every(state=>state.scope.workspaceRoot==="/other"));
  }finally{h.runtime.dispose();}
});
test("clearing project approval stops and suspends automatic startup until an explicit retry",async()=>{
  const h=harness();try{
    h.runtime.refresh();await until(()=>h.count("start")===1);await h.runtime.forget();h.runtime.refresh();await tick();
    assert.equal(h.count("forget"),1);assert.equal(h.factory(handle),null);assert.equal(h.count("start"),1);
    await h.runtime.retry();await until(()=>h.count("start")===2);assert.notEqual(h.factory(handle),null);
  }finally{h.runtime.dispose();}
});

test("an approval dialog can refresh an expired one-use review without repeating an unchanged explicit confirmation",async()=>{
 const h=harness();let prepared=0;const prepare=h.native.prepare;
 h.native.prepare=async(...args)=>({...await prepare(...args),remembered:false,expiresAt:++prepared===1?Date.now()-1:Date.now()+60000});
 try{h.runtime.refresh();await until(()=>h.count("start")===1);assert.equal(h.count("prepare"),2);assert.equal(h.count("confirm"),1);}finally{h.runtime.dispose();}
});
test("an expired approval cannot authorize a different language tool identity",async()=>{
 const h=harness();let prepared=0;const prepare=h.native.prepare;
 h.native.prepare=async(...args)=>({...await prepare(...args),remembered:false,expiresAt:++prepared===1?Date.now()-1:Date.now()+60000,resourceDigest:prepared===1?"old":"changed"});
 try{h.runtime.refresh();await until(()=>h.statuses.at(-1)?.state==="failed");assert.equal(h.count("start"),0);assert.equal(h.statuses.at(-1).code,"language-execution-identity-changed");}finally{h.runtime.dispose();}
});

test("progress elapsed time restarts for new background work rather than counting hours of ready time",async()=>{
 const original=Date.now;let now=100000;Date.now=()=>now;const h=harness();
 try{h.runtime.refresh();await until(()=>h.count("start")===1);await tick();const id=h.calls.find(call=>call[0]==="start")[2];now+=3600000;h.emit({sessionId:id,kind:"ready",progress:{phase:"backend"}});assert.equal(h.statuses.at(-1).startedAt,now);const started=now;now+=2000;h.emit({sessionId:id,kind:"ready",progress:{phase:"indexing"}});assert.equal(h.statuses.at(-1).startedAt,started);}finally{h.runtime.dispose();Date.now=original;}
});
