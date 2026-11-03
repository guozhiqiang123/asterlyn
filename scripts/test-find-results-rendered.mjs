import assert from "node:assert/strict";
import {chromium,webkit} from "playwright";
import {createServer} from "vite";
import {readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {resolve,sep} from "node:path";
import {pathToFileURL} from "node:url";

// Optional read-only real-project sample; source text stays inside the local fixture.
let realSample=null;
if(process.env.ASTERLYN_FIND_TEST_PROJECT){
 const project=resolve(process.env.ASTERLYN_FIND_TEST_PROJECT),result=spawnSync('rg',['--json','--word-regexp','--glob','*.kt','--glob','*.java','Env_ST',project],{encoding:'utf8',maxBuffer:8*1024*1024});
 assert.equal(result.status,0);const locations=[],sources=new Map();
 for(const line of result.stdout.trim().split('\n')){
  const event=JSON.parse(line);if(event.type!=='match')continue;
  const data=event.data,path=resolve(data.path.text);assert.ok(path.startsWith(project+sep));
  const uri=pathToFileURL(path).href;
  if(!sources.has(uri))sources.set(uri,await readFile(path,'utf8'));
  for(const match of data.submatches){const from=Buffer.from(data.lines.text).subarray(0,match.start).toString('utf8').length;locations.push({uri,range:{start:{line:data.line_number-1,character:from},end:{line:data.line_number-1,character:from+6}}});}
 }
 const bounded=locations.slice(0,512),uris=new Set(bounded.map(l=>l.uri));assert.ok(uris.size>32);realSample={project,locations:bounded,sources:[...sources].filter(([uri])=>uris.has(uri))};
}
const server=await createServer({root:process.cwd(),server:{host:"127.0.0.1",port:0,hmr:false},plugins:[{name:"find-results-fixture",configureServer(vite){vite.middlewares.use("/__find_results",(_req,res)=>{res.setHeader("Content-Type","text/html");res.end('<!doctype html><html><head><style>:root{--compact-file-tree-indent:16px;--compact-file-tree-row-height:25px;--compact-file-tree-row-gap:6px;--compact-file-tree-row-padding-inline:6px;--compact-file-tree-row-leading:6px;--text:#222;--text-muted:#666;--bg-panel:white;--accent-soft:#dae7fc;--selection-bg:#dae7fc;--ui-font-size:13px}body{font:13px sans-serif}main{width:900px}button{font:inherit}</style></head><body><main></main><script type="module" src="/scripts/fixtures/find-results-fixture.ts"></script></body></html>');});}}]});
await server.listen();const port=server.httpServer.address().port;
try{for(const[name,engine]of[["Chromium",chromium],["WebKit",webkit]]){
 const browser=await engine.launch(),page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
 try{await page.goto(`http://127.0.0.1:${port}/__find_results`);await page.waitForFunction(()=>window.findResultsFixture);
  await page.evaluate(()=>window.findResultsFixture.openPicker());await page.getByRole('combobox').fill('common');assert.equal(await page.locator('.language-location-results>button').count(),34);
  await page.getByRole('button',{name:'Open in Window',exact:true}).click();await page.waitForSelector('.find-result-tree[role="tree"]');assert.equal(await page.locator('.language-location-picker').count(),0);assert.equal(await page.locator('[data-find-result]').count(),69);assert.equal(await page.locator('[data-find-node^="file:"]').count(),2);await page.waitForFunction(()=>window.findResultsFixture.state.reads===1);await page.waitForSelector('.find-match-row mark');
  assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-find-result')),true);const first=page.locator('[data-find-result="0"]');await first.click();assert.equal(await page.evaluate(()=>window.findResultsFixture.state.opened.at(-1).location.range.start.line),2);
  const group=page.locator('[data-find-node="file:file:///repo/app/deep/pkg/shared.ts"]');await group.click();assert.equal(await page.locator('[data-find-result]').count(),34);await group.press('ArrowRight');assert.equal(await page.locator('[data-find-result]').count(),69);await page.locator('[data-find-result="0"]').press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-find-node')),'file:file:///repo/app/deep/pkg/shared.ts');
  await page.locator('[data-find-result="0"]').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.findResultsFixture.state.opened.length),2);
  await page.evaluate(()=>{window.findResultsFixture.state.generation++;});await first.click();assert.equal(await page.evaluate(()=>window.findResultsFixture.state.wrong),1);
  await page.evaluate(()=>{const f=window.findResultsFixture;f.reset();f.state.defer=true;f.openPicker();});await page.getByRole('button',{name:'Open in Window',exact:true}).click();await page.waitForFunction(()=>window.findResultsFixture.state.reads===1);await page.evaluate(()=>{window.findResultsFixture.openSearch();window.findResultsFixture.release();});await page.waitForTimeout(50);assert.match(await page.locator('.find-results-summary').innerText(),/needle/);assert.equal(await page.locator('[data-find-result]').count(),1);
  await page.evaluate(()=>{window.findResultsFixture.reset();window.findResultsFixture.openPicker();});await page.getByRole('button',{name:'Open in Window',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForSelector('.find-result-tree');assert.equal(await page.locator('.language-location-picker').count(),0);
  await page.evaluate(()=>{const f=window.findResultsFixture;f.reset();f.runtime.openLocations({workspaceRoot:'/repo',workspaceGeneration:1,kind:'references',query:'value',limited:false,locations:Array.from({length:48},(_,index)=>({uri:`file:///repo/src/file-${String(index).padStart(3,'0')}.ts`,range:{start:{line:2,character:6},end:{line:2,character:11}}}))});});
  await page.locator('[data-find-result="0"] mark').waitFor();
  assert.ok(await page.evaluate(()=>window.findResultsFixture.state.reads<48),'off-screen files must not all be read eagerly');
  await page.locator('[data-find-result="47"]').scrollIntoViewIfNeeded();
  await page.locator('[data-find-result="47"] mark').waitFor({timeout:2000});
  assert.equal(await page.locator('[data-find-result="47"] mark').innerText(),'value','scrolling beyond 32 files must load its source preview');
  await page.locator('[data-find-result="47"]').focus();
  await page.getByRole('button',{name:'Show files as flat list'}).click();
  await page.locator('[data-find-result="47"] mark').waitFor();
  await page.getByRole('button',{name:'Show files as directory tree'}).click();
  await page.locator('[data-find-result="47"] mark').waitFor();
  for(let index=0;index<48;index++){
   const row=page.locator(`[data-find-result="${index}"]`);await row.scrollIntoViewIfNeeded();await row.locator('mark').waitFor();
  }
  assert.equal(await page.locator('.find-preview-status').count(),0);
  assert.equal(await page.evaluate(()=>window.findResultsFixture.state.reads),48,'each file is read once across scrolling and view switches');
  assert.ok(await page.evaluate(()=>window.findResultsFixture.state.maxReads<=3));
  await page.locator('[data-find-result="47"]').click();assert.equal(await page.evaluate(()=>window.findResultsFixture.state.opened.at(-1).location.range.start.line),2);
  for(const failure of ['fail','oversized']){
   await page.evaluate(failure=>{const f=window.findResultsFixture;f.reset();f.state[failure]=true;f.openPicker(2);},failure);
   await page.getByRole('button',{name:'Open in Window',exact:true}).click();
   await page.getByText('Preview unavailable',{exact:true}).first().waitFor();
   assert.equal(await page.locator('code').filter({hasText:'Preview unavailable'}).count(),2);
   await page.locator('[data-find-result="0"]').click();assert.equal(await page.evaluate(()=>window.findResultsFixture.state.opened.length),1);
  }
  await page.evaluate(()=>{const f=window.findResultsFixture;f.reset();f.state.defer=true;f.openPicker(2);});
  await page.getByRole('button',{name:'Open in Window',exact:true}).click();
  await page.waitForFunction(()=>window.findResultsFixture.state.reads===2);
  assert.equal(await page.getByText('Loading preview…',{exact:true}).count(),2);
  await page.locator('[data-find-result="1"]').focus();
  const focused=await page.locator('.find-results-list').evaluate(e=>e.scrollTop);
  await page.evaluate(()=>window.findResultsFixture.release());await page.locator('[data-find-result="1"] mark').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-find-result')),'1');
  assert.equal(await page.locator('.find-results-list').evaluate(e=>e.scrollTop),focused,'hydration preserves scroll and DOM focus');
  if(realSample){
   await page.evaluate(sample=>{const f=window.findResultsFixture;f.reset();f.state.root=sample.project;f.state.sources=new Map(sample.sources);f.runtime.openLocations({workspaceRoot:sample.project,workspaceGeneration:1,kind:'references',query:'Env_ST',limited:false,locations:sample.locations});},realSample);
   const files=new Set();for(const[index,location]of realSample.locations.entries()){
    if(files.has(location.uri))continue;files.add(location.uri);
    const row=page.locator(`[data-find-result="${index}"]`);await row.scrollIntoViewIfNeeded();await row.locator('mark').waitFor();assert.equal(await row.locator('mark').innerText(),'Env_ST');
   }
   assert.equal(await page.locator('.find-preview-status').count(),0);assert.equal(await page.evaluate(()=>window.findResultsFixture.state.reads),files.size);assert.ok(await page.evaluate(()=>window.findResultsFixture.state.maxReads<=3));
   console.log(JSON.stringify({engine:name,realProjectFiles:files.size,realProjectLocations:realSample.locations.length,blankPreviews:0}));
  }
  const performance=await page.evaluate(()=>{const f=window.findResultsFixture;f.reset();const start=performance.now();f.runtime.openLocations({workspaceRoot:'/repo',workspaceGeneration:1,kind:'references',query:'bounded',locations:f.locations(512),limited:true});return {renderMs:performance.now()-start,rows:document.querySelectorAll('[data-find-result]').length};});assert.equal(performance.rows,512);assert.ok(performance.renderMs<2000,JSON.stringify(performance));assert.deepEqual(errors,[]);console.log(JSON.stringify({engine:name,success:true,...performance}));
 }finally{await browser.close();}
}}finally{await server.close();}
