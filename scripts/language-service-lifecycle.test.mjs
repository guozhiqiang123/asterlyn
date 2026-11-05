import assert from "node:assert/strict";
import test from "node:test";
import {createLanguageServicesRuntime} from "../src/composition/language-services-runtime.ts";
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){for(let n=0;n<200&&!check();n++)await tick();assert.ok(check(),"lifecycle did not settle");}
const provider={kind:"language-service",qualifiedId:"dev.asterlyn.lsp:android",pluginId:"dev.asterlyn.lsp",pluginVersion:"0.3.7",serverId:"android-jvm",label:"Java / Kotlin",languageIds:["java","kotlin"],extensions:[".java",".kt"]};
const handle={tabId:"editor",path:"src/Main.kt",loadEpoch:1};
function harness({providers=[provider],storage,errors}={}){
  let scope={root:"/repo",generation:1},factory,next=0;const calls=[],statuses=[],notifications=[],listeners=new Set();let held=null;
  const native={
    workspace:async root=>{calls.push(["workspace",root]);return{startupProfiles:[{pluginId:provider.pluginId,serverId:provider.serverId}],debugTracing:false};},
    prepare:async(root,pluginId,serverId)=>{calls.push(["prepare",root,pluginId,serverId]);if(held)await held;return{reviewId:`r${++next}`,pluginId,serverId,pluginVersion:provider.pluginVersion,packageDigest:"package",resourceDigest:"resource",executableIdentity:"node",expiresAt:Date.now()+60000,remembered:true};},
    confirm:async()=>{calls.push(["confirm"]);return true;},
    start:async(root,_review,_server,_remember,refreshModel)=>{const id=`session-${++next}`;calls.push(["start",root,id,refreshModel]);for(const listener of listeners)listener({sessionId:id,kind:"ready",progress:{phase:"ready"}});return id;},
    open:async(...args)=>calls.push(["open",...args]),change:async(...args)=>calls.push(["change",...args]),close:async(...args)=>calls.push(["close",...args]),stop:async(...args)=>calls.push(["stop",...args]),cancel:async()=>{},
    request:async(root,sessionId,uri,version)=>({sessionId,uri,version,result:[]}),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    forget:async root=>calls.push(["forget",root]),setDebug:async enabled=>calls.push(["debug",enabled]),
  };
  const runtime=createLanguageServicesRuntime({notificationPublisher:{publish:request=>{notifications.push(request);return "test";}},providerStorage:storage,registry:{list:()=>providers,subscribe:()=>()=>{}},native,workspace:()=>scope,document:h=>({workspacePath:h.path,loadEpoch:h.loadEpoch,readOnly:false}),bind:value=>{factory=value;},navigate(){},reportError:error=>{if(errors)errors.push(error);else throw error;},status:state=>statuses.push(state)});
  return{native,runtime,calls,statuses,notifications,listeners,set providers(value){providers=value;},get factory(){return factory;},set scope(value){scope=value;},hold(){let release;held=new Promise(resolve=>{release=resolve;});return()=>{held=null;release();};},emit(event){for(const l of listeners)l(event);},count:name=>calls.filter(call=>call[0]===name).length};
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
test("a direct startup command error retains one reporting owner",async()=>{
 const errors=[],h=harness({errors});h.native.prepare=async()=>{throw new Error("toolchain-unavailable");};
 try{h.runtime.refresh();await until(()=>errors.length===1);await tick();assert.equal(h.statuses.at(-1).reported,true);assert.equal(h.notifications.length,0);assert.equal(h.statuses.at(-1).state,"failed");}finally{h.runtime.dispose();}
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


test("conflicting providers stay visible and idle until a project-scoped choice is made",async()=>{
 const other={...provider,qualifiedId:"dev.asterlyn.lsp:alternative",serverId:"android-alt",label:"Alternative"};
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 const h=harness({providers:[provider,other],storage});
 try{
  h.runtime.refresh();await tick();assert.equal(h.factory(handle),null);assert.equal(h.count("prepare"),0);assert.equal(h.statuses.length,0);
  h.runtime.selectProvider("kotlin",other.qualifiedId);await tick();
  const port=h.factory(handle);assert.ok(port);port.open(handle,{version:1,text:"class Main"});await until(()=>h.count("prepare")>0);
  assert.equal(h.calls.find(c=>c[0]==="prepare")[3],"android-alt");await until(()=>h.count("start")===1);
  h.providers=[provider];h.runtime.refresh();await tick();assert.equal(h.factory(handle),null,"a removed explicit selection must not silently switch providers");
  h.runtime.selectProvider("kotlin",provider.qualifiedId);await until(()=>h.count("start")===2);
 }finally{h.runtime.dispose();}
 const next=harness({providers:[provider,other],storage});
 try{next.runtime.refresh();assert.ok(next.factory(handle));next.scope={root:"/other",generation:2};next.runtime.refresh();assert.equal(next.factory(handle),null,"another project needs its own choice");}finally{next.runtime.dispose();}
});

test("a partial native profile remains distinct from an unavailable service",async()=>{
 const h=harness();try{h.runtime.refresh();await until(()=>h.count("start")===1);const id=h.calls.find(c=>c[0]==="start")[2];
  h.emit({sessionId:id,kind:"ready",code:"java-analysis-awaiting-kotlin",progress:{phase:"backend"}});
  assert.equal(h.statuses.at(-1).state,"partial");
  h.emit({sessionId:id,kind:"ready",progress:{phase:"ready"}});assert.equal(h.statuses.at(-1).state,"ready");
 }finally{h.runtime.dispose();}
});

test("confirmed project failures notify once per episode and reject obsolete workspace events",async()=>{
 const h=harness();const project={kind:"dependency-offline",module:":feature-push",dependency:"org.example:library:1.2.3",remaining:0};
 const failure={code:"model-unavailable",retryable:false,message:"raw exception is never copy",requestId:null,project};
 try{
  h.runtime.refresh();await until(()=>h.count("start")===1);await tick();let id=h.calls.find(c=>c[0]==="start")[2];
  for(let n=0;n<3;n++)h.emit({sessionId:id,kind:"degraded",code:"dependency-offline",failure,progress:{phase:"failed"}});
  await until(()=>h.notifications.length===1);assert.equal(h.notifications[0].kind,"error");assert.match(h.notifications[0].message,/:feature-push/u);assert.match(h.notifications[0].message,/org.example:library:1.2.3/u);assert.ok(!h.notifications[0].message.includes("raw exception"));
  h.emit({sessionId:id,kind:"degraded",code:"dependency-offline",failure});await tick();assert.equal(h.notifications.length,1);
  await h.runtime.retry();await until(()=>h.count("start")===2);await tick();id=h.calls.filter(c=>c[0]==="start").at(-1)[2];
  h.emit({sessionId:id,kind:"degraded",code:"dependency-offline",failure});await until(()=>h.notifications.length===2);
  h.emit({sessionId:id,kind:"ready",progress:{phase:"ready"}});h.emit({sessionId:id,kind:"degraded",code:"dependency-offline",failure});await until(()=>h.notifications.length===3);
  h.scope={root:"/other",generation:2};h.runtime.refresh();h.emit({sessionId:id,kind:"degraded",code:"dependency-offline",failure});await tick();assert.equal(h.notifications.length,3,"obsolete native session events cannot notify in a replacement project");
 }finally{h.runtime.dispose();}
});
test("unknown terminal service failures notify safely while deliberate stops stay quiet",async()=>{
 const h=harness();try{h.runtime.refresh();await until(()=>h.count("start")===1);await tick();const id=h.calls.find(c=>c[0]==="start")[2];
  h.emit({sessionId:id,kind:"degraded",code:"model-unavailable"});await until(()=>h.notifications.length===1);assert.doesNotMatch(h.notifications[0].message,/could not configure|Correct the project/u);
  h.emit({sessionId:id,kind:"terminated",code:"requested-stop"});await tick();assert.equal(h.notifications.length,1);
 }finally{h.runtime.dispose();}
});

test("a delayed first notification import is discarded after switching projects",async()=>{
 const h=harness();try{h.runtime.refresh();await until(()=>h.count("start")===1);await tick();const id=h.calls.find(c=>c[0]==="start")[2];
  h.emit({sessionId:id,kind:"degraded",code:"dependency-offline",failure:{code:"model-unavailable",retryable:false,message:"fixed",requestId:null,project:{kind:"dependency-offline",remaining:0}}});
  h.scope={root:"/other",generation:2};h.runtime.refresh();await tick();assert.equal(h.notifications.length,0);
 }finally{h.runtime.dispose();}
});

test("settled partial compiler exhaustion shows one actionable memory tip and healthy recovery resets it",async()=>{
  const h=harness();try{
    h.runtime.refresh();await until(()=>h.count("start")===1);const id=h.calls.find(call=>call[0]==="start")[2];
    const failure={sessionId:id,kind:"ready",code:"kotlin-compiler-resource-limit",progress:{phase:"failed"},failure:{code:"resource-limit",retryable:false,message:"fixed category",requestId:null}};
    h.emit(failure);h.emit(failure);await until(()=>h.notifications.length===1);
    assert.equal(h.statuses.at(-1).state,"partial");assert.match(h.notifications[0].message,/Increase compiler memory/u);assert.equal(h.notifications[0].kind,"error");
    h.emit({sessionId:id,kind:"ready",progress:{phase:"ready"}});h.emit(failure);await until(()=>h.notifications.length===2);
  }finally{h.runtime.dispose();}
});

test("model compatibility failure without project detail publishes once and survives a healthy reset",async()=>{
 const h=harness();try{h.runtime.refresh();await until(()=>h.count("start")===1);const id=h.calls.find(c=>c[0]==="start")[2];
 const failure={sessionId:id,kind:"degraded",code:"gradle-model-incompatible",progress:{phase:"failed"},failure:{code:"unavailable",retryable:false,message:"private exception must never be copy",requestId:null}};
 h.emit(failure);h.emit(failure);await until(()=>h.notifications.length===1);assert.match(h.notifications[0].message,/integration.*build-model/u);assert.doesNotMatch(h.notifications[0].message,/private exception/u);
 h.emit({sessionId:id,kind:"ready",progress:{phase:"ready"}});h.emit(failure);await until(()=>h.notifications.length===2);
 }finally{h.runtime.dispose();}
});
