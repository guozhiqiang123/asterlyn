import assert from 'node:assert/strict';
import test from 'node:test';
import {importRanges,analyzeReferenceLocations} from '../src/application/language-services/reference-imports.ts';
import {FindResultsController} from '../src/features/files-editor/find-results-controller.ts';
import {renderFindResults} from '../src/features/files-editor/find-results-view.ts';
import {EN_US} from '../src/localization/en-US.ts';

function flags(text,path){const ranges=importRanges(text,path);return [...text.matchAll(/Target/gu)].map(m=>ranges.some(r=>m.index>=r.from&&m.index<r.to));}
const cases=[
 ['a.ts','import {\n Target as Alias,\n} from "./module"; const v=Target;', [true,false]],
 ['a.tsx','import type {Target} from "x"; const element=<Target/>;',[true,false]],
 ['a.mts','import Target = require("x"); Target();',[true,false]],
 ['a.cts','import type Target = require("x"); let x:Target;',[true,false]],
 ['a.js','import Target from "x"\nTarget();',[true,false]],
 ['a.jsx','import {Target} from "x" with { type: "json" };\n<Target/>;',[true,false]],
 ['a.mjs','import Target from "x" assert {type:"json"}; Target();',[true,false]],
 ['a.cjs','const x=import("Target"); const y=require("Target");',[false,false]],
 ['a.java','import\n static pkg.Target.member; class C { Target value; }',[true,false]],
 ['a.java','import pkg.Target; class C { Target value; }',[true,false]],
 ['a.kt','import pkg.Target as Alias\nval x=Target()',[true,false]],
 ['a.kts','import pkg.\n Target\nval x=Target()',[true,false]],
 ['a.groovy','import static pkg.Target.member as alias\nTarget x',[true,false]],
 ['a.gradle','import pkg.Target; Target x',[true,false]],
 ['a.rs','pub(crate) use crate::{\n Target as Alias, foo::{Bar}\n}; fn f(){let x:Target;}',[true,false]],
 ['a.rs','fn f(){ use crate::Target; let x:Target; }',[true,false]],
 ['a.rs','extern crate Target as alias; type X=Target;',[true,false]],
 ['a.rs',"fn f<'a>(){}\nuse crate::Target; type T=Target;",[true,false]],
 ['a.kt','val s="""\nimport pkg.Target\n"""\n// import Target\n/* import Target */\nval x=Target()', [false,false,false,false]],
 ['a.ts','const s=`\nimport {Target} from "x"`;\nconst r=/import Target from "x"/;\nconst v=Target;', [false,false,false]],
 ['a.groovy','def s=$/\nimport pkg.Target\n/$\ndef r=/\nimport pkg.Target\n/\nTarget x',[false,false,false]],
 ['a.rs','const S:&str=r##"\nuse crate::Target;\n"##; /* outer /* inner */ use Target; */ let x:Target;',[false,false,false]],
 ['a.ts','export {Target} from "x"; type T=import("x").Target; obj.import(Target);',[false,false,false]],
 ['a.ts','import {Target\nconst x=Target;', [false,false]],
 ['a.ts','import {Target} from "x\nconst x=Target;', [false,false]],
 ['a.unknown','import Target\nTarget',[false,false]],
];
for(const[path,text,expected]of cases)test(`import categories ${path}: ${text.slice(0,40)}`,()=>assert.deepEqual(flags(text,path),expected));

test('analysis coalesces file reads, preserves UTF16/CRLF and produces reusable detached previews',async()=>{
 const text='// 😀\r\nimport { Target } from "x"; Target();\r\n';
 const locations=[7,27].map(character=>({uri:'file:///repo/a.ts',range:{start:{line:1,character},end:{line:1,character:character+6}}}));
 // Use exact source offsets rather than assuming ASCII prefix length.
 const line=text.split('\n')[1];locations[0].range.start.character=line.indexOf('Target');locations[0].range.end.character=line.indexOf('Target')+6;locations[1].range.start.character=line.lastIndexOf('Target');locations[1].range.end.character=line.lastIndexOf('Target')+6;
 let reads=0;const analysis=await analyzeReferenceLocations(locations,async()=>{reads++;return text;},()=>true);
 assert.equal(reads,1);assert.deepEqual(analysis.imports,[0]);assert.equal(analysis.previews[1].preview.found,'Target');
});

test('unknown sources remain in the full result, late classification cannot replace another workspace',async()=>{
 const locations=[{uri:'file:///repo/a.kt',range:{start:{line:0,character:0},end:{line:0,character:6}}}];
 const result=await analyzeReferenceLocations(locations,async()=>null,()=>true);assert.deepEqual(result.imports,[]);
 let current=true,release;const pending=analyzeReferenceLocations(locations,async()=>{await new Promise(r=>release=r);return 'import Target';},()=>current);current=false;release();assert.equal(await pending,null);
});

test('Find filters original indices and counts, restores import-only files and retains full snapshots',()=>{
 const locations=['import.ts','usage.ts','usage.ts'].map((file,i)=>({uri:'file:///repo/'+file,range:{start:{line:i,character:0},end:{line:i,character:6}}}));
 const c=new FindResultsController();c.installLocations({workspaceRoot:'/repo',workspaceGeneration:1,kind:'references',query:'Target',locations,limited:false,referenceAnalysis:{imports:[0,1],previews:[]}});
 assert.equal(c.state.snapshot.locations.length,3);assert.equal(c.selectedLocation().range.start.line,2);assert.equal(c.state.resultTree.length,1);assert.match(renderFindResults(c.state),/1 match</);assert.equal(c.select(0),false);
 c.setExcludeImports(false);assert.equal(c.state.resultTree.length,2);assert.equal(c.select(0),true);c.setExcludeImports(true);assert.equal(c.state.selectedIndex,2);
 c.setReferenceAnalysis({imports:[0,1,2],previews:[]});assert.equal(c.state.resultTree.length,0);assert.equal(c.selectedLocation(),null);assert.match(renderFindResults(c.state),/No matching locations/);assert.match(renderFindResults(c.state),/data-find-exclude-imports checked/);
 c.setExcludeImports(false);assert.equal(c.state.resultTree.length,2);assert.equal(c.state.snapshot.locations.length,3);
});
