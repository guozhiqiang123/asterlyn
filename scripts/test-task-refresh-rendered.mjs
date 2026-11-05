import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {chromium,webkit} from "playwright";
import {createServer} from "vite";
import {readBundledAndroidManifest} from "./plugin-package-fixture.mjs";

const root=fileURLToPath(new URL("../",import.meta.url)),manifest=await readBundledAndroidManifest();
const server=await createServer({root,server:{host:"127.0.0.1",port:0,hmr:false},plugins:[{
 name:"task-refresh-fixture",configureServer(vite){vite.middlewares.use("/__task_refresh",(_req,res)=>{
  res.setHeader("Content-Type","text/html");res.end('<html data-theme="dark"><head><script type="module">import "/src/styles.css";window.stylesReady=true;</script></head><body><main id="fixture"><button id="tasks-header-refresh" aria-label="Refresh tasks"><svg width="16" height="16"></svg></button><div id="plugin-workbench-tabs"></div><div id="plugin-workbench-view"></div><div id="tasks-view-host"></div></main></body></html>');
 });}
}]});
try{
 await server.listen();const address=server.httpServer.address();
 for(const [name,engine]of [["chromium",chromium],["webkit",webkit]]){
  const browser=await engine.launch();
  try{
   const page=await browser.newPage({viewport:{width:1100,height:700}}),errors=[];
   page.on("pageerror",e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${address.port}/__task_refresh`);
   await page.waitForFunction(()=>window.stylesReady);
   await page.evaluate(async manifest=>{
    const [{TasksController},{TasksRuntime},{DEFAULT_TASKS_COPY},{PluginWorkbenchHostRuntime}]=await Promise.all([
     import("/src/features/tasks/tasks-controller.ts"),import("/src/features/tasks/tasks-runtime.ts"),import("/src/features/tasks/tasks-view.ts"),import("/src/composition/plugin-workbench-host-runtime.ts")]);
    const root=document.querySelector("#fixture"),controller=new TasksController();
    const identity={root:"/project",generation:1};let host,deviceStatus="ready",notifyDevice;
    window.taskCalls=0;window.deviceCalls=0;window.runBlocked=false;
    const publish=status=>controller.acceptProviders(identity,[{id:"gradle",label:"Gradle",snapshot:{status,tasks:[{id:":app:assembleDebug",label:"assembleDebug",projectPath:":app",group:"Build",runnable:true}]}}]);
    const refreshTasks=async()=>{window.taskCalls++;publish("loading");};
    const target={kind:"execution-target-provider",id:"devices",pluginId:manifest.id,qualifiedId:"android.devices",snapshot:()=>({status:deviceStatus,selectedTargetId:null,targets:[]}),subscribe:fn=>{notifyDevice=fn;return{dispose(){}};},refresh:()=>{window.deviceCalls++;deviceStatus="loading";notifyDevice();}};
    const entry={...manifest,id:manifest.id,active:true,enabled:true,settings:{},settingDescriptors:[],diagnostics:[],workspaceTool:{...manifest.workspaceTool,views:[...manifest.workspaceTool.views,{id:"devices",labelKey:"panel.devices"}]}};
    const tasks=new TasksRuntime(root,controller,{copy:()=>DEFAULT_TASKS_COPY,refresh:refreshTasks,headerRefresh:()=>host.refresh(),error:e=>{throw e;}});
    host=new PluginWorkbenchHostRuntime({root,plugins:{managementSnapshot:{entries:[entry]},contributionRegistry:{list:()=>[target],subscribe:()=>()=>{}}},copy:()=>DEFAULT_TASKS_COPY,locale:()=>"en-US",reportError:e=>{throw e;},runSession:()=>null,executeRun:async()=>{},cancelRun(){},refreshTasks,synchronizeTasks:async()=>{},taskRefreshBusy:()=>controller.state.status==="loading",taskRefreshBlocked:()=>window.runBlocked});
    controller.subscribe(()=>host.render());tasks.activate(identity);publish("ready");host.render();
    window.finishTasks=()=>publish("ready");window.finishDevices=()=>{deviceStatus="ready";notifyDevice();};window.renderWorkbench=()=>host.render();window.fixtureReady=true;
   },manifest);
   await page.waitForFunction(()=>window.fixtureReady);
   const header=page.locator("#tasks-header-refresh");
   await page.locator('[data-plugin-workbench-view="run"]').click();
   assert.ok(await header.isVisible());assert.equal(await header.getAttribute("aria-label"),"Refresh tasks");
   await header.click();assert.equal(await page.evaluate(()=>window.taskCalls),1);assert.ok(await header.isDisabled());assert.equal(await header.getAttribute("aria-busy"),"true");
   await page.evaluate(()=>window.finishTasks());assert.ok(await header.isEnabled());assert.equal(await page.locator('[data-plugin-workbench-view="run"]').getAttribute("aria-selected"),"true");
   await page.evaluate(()=>{window.runBlocked=true;window.renderWorkbench();});assert.ok(await header.isDisabled());assert.equal(await header.getAttribute("aria-busy"),"false");await page.evaluate(()=>{window.runBlocked=false;window.renderWorkbench();});
   await page.locator('[data-plugin-workbench-view="tasks"]').click();await header.click();assert.equal(await page.evaluate(()=>window.taskCalls),2);await page.evaluate(()=>window.finishTasks());
   await page.locator('[data-plugin-workbench-view="devices"]').click();assert.equal(await header.getAttribute("aria-label"),"Refresh devices");await header.click();assert.equal(await page.evaluate(()=>window.deviceCalls),1);assert.equal(await page.evaluate(()=>window.taskCalls),2);assert.ok(await header.isDisabled());
   await page.locator('[data-plugin-workbench-view="run"]').click();assert.ok(await header.isEnabled());assert.equal(await header.getAttribute("aria-label"),"Refresh tasks");
   await page.evaluate(()=>{document.querySelector("#tasks-header-refresh").classList.add("hidden");window.renderWorkbench();});assert.ok(!await header.isVisible(),"bottom-tool visibility remains shell-owned");
   assert.deepEqual(errors,[]);console.log(`PASS ${name}: shared Run/Tasks refresh, busy state, device routing, shell visibility`);
  }finally{await browser.close();}
 }
}finally{await server.close();}
