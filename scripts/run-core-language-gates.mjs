import {spawn} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const output=resolve(process.env.ASTERLYN_GATE_EVIDENCE??join(root,"target/core-language-gates"));await mkdir(output,{recursive:true});
const results=[];
let active=null;
function stopOwned(child){
 if(!child?.pid)return;
 if(process.platform!=="win32"){try{process.kill(-child.pid,"SIGKILL");}catch{}return;}
 if(process.env.SystemRoot){const kill=spawn(join(process.env.SystemRoot,"System32","taskkill.exe"),["/F","/T","/PID",String(child.pid)],{stdio:"ignore"});kill.on("error",()=>child.kill());}else child.kill();
}
const interrupted=()=>{stopOwned(active);process.exitCode=130;};process.once("SIGINT",interrupted);process.once("SIGTERM",interrupted);
async function gate(name,args,expectedTests,requiredNames=[],executable="cargo"){
 const began=performance.now();let text="",overflow=false,timedOut=false;
 const child=spawn(executable,args,{cwd:root,detached:process.platform!=="win32",env:{...process.env,ASTERLYN_LANGUAGE_SERVICE_NODE:process.execPath},stdio:["ignore","pipe","pipe"]});active=child;
 for(const stream of [child.stdout,child.stderr])stream.on("data",data=>{const chunk=data.toString(),remaining=16*1024*1024-text.length;text+=chunk.slice(0,Math.max(0,remaining));if(chunk.length>remaining){overflow=true;stopOwned(child);}});
 const timer=setTimeout(()=>{timedOut=true;stopOwned(child);},15*60*1000);
 const status=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",resolve);}).finally(()=>{clearTimeout(timer);active=null;});
 await writeFile(join(output,`${name}.log`),text);const matches=[...text.matchAll(/test result: ok\. (\d+) passed/gu)];const tests=matches.reduce((sum,item)=>sum+Number(item[1]),0);
 const requiredFixturesPassed=requiredNames.every(name=>text.split("\n").some(line=>line.includes(name)&&line.trimEnd().endsWith("... ok")));
 const result={name,exitCode:status,passed:status===0&&!overflow&&!timedOut&&tests>=expectedTests&&requiredFixturesPassed,tests,durationMs:Math.round(performance.now()-began)};results.push(result);console.log(JSON.stringify(result));
 if(!result.passed)throw Error(`Core gate failed: ${name}; see ${join(output,`${name}.log`)}`);
}
try{
 await gate("core",["test","--locked","-p","asterlyn-process","-p","asterlyn-language-service","-p","asterlyn-task","-p","asterlyn-plugin-models","-p","asterlyn-plugin-dependencies","--","--test-threads=2"],1);
 await gate("portable-process",["test","--locked","-p","asterlyn-language-service","--features","process-fixtures","--test","process_lifecycle","--","--test-threads=1"],3);
 await gate("portable-actors",["test","--locked","-p","asterlyn-language-service","--features","process-fixtures","--lib","--","--test-threads=2"],3,["real_actor_eof_and_malformed_frames_are_distinct_and_new_sessions_get_new_ids","actor_cancellation_bypasses_a_stalled_request_and_rejects_foreign_owners","internal_backend_recovery_invalidates_pending_results_without_reopening_documents"]);
 const symbolFixtures=["five_languages_skip_literals_and_comments_keep_utf16_locations","saved_cache_reopens_invalidates_and_never_persists_overlays","model_scope_excludes_unrelated_modules_and_missing_scope_never_expands","limits_malformed_rules_and_duplicate_overlays_are_bounded"];
 if(process.platform!=="win32")symbolFixtures.push("symlink_outside_workspace_cannot_be_read");
 await gate("workspace-symbols",["test","--locked","-p","asterlyn-workspace","--test","symbols"],symbolFixtures.length,symbolFixtures);
 await gate("native-bindings",["scripts/generate-native-language-contract.mjs","--check"],0,[],process.execPath);
 await gate("language-catalog",["test","--locked","-p","asterlyn-plugin-package","--features","bindings"],19,["shared_catalog_corpus_is_admitted_or_rejected_without_repair","language_catalog_requires_named_capability_and_default_copy_but_grants_no_execution"]);
 await gate("catalog-bindings",["scripts/generate-language-catalog-contract.mjs","--check"],0,[],process.execPath);
}finally{process.removeListener("SIGINT",interrupted);process.removeListener("SIGTERM",interrupted);await writeFile(join(output,"summary.json"),JSON.stringify({schema:1,platform:process.platform,arch:process.arch,node:process.version,results},null,2)+"\n");}
