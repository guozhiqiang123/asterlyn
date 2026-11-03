import {isNativeLanguageModel} from "./native-language-validation.ts";
import type {SymbolCandidate,SymbolOverlay,SymbolQueryReport} from "./generated-native-language-types.ts";
export interface ProjectSymbolsNativePort {
 query(root:string,requestId:string,query:string,origin:string|null,overlays:ReadonlyArray<SymbolOverlay>):Promise<SymbolQueryReport>;
 cancel(requestId:string):Promise<void>;
 validate(root:string,candidate:SymbolCandidate,report:SymbolQueryReport,origin:string|null,overlay:SymbolOverlay|null):Promise<boolean>;
}
export function symbolReport(value:unknown):SymbolQueryReport{
 if(!isNativeLanguageModel("SymbolQueryReport",value))throw Error("Invalid symbol report");
 const result=value as SymbolQueryReport;
 if(result.matches.length>512||!/^([a-f0-9]{64})$/u.test(result.identity)||result.matches.some(v=>!v.name||v.name.length>128||/[\u0000-\u001f\u007f]/u.test(v.name)||!v.workspacePath||v.workspacePath.length>4096||v.workspacePath.split("/").some(p=>!p||p==="."||p==="..")||v.revision.length>256||v.range.start.line!==v.range.end.line||v.range.start.character>=v.range.end.character))throw Error("Invalid symbol candidates");
 return result;
}
