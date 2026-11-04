import "../../src/styles.css";
import "../../src/shared/controls.css";
import "../../src/shell/shell.css";
import {renderCommandSurface} from "../../src/features/files-editor/workspace-navigation-view.ts";
import {createWorkspaceSearchState,createWorkspaceSearchControls} from "../../src/features/files-editor/workspace-search.ts";
import "../../src/features/files-editor/language-location-picker.css";
import "../../src/features/project-symbols/project-symbols.css";
import {LanguageLocationPicker} from "../../src/features/files-editor/language-location-picker.ts";
import {ProjectSymbols} from "../../src/features/project-symbols/project-symbols.ts";
import {EN_US} from "../../src/localization/en-US.ts";
const host=document.createElement("aside");host.id="host-search";document.body.append(host);
host.innerHTML=renderCommandSurface({commandSurface:{mode:"commands",query:"",selectedIndex:0},workspaceOpen:true,filesLoading:false,files:[],commands:[{id:"first",label:"First",detail:"src/first.ts",enabled:true},{id:"second",label:"Second",detail:"src/second.ts",enabled:true}],workspaceSearch:createWorkspaceSearchState(),workspaceSearchControls:createWorkspaceSearchControls(),searchRequestIsCurrent:true,replacementText:"",replacementRecoveryCount:0});
const picker=new LanguageLocationPicker();
const symbols=new ProjectSymbols(document.querySelector<HTMLElement>("#shell")!,{
 workspace:()=>({root:"/project",generation:1}),overlays:()=>[],origin:()=>null,chinese:()=>false,
 query:async()=>({identity:"a".repeat(64),matches:[0,1].map(index=>({name:`ExampleSymbol${index}`,kind:"class",range:{start:{line:0,character:6},end:{line:0,character:19}},workspacePath:"src/example.ts",revision:"b".repeat(64),overlay:false,extractorId:"typescript-javascript-v1"})),filesScanned:1,filesTotal:1,reusedFiles:1,skippedFiles:0,partial:false,reasons:[]}),
 cancel:async()=>{},validate:async()=>true,navigate:async()=>{},
});
Object.assign(window,{portalFonts:{
 set:(size:number,theme:string)=>{document.documentElement.style.setProperty("--ui-font-size",`${size}px`);document.documentElement.dataset.theme=theme;},
 references:()=>picker.open(document,{x:250,y:150},[0,1].map(index=>({uri:`file:///project/src/example${index}.ts`,range:{start:{line:0,character:6},end:{line:0,character:19}}})),{title:"Choose a reference",limited:false,copy:EN_US.editor.languageService,referenceImports:[],current:()=>true,select:()=>{},dismissed:()=>{},restoreFocus:()=>{},openInWindow:()=>{}}),
 symbols:()=>symbols.open(),close:()=>{picker.close();symbols.close();},
}});
