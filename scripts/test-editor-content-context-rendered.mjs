import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
import { mkdir,writeFile } from "node:fs/promises";
const out=process.env.ASTERLYN_EDITOR_CONTEXT_EVIDENCE;
if(out)await mkdir(out,{recursive:true});
const server=await createServer({root:process.cwd(),cacheDir:"node_modules/.vite-editor-content-context",server:{host:"127.0.0.1",port:0,hmr:false},plugins:[{name:"editor-content-menu-fixture",configureServer(vite){vite.middlewares.use("/__editor_content_menu",(_req,res)=>{res.setHeader("Content-Type","text/html");res.end('<!doctype html><html data-theme="light"><body><main id="editor" style="width:900px;height:600px"></main><script type="module" src="/scripts/fixtures/editor-content-context-fixture.ts"></script></body></html>');});}}]});
await server.listen();const port=server.httpServer.address().port,results=[];
try{for(const[name,engine]of[["chromium",chromium],["webkit",webkit]]){
 const browser=await engine.launch(),page=await browser.newPage({viewport:{width:1050,height:750}}),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 const call=(method,...args)=>page.evaluate(([method,args])=>window.editorContextFixture[method](...args),[method,args]);
 const snap=()=>call("snapshot");
 const right=async()=>{const point=await call("point");await page.mouse.click(point.x,point.y,{button:"right"});await page.locator('[role="menu"]').waitFor({timeout:3000});};
 const labels=()=>page.locator('[role="menuitem"]').allTextContents();
 const click=label=>page.getByRole("menuitem",{name:label,exact:true}).click({timeout:5000});
 try{
  await page.goto(`http://127.0.0.1:${port}/__editor_content_menu`,{waitUntil:"networkidle"});await page.waitForFunction(()=>!!window.editorContextFixture);
  assert.equal(await call("nativeFallbackSuppressed"),true);
  await call("reset");const original=(await snap()).content;await call("select");await right();
  assert.deepEqual(await labels(),["Cut","Copy","Paste","Find in Files"]);assert.equal((await snap()).selected,"value");
  await click("Copy");assert.equal((await snap()).clipboard,"value");assert.equal((await snap()).content,original);
  await right();await click("Find in Files");assert.deepEqual((await snap()).calls,[["find","value"]]);
  await right();await click("Cut");await page.waitForFunction(()=>window.editorContextFixture.snapshot().content!=="\uFEFFconst value = '😀';\r\nconst other = value;\r\n");
  assert.equal((await snap()).content,original.replace("value",""));await call("undo");assert.equal((await snap()).content,original);
  await call("select");await call("configure",{clipboard:"替换😀"});await right();await click("Paste");await page.waitForFunction(()=>window.editorContextFixture.snapshot().content.includes("替换😀"));assert.equal((await snap()).content,original.replace("value","替换😀"));
  await call("undo");assert.equal((await snap()).content,original);
  await call("caret");await right();assert.deepEqual(await labels(),["Paste","Reveal in File Manager","Show History"]);
  await click("Reveal in File Manager");assert.equal((await snap()).calls.at(-1),"reveal");
  await right();await click("Show History");assert.equal((await snap()).calls.at(-1),"history");
  await call("configure",{changed:true});await right();assert.deepEqual(await labels(),["Paste","Reveal in File Manager","Show History","Show Diff","Rollback"]);
  const bounds=await page.locator('[role="menu"]').boundingBox();assert.ok(bounds.width>=220&&bounds.x>=0&&bounds.y>=0&&bounds.y+bounds.height<=750);
  if(out)await page.screenshot({path:`${out}/${name}-caret.png`});
  await click("Show Diff");assert.equal((await snap()).calls.at(-1),"diff");await right();await click("Rollback");assert.equal((await snap()).calls.at(-1),"rollback");
  await call("reset");await call("select");await call("configure",{fail:true});await right();await click("Cut");await page.waitForFunction(()=>window.editorContextFixture.snapshot().errors.length===1);assert.equal((await snap()).content,original);
  await call("configure",{fail:false,pending:true});await right();await click("Paste");await call("switch");await call("release");await page.waitForFunction(()=>window.editorContextFixture.snapshot().statuses.includes("The source or selection changed. Open the menu again."));assert.equal((await snap()).content,original);assert.ok((await snap()).calls.some(call=>Array.isArray(call)&&call[0]==="viewReused"&&call[1]===true));
  await call("reset",true);await call("select");await right();assert.equal(await page.getByRole("menuitem",{name:"Cut",exact:true}).getAttribute("aria-disabled"),"true");assert.equal(await page.getByRole("menuitem",{name:"Paste",exact:true}).getAttribute("aria-disabled"),"true");await click("Copy");assert.equal((await snap()).clipboard,"value");
  await call("reset");await call("multiple");await right();await click("Copy");assert.equal((await snap()).clipboard,"value\nvalue");
  await right();await click("Cut");await page.waitForFunction(()=>!window.editorContextFixture.snapshot().content.includes("value"));await call("undo");assert.equal((await snap()).content,original);
  await call("reset");await call("select");await page.keyboard.press("Shift+F10");await page.locator('[role="menu"]').waitFor();assert.deepEqual(await labels(),["Cut","Copy","Paste","Find in Files"]);await page.keyboard.press("Escape");assert.equal((await snap()).focused,true);assert.equal((await snap()).selected,"value");
  const ctrlPoint=await call("point");await call("configure",{claimContext:true});await page.keyboard.down("Control");
  await page.mouse.click(ctrlPoint.x,ctrlPoint.y,{button:"right"});
  assert.equal(await page.locator('[role="menu"]').count(),0,`${name}: feature-consumed context event must not open another menu`);
  await call("configure",{claimContext:false});await page.mouse.click(ctrlPoint.x,ctrlPoint.y,{button:"right"});await page.keyboard.up("Control");await page.locator('[role="menu"]').waitFor();await page.keyboard.press("Escape");
  const gutter=await page.locator('.cm-gutters').boundingBox();await page.mouse.click(gutter.x+4,gutter.y+12,{button:"right"});await page.locator('[role="menu"]').waitFor();assert.equal((await snap()).owner,"editor.text.git-blame");await page.keyboard.press("Escape");
  await call("select");await right();if(out)await page.screenshot({path:`${out}/${name}-selection.png`});await page.keyboard.press("Escape");
  assert.deepEqual(errors,[]);results.push({browser:name,productionLazyHost:true,consumedGesturePreserved:true,selection:true,multiRange:true,cutCopyPaste:true,reusedViewSafe:true,unicodeAndCrlfUndo:true,find:true,changedOnlyActions:true,latePasteRejected:true,readOnly:true,keyboard:true,gutterIsolated:true});console.log(`${name}: editor menus, clipboard/undo, file routes, async safety and gutter isolation passed`);
 }catch(error){console.error(name,JSON.stringify({errors,snapshot:await snap().catch(()=>null)}));throw error;}finally{await call("dispose").catch(()=>{});await browser.close();}
}}finally{await server.close();if(out)await writeFile(`${out}/rendered.json`,JSON.stringify(results,null,2));}
