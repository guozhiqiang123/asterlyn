// Explicit, private developer acceptance. Kills only JVM children of its own adapter process.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile,writeFile,mkdtemp,mkdir,rm,cp} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";
import {JvmLspProbeSession} from "./jvm-lsp-session.mjs";
const [configFile,output]=process.argv.slice(2);
if(!output)throw Error("usage: verify-android-recovery.mjs <baseline-config.json> <evidence.json>");
const config=JSON.parse(await readFile(configFile,"utf8")),bytes=await readFile(config.modelFile),model=JSON.parse(bytes);
assert.equal(config.profile,"android");assert.equal(model.buildRoot,config.workspace);
const scratch=await mkdtemp(join(tmpdir(),"asterlyn-o2-recovery-")),state=join(scratch,"state"),cache=join(scratch,"cache");await mkdir(state);await mkdir(cache);if(config.cacheSeed)await cp(config.cacheSeed,cache,{recursive:true});
const hash=value=>createHash("sha256").update(value).digest("hex");
const file=join(model.buildRoot,config.document.path),text=await readFile(file,"utf8"),uri=pathToFileURL(file).href;
const prefix=text.slice(0,text.indexOf(config.document.needle)+(config.document.offset??config.document.needle.length-1));assert.ok(text.includes(config.document.needle));
const position={line:prefix.split("\n").length-1,character:prefix.slice(prefix.lastIndexOf("\n")+1).length};
const env={};for(const key of ["HOME","PATH","TMPDIR","LANG","USER"])if(process.env[key])env[key]=process.env[key];
const session=new JvmLspProbeSession(config.executable,config.arguments,{cwd:config.workspace,env,configuration:{},workspaceModel:{path:config.modelFile,digest:`sha256:${hash(bytes)}`,bytes:bytes.length,generation:1,schema:1}});
const summary={schema:1,entryHash:hash(await readFile(config.entryFile)),modelHash:hash(bytes),sourceHash:hash(text),checks:[],faults:[],passed:false};
const checkpoint=setInterval(()=>{void writeFile(output,JSON.stringify({...summary,inProgress:true,statuses:session.events.filter(e=>e.method==="experimental/serverStatus")},null,2)+"\n",{mode:0o600});},2000);
let interrupted=false;
const interrupt=()=>{interrupted=true;void session.stop();};process.on("SIGINT",interrupt);process.on("SIGTERM",interrupt);
const result=response=>{if(response.error)throw Object.assign(Error("request-failed"),{code:response.error.code});return response.result;};
async function until(predicate,limit=600000){const deadline=Date.now()+limit;while(Date.now()<deadline){if(interrupted||session.exited||session.protocolFailed)throw Error("adapter-ended");if(await predicate())return;await sleep(100);}throw Error("acceptance-deadline");}
function processes(){return execFileSync("ps",["-axo","pid=,ppid=,pgid=,command="],{encoding:"utf8"}).split("\n").flatMap(line=>{const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(line);return m?[{pid:+m[1],parent:+m[2],group:+m[3],command:m[4]}]:[];});}
function children(kind,moduleHash){return processes().filter(row=>row.parent===session.child.pid&&row.group===session.child.pid&&(kind==="java"?row.command.includes("org.eclipse.jdt.ls.core.id1"):row.command.includes("org.javacs.kt.MainKt"))&&(!moduleHash||row.command.includes(`kotlin-${moduleHash}/`)));}
const status=()=>session.events.filter(e=>e.method==="experimental/serverStatus").at(-1);
async function ready(){await until(()=>{const s=status();if(s?.health==="error"||s?.code==="kotlin-backend-unavailable")throw Error(s.code??"backend-failed");return s?.quiescent&&s?.phase==="ready"&&s.health==="ok";});}
async function references(){const value=result(await session.request("textDocument/references",{textDocument:{uri},position,context:{includeDeclaration:false}},90000));assert.ok(Array.isArray(value)&&value.length);return hash(JSON.stringify(value.map(v=>[v.uri,v.range]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));}
async function kill(kind,moduleHash,exhausted=false){
 const candidates=children(kind,moduleHash);assert.ok(candidates.length);const child=candidates.at(-1),from=session.events.length,started=Date.now();
 const identity=kind==="kotlin"?child.command.match(/kotlin-([a-f0-9]{12})\//u)?.[1]:null;assert.ok(kind==="java"||identity);
 process.kill(child.pid,"SIGKILL");
 if(summary.faults.length===0)session.notify("textDocument/didChange",{textDocument:{uri,version:2},contentChanges:[{text:text+"\n// private unsaved recovery acceptance\n"}]});
 const expected=exhausted?"kotlin-backend-unavailable":`${kind}-backend-recovering`;
 await until(()=>session.events.slice(from).some(e=>e.code===expected),15000);
 if(!exhausted){await ready();assert.ok(children(kind,identity).some(row=>row.pid!==child.pid));assert.equal(await references(),summary.referenceDigest);}
 else {await sleep(2500);assert.equal(children(kind,identity).length,0,"exhausted module must not be restarted by polling");}
 summary.faults.push({kind,moduleHash:identity,exhausted,elapsedMs:Date.now()-started});await writeFile(output,JSON.stringify(summary,null,2)+"\n",{mode:0o600});
 console.log(JSON.stringify({kind,exhausted,elapsedMs:Date.now()-started}));return identity;
}
try{
 result(await session.request("initialize",{rootUri:pathToFileURL(model.buildRoot).href,capabilities:{general:{positionEncodings:["utf-16"]}},initializationOptions:{analysis:{...config.analysis,stateDirectory:state,cacheDirectory:cache,debugTrace:false}}},30000));session.notify("initialized",{});await ready();
 session.notify("textDocument/didOpen",{textDocument:{uri,languageId:"kotlin",version:1,text}});summary.referenceDigest=await references();summary.checks.push("real-project-ready-with-exact-references");await sleep(6000);assert.equal(await references(),summary.referenceDigest);summary.checks.push("noop-model-poll-retains-active-backend");
 await kill("java");summary.checks.push("jdt-child-rebuilt-and-latest-overlay-retained");
 let moduleHash;for(let index=0;index<4;index++)moduleHash=await kill("kotlin",moduleHash,index===3);
 summary.checks.push("kotlin-child-rebuilt-three-times-and-fourth-exit-stops");
 const javaPath=join(model.buildRoot,"common/src/main/java/com/swiftcleaner/lib/http/HttpClient.java"),javaText=await readFile(javaPath,"utf8"),javaUri=pathToFileURL(javaPath).href,at=javaText.indexOf("class HttpClient")+7,before=javaText.slice(0,at);
 session.notify("textDocument/didOpen",{textDocument:{uri:javaUri,languageId:"java",version:1,text:javaText}});
 const hover=result(await session.request("textDocument/hover",{textDocument:{uri:javaUri},position:{line:before.split("\n").length-1,character:before.slice(before.lastIndexOf("\n")+1).length}},30000));assert.ok(hover);summary.checks.push("java-remains-usable-with-kotlin-exhausted");
 assert.ok((session.counts["asterlyn/workspaceModel"]??0)>=2);summary.checks.push("model-reacquired-after-jdt-restart");
 summary.sourceUnchanged=hash(await readFile(file))===summary.sourceHash;assert.ok(summary.sourceUnchanged);summary.passed=true;
}catch(error){summary.failure=/^[a-z0-9.-]+$/u.test(error.message)?error.message:"acceptance-failed";summary.failureCode=error.code;process.exitCode=1;}
finally{
 clearInterval(checkpoint);
 try{result(await session.request("shutdown",null,5000));session.notify("exit",null);}catch{}
 await session.stop();for(const signal of ["SIGTERM","SIGKILL"]){if(processes().some(row=>row.group===session.child.pid)){try{process.kill(-session.child.pid,signal);}catch{}await sleep(500);}}
 summary.remainingProcesses=processes().filter(row=>row.group===session.child.pid).length;if(summary.remainingProcesses){summary.passed=false;process.exitCode=1;}
 summary.modelRequests=session.counts["asterlyn/workspaceModel"]??0;summary.stderrBytes=session.stderrBytes;summary.statuses=session.events.filter(e=>e.method==="experimental/serverStatus");
 process.removeListener("SIGINT",interrupt);process.removeListener("SIGTERM",interrupt);await rm(scratch,{recursive:true,force:true});await writeFile(output,JSON.stringify(summary,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({passed:summary.passed,failure:summary.failure,checks:summary.checks}));
}
