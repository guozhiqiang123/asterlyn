import assert from "node:assert/strict";
import {chromium,webkit} from "playwright";
import {createServer} from "vite";
const server=await createServer({root:process.cwd(),server:{host:"127.0.0.1",port:0,hmr:false},plugins:[{name:"language-status-fixture",configureServer(vite){vite.middlewares.use("/__language-status",(_req,res)=>{res.setHeader("Content-Type","text/html");res.end('<!doctype html><html><body><input id="outside" aria-label="Editor"><footer style="position:fixed;bottom:0;width:100%;display:flex"><span id="status-message">Ready</span></footer><script type="module" src="/scripts/fixtures/language-service-status-fixture.ts"></script></body></html>');});}}]});
await server.listen();
try{for(const [name,engine] of [["Chromium",chromium],["WebKit",webkit]]){
 const browser=await engine.launch(),page=await browser.newPage({viewport:{width:900,height:600},reducedMotion:"reduce"}),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 const update=value=>page.evaluate(value=>window.languageStatusFixture.update(value),value),snapshot=()=>page.evaluate(()=>window.languageStatusFixture.snapshot());
 try{
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__language-status`,{waitUntil:"networkidle"});
  const status=page.locator("#language-service-status"),panel=page.locator("#language-service-details");
  assert.match(await status.innerText(),/Loading project model/u);assert.equal(await status.getAttribute("data-busy"),"true");const busyIntervals=(await snapshot()).intervals;assert.ok(busyIntervals>=1);
  await status.click();await page.waitForSelector('#language-service-details:not([hidden])');assert.equal(await panel.getAttribute("aria-modal"),"false");assert.equal(await page.locator("progress").count(),0,"unknown work must not invent percentages");
  await update({progress:{phase:"sources",completed:2,total:6,unit:"modules"}});assert.match(await status.innerText(),/2\/6/u);assert.equal(await page.locator("progress").getAttribute("max"),"6");
  await update({state:"ready",progress:{phase:"backend"}});assert.equal(await status.getAttribute("data-busy"),"true","a lazy module can warm while Java remains usable");
  await update({state:"failed",code:"repository-credentials-missing",progress:{phase:"failed"}});assert.equal(await status.getAttribute("data-busy"),"false");assert.equal((await snapshot()).intervals,busyIntervals-1);assert.equal(await panel.locator("code").count(),0);
  await panel.getByLabel("Debug tracing",{exact:true}).check();assert.equal(await panel.locator("code").innerText(),"repository-credentials-missing");
  await panel.getByRole("button",{name:"Retry language services",exact:true}).click();await panel.getByRole("button",{name:"Clear this project's approval and stop services",exact:true}).click();assert.deepEqual((await snapshot()).actions,["debug:true","retry","forget"]);
  await panel.getByRole("button",{name:"Close language service status"}).focus();await page.keyboard.press("Escape");assert.equal(await panel.isVisible(),false);assert.equal(await status.evaluate(element=>element===document.activeElement),true);
  await status.click();await page.locator("#outside").click();assert.equal(await panel.isVisible(),false);assert.equal(await page.locator("#outside").evaluate(element=>element===document.activeElement),true);
  await update({state:"indexing",progress:{phase:"indexing"}});const animation=await status.evaluate(element=>getComputedStyle(element,"::before").animationName);assert.equal(animation,"none");
  await page.evaluate(()=>window.languageStatusFixture.cycles());assert.equal((await snapshot()).intervals,busyIntervals);assert.equal(await status.count(),1);assert.equal(await panel.count(),1);
  const started=performance.now();await page.evaluate(()=>{for(let n=0;n<100;n++)window.languageStatusFixture.update({progress:{phase:"sources",completed:n,total:100,unit:"items"}});});assert.ok(performance.now()-started<1500);
  await page.evaluate(()=>window.languageStatusFixture.rerender());assert.equal(await status.count(),1);assert.equal(await panel.count(),1);
  await status.click();const bounds=await panel.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=900&&bounds.y+bounds.height<=600);
  await page.evaluate(()=>window.languageStatusFixture.dispose());assert.equal((await snapshot()).intervals,busyIntervals-1);assert.equal(await panel.count(),0);assert.equal(await status.count(),0);assert.deepEqual(errors,[]);console.log(`${name}: progress, failure/retry, opt-in debug, keyboard focus, reduced motion and cleanup passed`);
 }finally{await browser.close();}
}}finally{await server.close();}
