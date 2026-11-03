import assert from "node:assert/strict";
import test from "node:test";
import {setImmediate as tick} from "node:timers/promises";
import {FindLocationPreviews} from "../src/features/files-editor/find-location-previews.ts";
import {FindResultsController} from "../src/features/files-editor/find-results-controller.ts";

function snapshot(files=48,generation=1) {
  const c=new FindResultsController();
  c.installLocations({workspaceRoot:'/repo',workspaceGeneration:generation,query:'value',kind:'references',limited:false,
    locations:Array.from({length:files*2},(_,i)=>({uri:`file:///repo/file-${Math.floor(i/2)}.ts`,range:{start:{line:i%2,character:6},end:{line:i%2,character:11}}}))});
  return c.state.snapshot;
}
const source='const value = 1;\nconst value = 2;';

test('previews cover more than 32 distinct files, coalesce each file and never exceed three reads',async()=>{
  const s=snapshot(80);let active=0,peak=0,reads=0;const summaries=[];
  const loader=new FindLocationPreviews({current:()=>true,read:async()=>{reads++;active++;peak=Math.max(peak,active);await tick();active--;return source;},changed(){},idle:s=>summaries.push(s)});
  loader.reset(s);loader.request(s.locations.map((_,i)=>i));
  while(!summaries.length)await tick();
  assert.equal(peak,3);assert.equal(reads,80);assert.equal(loader.values.size,160);
  assert.equal(loader.values.get(159).found,'value');
  assert.deepEqual(summaries.at(-1),{files:80,loaded:80,ready:160,unavailable:0});
  loader.request([0,159]);await tick();assert.equal(reads,80);
});

test('fast scrolling replaces queued off-screen files while retaining completed previews',async()=>{
  const s=snapshot(),pending=[],reads=[];
  const loader=new FindLocationPreviews({current:()=>true,read:async(_root,l)=>{reads.push(l.uri);await new Promise(resolve=>pending.push(resolve));return source;},changed(){},idle(){}});
  loader.reset(s);loader.request([0,2,4,6,8,10]);assert.equal(reads.length,3);
  loader.request([94,95]);pending.splice(0).forEach(resolve=>resolve());await tick();
  assert.equal(reads.length,4);assert.equal(reads.at(-1),'file:///repo/file-47.ts');
  pending.splice(0).forEach(resolve=>resolve());await tick();
  assert.equal(loader.values.get(95).found,'value');
  loader.request([0,94]);await tick();assert.equal(reads.length,4);
});

test('snapshot replacement retains the concurrency bound and discards late reads after replacement or clear',async()=>{
  const pending=[],changed=[];let reads=0;
  const loader=new FindLocationPreviews({current:()=>true,read:async()=>{reads++;await new Promise(resolve=>pending.push(resolve));return source;},changed:indices=>changed.push(...indices),idle(){}});
  loader.reset(snapshot());loader.request([0,2,4,6]);assert.equal(reads,3);
  loader.reset(snapshot(8,2));loader.request([14]);assert.equal(reads,3);
  pending.splice(0).forEach(resolve=>resolve());await tick();
  assert.equal(reads,4);assert.equal(loader.values.size,0);assert.deepEqual(changed,[]);
  loader.reset(null);pending.splice(0).forEach(resolve=>resolve());await tick();
  assert.equal(loader.values.size,0);assert.deepEqual(changed,[]);
});

test('unreadable, oversized and invalid source locations settle unavailable without retries',async()=>{
  const s=snapshot(4);let reads=0;const summaries=[];
  const loader=new FindLocationPreviews({current:()=>true,read:async(_root,l)=>{reads++;if(l.uri.includes('file-0'))throw Error('unreadable');if(l.uri.includes('file-1'))return null;if(l.uri.includes('file-2'))return 'x'.repeat(512*1024+1);return '';},changed(){},idle:s=>summaries.push(s)});
  loader.reset(s);loader.request([0,2,4,6]);while(!summaries.length)await tick();
  assert.equal(loader.values.size,8);assert.ok([...loader.values.values()].every(v=>v===null));
  loader.request([0,2,4,6]);await tick();assert.equal(reads,4);
});

test('readonly source is previewed without disk access and a revoked workspace discards the response',async()=>{
  const s=snapshot(1);s.locations[0].readonlySource={path:'dep.ts',languageId:'typescript',text:source};
  let reads=0,current=true,release;const changed=[];
  const loader=new FindLocationPreviews({current:()=>current,read:async()=>{reads++;await new Promise(resolve=>release=resolve);return source;},changed:i=>changed.push(...i),idle(){}});
  loader.reset(s);loader.request([0]);await tick();assert.equal(reads,0);assert.equal(loader.values.get(0).found,'value');
  delete s.locations[0].readonlySource;loader.reset(s);loader.request([0]);current=false;release();await tick();
  assert.equal(loader.values.size,0);assert.deepEqual(changed,[0,1]);
});
