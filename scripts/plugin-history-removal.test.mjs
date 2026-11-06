import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "vite";

test("history delete requires exact confirmation and preserves restart and execution authority", async()=>{
 const server=await createServer({configFile:false,server:{middlewareMode:true},appType:"custom"});
 try {
  const {PluginManagementBinding}=await server.ssrLoadModule("/src/features/settings/plugin-management-binding.ts");
  const handlers=new Map(),calls=[],errors=[],revoked=[];
  const button=(dataset={})=>({dataset,disabled:false,addEventListener:(name,fn)=>handlers.set(dataset.action+name,fn)});
  const remove=button({action:"delete",installedPluginDelete:"dev.example.plugin",pluginVersion:"1.0.0",packageDigest:`sha256:${"a".repeat(64)}`}),cancel=button({action:"cancel"}),confirm=button({action:"confirm"});
  const root={querySelectorAll:s=>s==="[data-installed-plugin-delete]"?[remove]:[],querySelector:s=>s==="[data-installed-plugin-delete-cancel]"?cancel:s==="[data-installed-plugin-delete-confirm]"?confirm:null};
  const snapshot={schemaVersion:2,generation:2,recovered:false,plugins:[{pluginId:"dev.example.plugin",enabled:true}]};
  const host={subscribePluginManagement:()=>()=>{},loadPluginManagement:async()=>({schemaVersion:1,entries:[]})};
  const marketplace={deleteInstalledPluginVersion:async(...args)=>{calls.push(args);return snapshot;}};
  const binding=new PluginManagementBinding(root,host,marketplace,{visible:()=>true,render(){},reportError:e=>errors.push(e.message),revokePluginExecution:id=>revoked.push(id)});
  try {
   binding.bind();handlers.get("confirmclick")();assert.equal(calls.length,0);
   handlers.get("deleteclick")();assert.equal(calls.length,0);handlers.get("cancelclick")();assert.equal(binding.confirmDeleteVersion,null);assert.equal(calls.length,0);
   handlers.get("deleteclick")();handlers.get("confirmclick")();await new Promise(setImmediate);
   assert.deepEqual(calls,[["dev.example.plugin","1.0.0",`sha256:${"a".repeat(64)}`]]);assert.equal(binding.restartRequired,false);assert.equal(binding.confirmDeleteVersion,null);assert.deepEqual(revoked,[]);
   marketplace.deleteInstalledPluginVersion=async()=>{throw Error("package is still in use");};handlers.get("deleteclick")();handlers.get("confirmclick")();await new Promise(setImmediate);assert.deepEqual(errors,["package is still in use"]);assert.equal(binding.restartRequired,false);assert.ok(binding.confirmDeleteVersion);
   binding.installations={...snapshot,generation:9};marketplace.deleteInstalledPluginVersion=async()=>({...snapshot,generation:3});handlers.get("confirmclick")();await new Promise(setImmediate);assert.equal(binding.installations.generation,9,"a late deletion response must not replace a newer window snapshot");
  } finally {binding.dispose();}
 } finally {await server.close();}
});
