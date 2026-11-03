import test from "node:test";
import assert from "node:assert/strict";
import {languageResultCoverage,UNKNOWN_LANGUAGE_COVERAGE} from "../src/protocol/language-result-coverage.ts";
import {normalizeDefinitionTargets} from "../src/application/language-services/definition-targets.ts";
import {FindResultsController} from "../src/features/files-editor/find-results-controller.ts";
import {renderFindResults} from "../src/features/files-editor/find-results-view.ts";
import {LanguageProviderPreferences,selectLanguageProvider} from "../src/application/language-services/provider-selection.ts";
const location=(line=0)=>({uri:"file:///repo/src/a.ts",range:{start:{line,character:0},end:{line,character:3}}});

test("legacy and malformed provider coverage cannot become complete",()=>{
 for(const value of [undefined,null,{state:"complete",reasons:["indexing"]},{state:"partial",reasons:[]},{state:"unknown",reasons:["source text"]},{state:"complete",reasons:[],text:"secret"}])assert.deepEqual(languageResultCoverage(value),UNKNOWN_LANGUAGE_COVERAGE);
 assert.deepEqual(normalizeDefinitionTargets([location()]).coverage,UNKNOWN_LANGUAGE_COVERAGE);
 assert.deepEqual(languageResultCoverage({state:"complete",reasons:[]}),{state:"complete",reasons:[]});
});
test("quantity truncation and semantic coverage remain independent; discarded locations cannot claim complete coverage",()=>{
 const complete={state:"complete",reasons:[]};
 const result=normalizeDefinitionTargets({locations:Array.from({length:600},(_,i)=>location(i)),coverage:complete},"references");
 assert.equal(result.locations.length,512);assert.equal(result.limited,true);assert.deepEqual(result.coverage,complete);
 const bad=normalizeDefinitionTargets({locations:[location(),{uri:"file:///repo/a.ts",range:{}}],coverage:complete});
 assert.equal(bad.invalid,true);assert.equal(bad.coverage.state,"partial");
 assert.equal(normalizeDefinitionTargets({locations:null,coverage:complete}).invalid,true);
});
test("Find projections preserve original coverage through import filtering and tree/flat changes",()=>{
 const controller=new FindResultsController(),coverage={state:"partial",reasons:["files-skipped"]};
 assert.equal(controller.installLocations({workspaceRoot:"/repo",workspaceGeneration:1,kind:"references",query:"Target",locations:[location(),location(1)],limited:false,coverage,referenceAnalysis:{imports:[0],previews:[]}}),true);
 controller.setExcludeImports(false);assert.deepEqual(controller.state.snapshot.coverage,coverage);
 assert.match(renderFindResults(controller.state),/Results cover part of the project/u);
 controller.setExcludeImports(true);assert.deepEqual(controller.state.snapshot.coverage,coverage);
});
test("provider preferences never select absent candidates or interpret corrupt storage as authority",()=>{
 const candidates=[{qualifiedId:"one",label:"One"},{qualifiedId:"two",label:"Two"}];
 assert.equal(selectLanguageProvider(candidates,null).provider,null);
 assert.equal(selectLanguageProvider(candidates,"two").provider,candidates[1]);
 assert.equal(selectLanguageProvider(candidates.slice(0,1),"two").provider,null);
 assert.equal(selectLanguageProvider(candidates.slice(0,1),null).provider,candidates[0]);
 const corrupt=new LanguageProviderPreferences({getItem:()=>JSON.stringify([{root:"/repo",language:"kotlin",id:42}]),setItem(){throw Error("denied");}});
 assert.equal(corrupt.get("/repo","kotlin"),null);corrupt.set("/repo","kotlin","two");assert.equal(corrupt.get("/repo","kotlin"),"two");assert.equal(corrupt.get("/other","kotlin"),null);
});
