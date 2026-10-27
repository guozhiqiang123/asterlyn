import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePluginDependencies, installedPluginDependents } from '../src/protocol/plugin-dependencies.ts';
const dependency={id:'dev.android',minimum:'1.0.0',maximumExclusive:'2.0.0'};
const plugin=(id,enabled,dependencies=[])=>({pluginId:id,enabled,activeVersion:'1.1.0',pendingVersion:null,knownGoodVersion:'1.1.0',versions:[{version:'1.1.0',admittedAtEpochMs:1,dependencies}]});
test('required plugin contract rejects ambiguous versions, duplicate IDs, self references and extra fields',()=>{
 validatePluginDependencies('dev.lsp',[dependency]);
 for(const value of [[{...dependency,minimum:'^1.0.0'}],[{...dependency,minimum:'1.0.0-beta'}],[{...dependency,minimum:'01.0.0'}],[{...dependency,minimum:'18446744073709551616.0.0'}],[dependency,dependency],[{...dependency,id:'dev.lsp'}],[{...dependency,id:'../x'}],[{...dependency,maximumExclusive:'1.0.0'}],[{...dependency,maximumExclusive:null}],[{...dependency,optional:true}]]) assert.throws(()=>validatePluginDependencies('dev.lsp',value));
});
test('UI dependency locks use enabled consumers even when no runtime activation exists',()=>{
 const all=[plugin('dev.lsp',true,[dependency]),plugin('dev.other',true,[dependency]),plugin('dev.android',true,[{id:'dev.model',minimum:'1.0.0'}]),plugin('dev.model',true)];
 assert.deepEqual(installedPluginDependents(all,'dev.model'),['dev.lsp','dev.other','dev.android']);
 all[0].enabled=false;assert.deepEqual(installedPluginDependents(all,'dev.android'),['dev.other']);
 all[1].enabled=false;assert.deepEqual(installedPluginDependents(all,'dev.android'),[]);
});
test('UI preserves bundled dependency floor through a legacy rollback and bounded cycle projection',()=>{
 const lsp=plugin('dev.lsp',true);lsp.requiredDependencies=[dependency];
 assert.deepEqual(installedPluginDependents([lsp,plugin('dev.android',true)],'dev.android'),['dev.lsp']);
 const cyclic=[plugin('dev.a',true,[{id:'dev.b',minimum:'1.0.0'}]),plugin('dev.b',true,[{id:'dev.a',minimum:'1.0.0'}])];
 assert.deepEqual(installedPluginDependents(cyclic,'dev.b'),['dev.a']);
 assert.throws(()=>installedPluginDependents(Array(65).fill(lsp),'dev.android'));
});
