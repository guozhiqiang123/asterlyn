// Explicit developer probe. Never imported by the app; never edits project files or user caches.
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile, writeFile, mkdtemp, mkdir, rm, realpath, stat} from "node:fs/promises";
import {join, relative, isAbsolute, sep, dirname} from "node:path";
import {tmpdir, platform, release, arch, cpus, totalmem} from "node:os";
import {pathToFileURL} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";
import {JvmLspProbeSession, ProbeFailure} from "./jvm-lsp-session.mjs";

const hash=value=>createHash("sha256").update(value).digest("hex");
const [configFile,output]=process.argv.slice(2);
if(!output)throw Error("usage: measure-language-baseline.mjs <explicit-config.json> <evidence.json>");
if((await stat(configFile)).size>65536)throw Error("configuration-bound");
const config=JSON.parse(await readFile(configFile,"utf8"));
if(!["android","typescript","rust"].includes(config.profile)||!isAbsolute(config.executable)||!isAbsolute(config.workspace)||!Array.isArray(config.arguments)||config.arguments.length>32||!config.arguments.every(value=>typeof value==="string"&&value.length<=4096))throw Error("invalid-profile");
const root=await realpath(config.workspace);
const path=await realpath(join(root,config.document.path)),rel=relative(root,path);
if(isAbsolute(rel)||rel===".."||rel.startsWith(`..${sep}`)||(await stat(path)).size>2*1024*1024)throw Error("document-bound");
const text=await readFile(path,"utf8"),needle=config.document.needle;
if(typeof needle!=="string"||!needle||!text.includes(needle))throw Error("probe-symbol-missing");
const prefix=text.slice(0,text.indexOf(needle)+(config.document.offset??needle.length-1));
const position={line:prefix.split("\n").length-1,character:prefix.slice(prefix.lastIndexOf("\n")+1).length},uri=pathToFileURL(path).href;
const cycles=config.cycles??3,samples=config.samples??30,deadline=config.deadlineMs??600000;
if(!Number.isSafeInteger(cycles)||cycles<1||cycles>3||!Number.isSafeInteger(samples)||samples<1||samples>100||!Number.isSafeInteger(deadline)||deadline<1000||deadline>900000)throw Error("measurement-bound");
const modelBytes=config.modelFile?await readFile(config.modelFile):null,model=modelBytes?JSON.parse(modelBytes):null;
if(config.profile==="android"&&(!model||await realpath(model.buildRoot)!==root))throw Error("model-workspace-mismatch");
const summary={schema:1,profile:config.profile,startedAt:new Date().toISOString(),machine:{platform:platform(),release:release(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,memoryBytes:totalmem()},workspaceHash:hash(root),sourceHash:hash(text),modelHash:modelBytes?hash(modelBytes):null,moduleCount:model?.modules?.length??null,executableHash:hash(await readFile(config.executable)),node:process.versions.node,analysisIdentityDigest:hash(JSON.stringify(config.analysis??config.initializationOptions??{})),entryHash:config.entryFile?hash(await readFile(config.entryFile)):null,identity:config.identity??null,runs:[],memoryMetric:"sampled descendant RSS KiB; excludes desktop/WebKit, not a hard limit or physical footprint",cacheScope:config.profile==="android"?"new private analysis cache for each cold/warm pair; user caches untouched":"new server process each run; no persistent analysis-cache claim",passed:false};
const scratch=await mkdtemp(join(tmpdir(),"asterlyn-o0-"));
let active,interrupted=false;
const interrupt=()=>{interrupted=true;void active?.stop();};
process.on("SIGINT",interrupt);process.on("SIGTERM",interrupt);
function processTable(){return execFileSync("ps",["-axo","pid=,ppid=,pgid=,rss="],{encoding:"utf8"}).trim().split("\n").map(line=>line.trim().split(/\s+/u).map(Number));}
function distribution(values){const sorted=[...values].sort((a,b)=>a-b);return{count:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};}
function result(response){if(response.error)throw new ProbeFailure(`rpc-${response.error.code}`);return response.result;}
async function measure(cycle,condition,cache){
 if(interrupted)throw Error("interrupted");
 const state=await mkdtemp(join(scratch,"state-")),options=structuredClone(config.initializationOptions??{});
 if(config.profile==="android")options.analysis={...config.analysis,stateDirectory:state,cacheDirectory:cache,debugTrace:false};
 const workspaceModel=modelBytes?{path:config.modelFile,digest:`sha256:${hash(modelBytes)}`,bytes:modelBytes.length,generation:1,schema:1}:undefined;
 const env={};for(const name of ["HOME","TMPDIR","PATH","LANG","USER"]){if(process.env[name])env[name]=process.env[name];}
 if(config.profile==="rust")Object.assign(env,{PATH:`${dirname(config.executable)}:${env.PATH??"/usr/bin:/bin"}`,RUSTUP_AUTO_INSTALL:"0",CARGO_NET_OFFLINE:"true",RUSTC_WRAPPER:"",RUSTC_WORKSPACE_WRAPPER:""});
 const session=active=new JvmLspProbeSession(config.executable,config.arguments,{cwd:root,env,configuration:config.configuration??{},workspaceModel});
 const started=performance.now(),run={cycle,condition,peakDescendantRssKiB:0,samples:[]};summary.runs.push(run);
 const sampler=setInterval(()=>{try{const rows=processTable(),owned=new Set([session.child.pid]);for(let n=0;n<30;n++)for(const [pid,parent]of rows)if(owned.has(parent))owned.add(pid);run.peakDescendantRssKiB=Math.max(run.peakDescendantRssKiB,rows.filter(([pid])=>owned.has(pid)).reduce((sum,row)=>sum+row[3],0));}catch{run.memorySamplingFailed=true;}},500);
 try{
  const init=result(await session.request("initialize",{processId:process.pid,rootUri:pathToFileURL(root).href,workspaceFolders:[{uri:pathToFileURL(root).href,name:"baseline"}],capabilities:{experimental:{serverStatusNotification:config.profile==="rust"},general:{positionEncodings:["utf-16"]},workspace:{configuration:true,workspaceFolders:true,applyEdit:false},window:{workDoneProgress:true},textDocument:{publishDiagnostics:{versionSupport:true},definition:{linkSupport:false}}},initializationOptions:options},90000));
  if(init?.capabilities?.positionEncoding&&init.capabilities.positionEncoding!=="utf-16")throw Error("position-encoding");
  run.initializeMs=performance.now()-started;session.notify("initialized",{});
  if(config.profile!=="typescript"){
   const until=Date.now()+deadline;
   while(true){const status=session.events.filter(event=>event.method==="experimental/serverStatus").at(-1);
    if(session.exited||session.protocolFailed)throw Error("backend-exited");
    if(status?.health==="error")throw Error(status.code??"backend-failed");
    if(status?.quiescent&&(config.profile!=="android"||status.phase==="ready"))break;
    if(Date.now()>until)throw Error("ready-deadline");await sleep(100);
   }
  }
  run.reportedReadyMs=performance.now()-started;
  session.notify("textDocument/didOpen",{textDocument:{uri,languageId:config.document.languageId,version:1,text}});
  for(let index=0;index<=samples;index++){
   const before=performance.now();
   const defs=result(await session.request("textDocument/definition",{textDocument:{uri},position},90000));
   const after=performance.now();
   const refs=result(await session.request("textDocument/references",{textDocument:{uri},position,context:{includeDeclaration:false}},90000));
   const locations=Array.isArray(refs)?refs:refs?.locations;
   if(!Array.isArray(locations)||!locations.length)throw Error("references-empty");
   const normalized=locations.map(value=>[value.uri??value.targetUri,value.range??value.targetSelectionRange]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
   const item={definitionMs:after-before,referencesMs:performance.now()-after,totalMs:performance.now()-before,definitionCount:Array.isArray(defs)?defs.length:defs?1:0,referenceCount:locations.length,resultDigest:hash(JSON.stringify(normalized)),coverage:refs?.coverage??"unknown"};
   if(index===0){run.firstQuery=item;run.semanticReadyMs=performance.now()-started;}else run.samples.push(item);
  }
  const items=[run.firstQuery,...run.samples];
  if(new Set(items.map(value=>value.resultDigest)).size!==1)throw Error("result-set-changed");
  run.distributionMs=distribution(run.samples.map(value=>value.totalMs));
 }finally{
  clearInterval(sampler);run.stderrBytes=session.stderrBytes;run.protocolFailed=session.protocolFailed;run.stages=session.events.filter(event=>event.method==="experimental/serverStatus").map(({time,...event})=>({...event,elapsedMs:time-(Date.now()-(performance.now()-started))}));
  try{result(await session.request("shutdown",null,5000));}catch{}
  session.child.stdin.end();await Promise.race([session.exit,sleep(1000)]);await session.stop();
  // The leader may exit before its descendants. Cleanup the probe's private process group too.
  let rows=processTable().filter(row=>row[2]===session.child.pid);
  if(rows.length){try{process.kill(-session.child.pid,"SIGTERM");}catch{}await sleep(500);rows=processTable().filter(row=>row[2]===session.child.pid);}
  if(rows.length){try{process.kill(-session.child.pid,"SIGKILL");}catch{}await sleep(500);rows=processTable().filter(row=>row[2]===session.child.pid);}
  run.remainingProcessCount=rows.length;active=null;await rm(state,{recursive:true,force:true});
  if(rows.length)throw Error("probe-process-leak");
 }
}
try{
 for(let cycle=1;cycle<=cycles;cycle++){const cache=join(scratch,`cache-${cycle}`);await mkdir(cache,{mode:0o700});for(const condition of ["cold","warm"]){await measure(cycle,condition,cache);await writeFile(output,JSON.stringify(summary,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({profile:config.profile,cycle,condition,readyMs:summary.runs.at(-1).semanticReadyMs,p95Ms:summary.runs.at(-1).distributionMs.p95}));}}
 summary.sourceUnchanged=hash(await readFile(path))===summary.sourceHash;
 if(!summary.sourceUnchanged)throw Error("source-changed-during-measurement");
 summary.passed=true;
}catch(error){summary.failure=/^[a-z0-9.-]+$/u.test(error.message)?error.message:"measurement-failed";process.exitCode=1;}
finally{process.removeListener("SIGINT",interrupt);process.removeListener("SIGTERM",interrupt);await active?.stop();await rm(scratch,{recursive:true,force:true});await writeFile(output,JSON.stringify(summary,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({profile:config.profile,passed:summary.passed,failure:summary.failure,runs:summary.runs.length}));}
