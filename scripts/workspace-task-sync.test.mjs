import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceTaskSync } from "../src/application/tasks/workspace-task-sync.ts";

const identity={root:"/project",generation:1};
const plugin={id:"android",version:"1",enabled:true,active:true};
const provider={pluginId:"android",qualifiedId:"android.tasks"};
const drain=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(refresh=async()=>{}){
 const calls=[],errors=[],events=[];
 const sync=new WorkspaceTaskSync({eligiblePlugins:new Set(["android"]),refresh:async(...args)=>{calls.push(args);await refresh(...args);},reportError:e=>errors.push(e),diagnostic:(...args)=>events.push(args)});
 sync.activate(identity);
 return {sync,calls,errors,events};
}
test("active matching providers synchronize once; repeated cache/evidence publications do not retry",async()=>{
 const x=fixture();
 for(let i=0;i<20;i++)x.sync.reconcile([plugin],[provider]);
 await drain();x.sync.reconcile([plugin],[provider]);await drain();
 assert.deepEqual(x.calls,[[identity,provider.qualifiedId]]);
 assert.deepEqual(x.events.map(x=>x[0]),["started","settled"]);
});
test("disabled, inactive, missing and unrelated plugins cannot start automatic work",async()=>{
 const x=fixture();
 for(const plugins of [[],[{...plugin,enabled:false}],[{...plugin,active:false}],[{...plugin,id:"other"}]])x.sync.reconcile(plugins,[provider]);
 await drain();assert.equal(x.calls.length,0);
 x.sync.reconcile([plugin],[]);await drain();assert.equal(x.calls.length,0);
 x.sync.reconcile([plugin],[provider]);await drain();assert.equal(x.calls.length,1);
});
test("queued sync cannot escape project switch, disable, contribution removal or disposal",async()=>{
 for(const revoke of [x=>x.sync.activate({root:"/next",generation:2}),x=>x.sync.reconcile([{...plugin,enabled:false}],[]),x=>x.sync.reconcile([plugin],[]),x=>x.sync.dispose()]){
  const x=fixture();x.sync.reconcile([plugin],[provider]);revoke(x);await drain();assert.equal(x.calls.length,0);
 }
});
test("new project sessions, plugin updates and explicit re-enabling permit a new sync",async()=>{
 const x=fixture();x.sync.reconcile([plugin],[provider]);await drain();
 x.sync.reconcile([{...plugin,active:false}],[]);
 x.sync.reconcile([{...plugin,enabled:false,active:false}],[]);
 x.sync.reconcile([plugin],[provider]);await drain();assert.equal(x.calls.length,2);
 x.sync.reconcile([{...plugin,version:"2"}],[provider]);await drain();assert.equal(x.calls.length,3);
 x.sync.activate({...identity,generation:2});x.sync.reconcile([plugin],[provider]);await drain();assert.equal(x.calls.length,4);
});
test("failed attempts wait for manual retry; stale failures cannot leak into a new project",async()=>{
 const x=fixture(async()=>{throw Error("discovery failed");});
 x.sync.reconcile([plugin],[provider]);await drain();x.sync.reconcile([plugin],[provider]);await drain();
 assert.equal(x.calls.length,1);assert.equal(x.errors.length,1);
 let fail;const y=fixture(()=>new Promise((_,reject)=>{fail=reject;}));
 y.sync.reconcile([plugin],[provider]);await drain();y.sync.activate({root:"/next",generation:2});fail(Error("old project"));await drain();assert.equal(y.errors.length,0);
});
test("a superseded queued version cannot erase or duplicate the current attempt",async()=>{
 const x=fixture();x.sync.reconcile([plugin],[provider]);x.sync.reconcile([{...plugin,version:"2"}],[provider]);await drain();
 x.sync.reconcile([{...plugin,version:"2"}],[provider]);await drain();assert.equal(x.calls.length,1);
});
test("rapid disable and re-enable invalidates the old queued token even at the same version",async()=>{
 const x=fixture();x.sync.reconcile([plugin],[provider]);
 x.sync.reconcile([{...plugin,enabled:false,active:false}],[]);
 x.sync.reconcile([plugin],[provider]);await drain();assert.equal(x.calls.length,1);
});
test("initial cache hydration finishes before background synchronization can replace its snapshot",async()=>{
 const x=fixture();x.sync.reconcile([plugin],[{...provider,ready:false}]);await drain();assert.equal(x.calls.length,0);
 x.sync.reconcile([plugin],[{...provider,ready:true}]);await drain();assert.equal(x.calls.length,1);
});
