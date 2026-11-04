import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
const server=await createServer({root:process.cwd(),server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'find-font-fixture',configureServer(vite){vite.middlewares.use('/__find_fonts',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><main class="app-shell" style="display:block;min-width:0;width:900px"><div id="editor-font" style="font:20px monospace">Code</div><div id="rem-probe" style="width:1rem"></div></main><script type="module" src="/scripts/fixtures/find-typography-fixture.ts"></script></body></html>');});}}]});
await server.listen();const results=[];
try{
 for(const [engineName,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await engine.launch(),page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__find_fonts`);await page.waitForFunction(()=>window.findResultsFixture);
   for(const theme of ['light','dark'])for(const size of [13,11,16])for(const kind of ['references','text']){
    await page.evaluate(({size,theme,kind})=>{document.documentElement.style.setProperty('--ui-font-size',`${size}px`);document.documentElement.dataset.theme=theme;const f=window.findResultsFixture;f.reset();f.state.indented=true;if(kind==='references')f.runtime.openLocations({workspaceRoot:'/repo',workspaceGeneration:1,kind:'references',query:'value',referenceAnalysis:{imports:[],previews:[]},locations:f.locations(8),limited:false});else f.openSearch();},{size,theme,kind});
    await page.locator('[data-find-result="0"] mark').waitFor();
    for(const view of ['tree','flat']){
     if(view==='tree'&&await page.getByRole('button',{name:'Show files as directory tree'}).count())await page.getByRole('button',{name:'Show files as directory tree'}).click();
     if(view==='flat')await page.getByRole('button',{name:'Show files as flat list'}).click();
     const actual=await page.evaluate(()=>{
      const font=selector=>{const el=document.querySelector(selector);if(!el)return null;const c=getComputedStyle(el);return {size:c.fontSize,family:c.fontFamily,weight:c.fontWeight,lineHeight:c.lineHeight};};
      return {code:font('.find-match-row code'),mark:font('.find-match-row mark'),line:font('.find-match-row .search-result-location'),file:font('.find-group-row.file .find-file-name'),directory:font('.find-group-row.directory .find-file-name'),count:font('.find-group-row small'),title:font('.find-results-summary>strong'),summary:font('.find-results-summary>small'),checkbox:font('.find-results-summary .language-exclude-imports'),hostCode:font('#find-font-host .workspace-search-result code'),hostLine:font('#find-font-host .search-result-location'),hostFile:font('#find-font-host .project-file-row .project-node-label'),hostDirectory:font('#find-font-host .project-directory-row .project-node-label'),hostCount:font('#find-font-host .compact-file-tree-count'),editor:font('#find-code-font-probe'),remWidth:document.querySelector('#find-rem-probe').getBoundingClientRect().width,htmlSize:getComputedStyle(document.documentElement).fontSize};
     });
     const label=`${engineName}/${theme}/${size}/${kind}/${view}`;
     assert.deepEqual(actual.code,actual.hostCode,`${label}: code preview matches host search summary`);
     assert.equal(actual.mark.size,actual.code.size,`${label}: matches do not enlarge text`);
     assert.equal(actual.code.size,`${Math.max(10,size-2)}px`);
     assert.equal(actual.line.size,actual.hostLine.size);assert.equal(actual.line.size,`${Math.max(9,size-4)}px`);
     assert.equal(actual.title.size,`${size}px`);assert.equal(actual.summary.size,`${Math.max(10,size-2)}px`);
     if(kind==='references')assert.equal(actual.checkbox.size,`${size}px`);
     if(view==='tree'){
      for(const [current,host] of [['file','hostFile'],['directory','hostDirectory'],['count','hostCount']])for(const property of ['size','family','weight'])assert.equal(actual[current][property],actual[host][property],`${label}: ${current} ${property} matches host tree`);
      assert.equal(actual.file.size,`${size}px`);assert.equal(actual.count.size,`${Math.max(9,size-3)}px`);
     }
     const geometry=await page.locator('[data-find-result="0"]').evaluate(row=>{
      const code=row.querySelector('code'),position=row.querySelector('.search-result-location');
      const siblings=[...row.parentElement.children],file=siblings.slice(0,siblings.indexOf(row)).findLast(el=>el.matches('[data-find-node^="file:"]'));
      return {first:row.firstElementChild.className,last:row.lastElementChild.tagName,text:code.textContent,codeLeft:code.getBoundingClientRect().left,codeRight:code.getBoundingClientRect().right,positionLeft:position.getBoundingClientRect().left,positionRight:position.getBoundingClientRect().right,rowRight:row.getBoundingClientRect().right,fileLeft:file?.querySelector('.find-file-name').getBoundingClientRect().left,position:position.textContent};
     });
     assert.equal(geometry.first,'search-result-location',`${label}: position stays first`);assert.equal(geometry.last,'CODE');
     assert.match(geometry.text,/^const /,`${label}: leading spaces and tabs are removed`);
     assert.ok(geometry.codeLeft>=geometry.positionRight+7,`${label}: code follows the position column`);
     assert.ok(geometry.positionRight<=geometry.rowRight,`${label}: position stays visible`);
     assert.match(geometry.position,/\d+:\d+$/u,`${label}: both line and column remain visible`);
     assert.equal(actual.editor.size,'20px');assert.equal(actual.remWidth,16);assert.equal(actual.htmlSize,'16px');results.push({engine:engineName,theme,size,kind,view,actual,geometry});
    }
   }
   // Long source lines are elided after leading positions, including flat rows with long names.
   await page.evaluate(()=>{const f=window.findResultsFixture;f.reset();document.querySelector('main').style.width='360px';f.runtime.openLocations({workspaceRoot:'/repo',workspaceGeneration:1,kind:'references',query:'needle',locations:[{uri:'file:///repo/src/a-very-long-file-name-for-a-narrow-panel.ts',range:{start:{line:263,character:16},end:{line:263,character:22}}}],limited:false,referenceAnalysis:{imports:[],previews:[{index:0,preview:{before:'\t    const x = ',found:'needle',after:' + abcdefghij'.repeat(30),leading:false,trailing:true}}]}});});
   for(const view of ['tree','flat']){
    const switcher=page.getByRole('button',{name:view==='tree'?'Show files as directory tree':'Show files as flat list'});if(await switcher.count())await switcher.click();
    const narrow=await page.locator('[data-find-result="0"]').evaluate(row=>{const code=row.querySelector('code'),position=row.querySelector('.search-result-location');return {clipped:code.scrollWidth>code.clientWidth,ellipsis:getComputedStyle(code).textOverflow,position:position.textContent,right:position.getBoundingClientRect().right,rowRight:row.getBoundingClientRect().right};});
    assert.equal(narrow.clipped,true);assert.equal(narrow.ellipsis,'ellipsis');assert.match(narrow.position,/264:17$/u);assert.ok(narrow.right<=narrow.rowRight);
   }
   await page.evaluate(()=>document.querySelector('main').style.width='900px');
   // Loading feedback uses the same bounded preview typography; no editor/rem resizing.
   await page.evaluate(()=>{const f=window.findResultsFixture;f.reset();f.state.defer=true;f.runtime.openLocations({workspaceRoot:'/repo',workspaceGeneration:1,kind:'references',query:'value',referenceAnalysis:{imports:[],previews:[]},locations:f.locations(2),limited:false});});
   await page.getByText('Loading preview…',{exact:true}).first().waitFor();
   assert.equal(await page.locator('.find-preview-status').first().evaluate(e=>getComputedStyle(e).fontSize),'14px');
   await page.evaluate(()=>window.findResultsFixture.release());await page.locator('[data-find-result="0"] mark').waitFor();assert.deepEqual(errors,[]);
   console.log(`${engineName}: 24 Find reference/text tree/flat font/layout cases align with host at 11/13/16px in light/dark`);
  }finally{await browser.close();}
 }
}finally{await server.close();await mkdir('target/find-typography',{recursive:true});await writeFile('target/find-typography/summary.json',JSON.stringify({schema:1,results},null,2)+'\n');}
