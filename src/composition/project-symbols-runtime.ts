import type {ProjectSymbols,ProjectSymbolsPorts} from "../features/project-symbols/project-symbols.ts";
export function projectSymbolsRuntime(host:HTMLElement,ports:Omit<ProjectSymbolsPorts,"query"|"cancel"|"validate">){
 let instance:ProjectSymbols|null=null,loading:Promise<void>|null=null,disposed=false;
 return {open:()=>{if(disposed)return;loading??=Promise.all([import("../features/project-symbols/entry.ts"),import("../adapters/tauri/project-symbols-bridge.ts")]).then(([{ProjectSymbols},{symbolBridge}])=>{if(!disposed)instance=new ProjectSymbols(host,{...ports,...symbolBridge()});});void loading.then(()=>{if(!disposed)instance?.open();}).catch(()=>{loading=null;});},dispose:()=>{disposed=true;instance?.dispose();instance=null;}};
}
