import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
const server=await createServer({root:process.cwd(),server:{host:"127.0.0.1",port:0,hmr:false},plugins:[{
  name:"navigation-history-fixture",configureServer(vite){vite.middlewares.use("/__navigation_history",(_req,res)=>{
    res.setHeader("Content-Type","text/html");res.end('<!doctype html><html><body><main id="editor" style="width:1000px;height:650px"></main><script type="module" src="/scripts/fixtures/editor-navigation-fixture.ts"></script></body></html>');
  });},
}]});
await server.listen();const port=server.httpServer.address().port;
try{
  for(const [name,engine]of[["Chromium",chromium],["WebKit",webkit]]){
    const browser=await engine.launch(),page=await browser.newPage(),errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    const snap=()=>page.evaluate(()=>window.navigationFixture.snapshot());
    const jump=(path,line)=>page.evaluate(([path,line])=>window.navigationFixture.jump(path,line),[path,line]);
    const key=direction=>page.keyboard.press(`Meta+Alt+Arrow${direction}`);
    try{
      await page.goto(`http://127.0.0.1:${port}/__navigation_history`,{waitUntil:"networkidle"});
      await page.waitForFunction(()=>!!window.navigationFixture);
      await jump("a.ts",10);const source=await snap();await jump("b.ts",20);
      await key("Left");await page.waitForFunction(()=>window.navigationFixture.snapshot().active==="a.ts");
      assert.equal((await snap()).head,source.head,`${name}: Back restores the source cursor`);
      assert.equal((await snap()).focused,true);
      await key("Right");await page.waitForFunction(()=>window.navigationFixture.snapshot().active==="b.ts");
      assert.equal((await snap()).line,20);
      await jump("b.ts",40);await key("Left");await page.waitForFunction(()=>window.navigationFixture.snapshot().line===20);
      await key("Right");await page.waitForFunction(()=>window.navigationFixture.snapshot().line===40);
      await key("Left");await page.waitForFunction(()=>window.navigationFixture.snapshot().line===20);
      await page.evaluate(()=>window.navigationFixture.close("a.ts"));
      await key("Left");await page.waitForFunction(()=>window.navigationFixture.snapshot().active==="a.ts");
      assert.equal((await snap()).line,10,`${name}: closed source reopens at its stored selection`);
      await jump("c.ts",30);assert.equal((await snap()).forward,false,`${name}: new navigation clears Forward`);
      const unchanged=await snap();await key("Right");assert.equal((await snap()).head,unchanged.head);
      await page.evaluate(()=>window.navigationFixture.insert("// inserted\n"));
      await jump("b.ts",25);await key("Left");await page.waitForFunction(()=>window.navigationFixture.snapshot().active==="c.ts");
      assert.equal((await snap()).line,31,`${name}: edits map the stored position`);
      assert.equal((await snap()).selected,unchanged.selected);
      for(let i=0;i<150;i++)await jump(i%2?"a.ts":"b.ts",(i%70)+1);
      assert.equal((await snap()).size,100);assert.equal(await page.locator(".cm-editor").count(),1);
      assert.deepEqual(errors,[]);console.log(`${name}: Command+Option Back/Forward, same-file/closed-file navigation, edits, branches and bounded state passed.`);
    }finally{await page.evaluate(()=>window.navigationFixture?.destroy());await browser.close();}
  }
}finally{await server.close();}
