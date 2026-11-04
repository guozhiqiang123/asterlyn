import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
const server=await createServer({root:process.cwd(),server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'portal-font-fixture',configureServer(vite){vite.middlewares.use('/__portal-fonts',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><style>#host-search{position:fixed;left:0;top:0;width:600px}#host-search .command-surface{position:static;width:100%}</style></head><body><main id="shell" class="app-shell"><button id="shell-control">Workbench</button><div id="editor-font" style="font:20px monospace">Code font</div><div id="rem-unit" style="width:1rem"></div></main><script type="module" src="/scripts/fixtures/portal-typography-fixture.ts"></script></body></html>');});}}]});
await server.listen();const results=[];
// Read computed values from the actual host renderer and real body-mounted popup owners.
const presentation=root=>{
 const host=root.id==='host-search',input=root.querySelector(host?'textarea':'input[type=search]'),field=host?root.querySelector('.command-surface-input'):input;
 const css=(element,properties,pseudo)=>{const c=getComputedStyle(element,pseudo);return Object.fromEntries(properties.map(key=>[key,key==='userSelect'?(c.userSelect??c.webkitUserSelect):c[key]]));};
 const fieldStyle=()=>css(field,['borderTopStyle','borderTopWidth','borderTopColor','borderRadius','backgroundColor','boxShadow','outlineStyle','outlineWidth']);
 input.blur();const normal=fieldStyle();input.focus();const focused=fieldStyle();
 const row=root.querySelector('[role=option][aria-selected=true]'),secondary=row.querySelector(host?'.command-result-copy small':'small,span:last-child'),other=root.querySelector('[role=option][aria-selected=false]');
 const text=input;
 return {normal,focused,caret:css(text,['caretColor']),placeholder:css(text,['color'],'::placeholder'),textSelection:css(text,['color','backgroundColor'],'::selection'),unselected:{row:css(other,['backgroundColor','color','borderRadius','cursor']),secondary:css(other.querySelector(host?'.command-result-copy small':'small,span:last-child'),['color'])},selected:css(row,['backgroundColor','color','borderRadius','cursor','userSelect']),secondary:css(secondary,['color']),tokens:{selection:getComputedStyle(document.documentElement).getPropertyValue('--selection-bg').trim(),foreground:getComputedStyle(document.documentElement).getPropertyValue('--selection-text').trim()}};
};
try{
 for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await engine.launch(),page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__portal-fonts`,{waitUntil:'networkidle'});
   for(const theme of ['light','dark'])for(const size of [13,16,11]){
    await page.evaluate(({size,theme})=>window.portalFonts.set(size,theme),{size,theme});
    const host=await page.locator('#host-search').evaluate(presentation);
    for(const kind of ['references','symbols']){
     await page.mouse.move(999,699);
     await page.evaluate(kind=>window.portalFonts[kind](),kind);
     const popup=page.locator(kind==='references'?'.language-location-picker':'.project-symbols');
     await popup.locator('[role=option]').first().waitFor();
     const label=`${name}/${kind}/${theme}/${size}`;
     const actual=await popup.evaluate(root=>{const font=e=>{const c=getComputedStyle(e);return {size:c.fontSize,family:c.fontFamily,weight:c.fontWeight};};return {body:font(document.body),shell:font(document.querySelector('#shell-control')),root:font(root),input:font(root.querySelector('input[type=search]')),option:font(root.querySelector('[role=option]')),heading:font(root.querySelector('h2,strong')),control:font(root.querySelector('button')),secondary:font(root.querySelector('[role=option] small,[role=option] span:last-child')),editor:font(document.querySelector('#editor-font')),rootSize:getComputedStyle(document.documentElement).fontSize,remWidth:document.querySelector('#rem-unit').getBoundingClientRect().width,insideShell:!!root.closest('.app-shell')};});
     for(const target of ['body','shell','root','input','option','control']){
      assert.equal(actual[target].size,`${size}px`,`${label}: ${target} follows UI size`);
      assert.equal(actual[target].family,actual.shell.family,`${label}: ${target} shares UI family`);
     }
     if(kind==='symbols')assert.equal(actual.secondary.size,`${Math.max(10,size-1)}px`,'symbol details follow UI size');
     assert.equal(actual.heading.size,`${kind==='symbols'?size+2:size}px`,`${label}: heading follows UI size`);
     assert.equal(actual.editor.size,'20px');assert.equal(actual.rootSize,'16px');assert.equal(actual.remWidth,16);assert.equal(actual.insideShell,false);
     const styles=await popup.evaluate(presentation);
     for(const key of ['normal','focused','caret','placeholder','textSelection','unselected','selected','secondary'])assert.deepEqual(styles[key],host[key],`${label}: ${key} aligns with host search`);
     assert.equal(styles.normal.borderTopStyle,'solid');assert.equal(styles.normal.borderTopWidth,'1px');assert.equal(styles.normal.borderRadius,'5px');
     assert.equal(styles.focused.outlineStyle,'none','one host focus ring, without native input outline');
     assert.equal(styles.textSelection.backgroundColor,styles.selected.backgroundColor,'text and row selection share host background');
     assert.equal(styles.textSelection.color,styles.selected.color,'text and row selection share host foreground');
     assert.equal(styles.selected.userSelect,'none','list selection must not select labels as text');
     const input=popup.locator('input[type=search]');
     await input.press('ArrowDown');
     assert.equal(await popup.locator('[role=option]').nth(1).getAttribute('aria-selected'),'true',`${label}: keyboard moves selection`);
     assert.equal(await input.evaluate(el=>document.activeElement===el),true,`${label}: focus stays in search`);
     const second=popup.locator('[role=option]').nth(1);
     await second.hover();
     assert.deepEqual(await second.evaluate(el=>{const c=getComputedStyle(el);return {backgroundColor:c.backgroundColor,color:c.color};}),{backgroundColor:host.selected.backgroundColor,color:host.selected.color},`${label}: hovering selected row retains host colors`);
     const first=popup.locator('[role=option]').first();await first.hover();
     if(kind==='references')assert.equal(await first.getAttribute('aria-selected'),'true','pointer selection retained');
     else assert.equal(await first.evaluate(el=>getComputedStyle(el).backgroundColor),await page.evaluate(()=>{const probe=document.createElement('i');probe.style.color='var(--bg-hover)';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;}),'unselected symbol hover follows host surface');
     const editing=await input.evaluate(el=>{el.value='example';el.setSelectionRange(1,5);return [el.selectionStart,el.selectionEnd];});assert.deepEqual(editing,[1,5],'text selection remains editable');
     results.push({engine:name,kind,theme,size,actual,styles,host});await page.evaluate(()=>window.portalFonts.close());
    }
   }
   assert.deepEqual(errors,[]);
   console.log(`${name}: 12 real popups align with host search/focus/selection/hover; 11/13/16px fonts, editor sizing and keyboard selection pass`);
  }finally{await browser.close();}
 }
}finally{await server.close();await mkdir('target/portal-typography',{recursive:true});await writeFile('target/portal-typography/summary.json',JSON.stringify({schema:2,results},null,2)+'\n');}
