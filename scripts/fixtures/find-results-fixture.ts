import "../../src/shared/controls.css";
import "../../src/features/files-editor/workspace-search.css";
import "../../src/features/files-editor/language-location-picker.css";
import {FindResultsRuntime} from "../../src/features/files-editor/find-results-runtime.ts";
import {LanguageLocationPicker} from "../../src/features/files-editor/language-location-picker.ts";
import {analyzeReferenceLocations} from "../../src/application/language-services/reference-imports.ts";
import {EN_US} from "../../src/localization/en-US.ts";
const root=document.querySelector<HTMLElement>("main")!;
root.innerHTML='<div id="terminal-header-actions"></div><div id="find-tool-host" style="height:320px"></div>';
const state={root:"/repo",generation:1,visible:false,current:true,opened:[] as any[],reads:0,wrong:0,defer:false,activeReads:0,maxReads:0,readUris:[] as string[],fail:false,oversized:false,sources:new Map<string,string>()};
let pending:(()=>void)[]=[],last:any=null;
const source=()=>({mode:"workspace" as const,repositoryRoot:state.root,query:"needle",files:[],searchRepositoryRoot:state.root,searchCurrent:true,report:{requestId:"r",matches:[{repositoryId:".",path:"src/a.ts",workspacePath:"src/a.ts",revision:"saved",fromUtf16:6,toUtf16:12,line:1,columnUtf16:6,preview:"const needle = 1;",previewFromUtf16:6,previewToUtf16:12,leadingClipped:false,trailingClipped:false}],catalogCandidates:1,eligibleCandidates:1,filesSearched:1,bytesRead:40,skippedCount:0,skippedFiles:[],coverageReasons:[]}});
const readSource: (root:string,location:any)=>Promise<string|null>=async(_root,location)=>{
  state.reads++;state.readUris.push(location.uri);state.activeReads++;state.maxReads=Math.max(state.maxReads,state.activeReads);
  const fail=state.fail,oversized=state.oversized;
  try{if(state.defer)await new Promise<void>(resolve=>pending.push(resolve));if(fail)throw Error("unreadable");if(oversized)return "x".repeat(512*1024+1);return state.sources.get(location.uri)??["// 😀",...Array.from({length:520},()=>"const value = 1;")].join("\n");}
  finally{state.activeReads--;}
};
const runtime=new FindResultsRuntime(root,{copy:()=>EN_US,source,activeRepositoryRoot:()=>state.root,activeWorkspaceGeneration:()=>state.generation,activeFilePath:()=>"src/a.ts",locateCurrentFile(){},openSearch(){},openPanel(){state.visible=true;runtime.render();},openFile:async(_r,file)=>{state.opened.push({file});},openMatch:async(_r,match)=>{state.opened.push({match});},openLocation:async location=>{state.opened.push({location});},readLocationSource:readSource,wrongWorkspace:()=>state.wrong++,visible:()=>state.visible,presentationChanged(){}});
const picker=new LanguageLocationPicker();
function locations(count=69){return Array.from({length:count},(_,index)=>({uri:`file:///repo/${index%2?"common/shared.ts":"app/deep/pkg/shared.ts"}`,range:{start:{line:index+2,character:6},end:{line:index+2,character:11}}}));}
const fixture={state,runtime,locations,async openImportPicker(all=false){
  const samples=[['a.ts','import {\n Target as Alias\n} from "x";\nTarget();'],['b.js','import Target from "x"; Target();'],['c.rs','use crate::{Target};\nlet x:Target;'],['d.java','import pkg.Target; class C { Target x; }'],['e.kt','import pkg.Target as Alias\nval x=Target()'],['f.groovy','import static pkg.Target.member\nTarget x']];
  const targets:any[]=[];
  for(const[path,text]of samples){const uri='file:///repo/'+path;state.sources.set(uri,text!);for(const m of text!.matchAll(/Target/gu)){const before=text!.slice(0,m.index),line=before.split('\n').length-1,character=before.length-(before.lastIndexOf('\n')+1);targets.push({uri,range:{start:{line,character},end:{line,character:character+6}}});if(all)break;}}
  const referenceAnalysis=await analyzeReferenceLocations(targets,l=>readSource(state.root,l),()=>state.current);
  last={workspaceRoot:state.root,workspaceGeneration:state.generation,kind:'references',query:'Target',locations:targets,limited:false,referenceAnalysis};
  picker.open(document,{x:20,y:20},targets,{referenceImports:referenceAnalysis!.imports,title:EN_US.editor.languageService.chooseReference,limited:false,copy:EN_US.editor.languageService,current:()=>state.current,select:location=>state.opened.push({location}),dismissed(){},restoreFocus(){},openInWindow:(selected,excludeImports)=>runtime.openLocations({...last,excludeImports,selectedIndex:targets.indexOf(selected)})});
},openPicker(count=69){state.current=true;last={workspaceRoot:state.root,workspaceGeneration:state.generation,kind:"references" as const,query:"value",locations:locations(count),limited:count>=512,referenceAnalysis:{imports:[],previews:[]}};picker.open(document,{x:20,y:20},last.locations,{title:EN_US.editor.languageService.chooseReference,limited:last.limited,copy:EN_US.editor.languageService,current:()=>state.current,select:location=>state.opened.push({location}),dismissed(){},restoreFocus(){},openInWindow:()=>runtime.openLocations(last)});},openSearch(){const button=document.createElement("button");button.id="command-surface-open-find";button.textContent=EN_US.navigation.openInWindow;root.append(button);runtime.bindCommandSurface();button.click();button.remove();},release(){state.defer=false;for(const resolve of pending)resolve();pending=[];},reset(){runtime.clear();state.visible=false;state.opened=[];state.reads=0;state.readUris=[];state.maxReads=state.activeReads;state.fail=false;state.oversized=false;state.sources.clear();state.wrong=0;state.current=true;state.generation=1;state.root="/repo";picker.close(false);runtime.render();}};
(window as any).findResultsFixture=fixture;runtime.render();
