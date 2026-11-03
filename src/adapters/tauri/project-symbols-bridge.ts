import {invokeDesktopCommandUnvalidated as invoke} from "./desktop-command-adapter.ts";
import {symbolReport} from "../../protocol/project-symbols.ts";
import type {ProjectSymbolsNativePort} from "../../protocol/project-symbols.ts";
export function symbolBridge():ProjectSymbolsNativePort{return {
 query:async(root,requestId,query,origin,overlays)=>symbolReport(await invoke("query_project_symbols",{root,requestId,query,origin,overlays:[...overlays]})),
 cancel:async requestId=>{await invoke("cancel_project_symbols",{requestId});},
 validate:async(root,candidate,report,origin,overlay)=>{const result=await invoke("validate_project_symbol",{root,candidate,identity:report.identity,scopeToken:report.scopeToken??null,origin,overlay});if(typeof result!=="boolean")throw Error("Invalid symbol validation");return result;},
};}
