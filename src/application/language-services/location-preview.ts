import type {EditorLocationPreview} from "../../protocol/editor-language-service.ts";
export type FindLocationPreview = EditorLocationPreview;
export function locationPreview(text:string,line:number,from:number,to:number):FindLocationPreview|null {
  return locationPreviewLine(text.split("\n")[line],from,to);
}
export function locationPreviewLine(source:string|undefined,from:number,to:number):FindLocationPreview|null {
  if(source===undefined||!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>source.length||to<from)return null;
  const splitsPair=(offset:number)=>offset>0&&/[\uD800-\uDBFF]/.test(source[offset-1]??"")&&/[\uDC00-\uDFFF]/.test(source[offset]??"");
  if(splitsPair(from))return null;
  let start=Math.max(0,from-80),highlightEnd=Math.min(source.length,to,from+160),end=Math.min(source.length,highlightEnd+200);
  if(splitsPair(start))start--;if(splitsPair(highlightEnd))highlightEnd--;if(splitsPair(end))end++;
  // Detach bounded UTF-16 units so a tiny preview cannot retain the full source file.
  const copy=(a:number,b:number)=>source.slice(a,b).split("").join("");
  return {before:copy(start,from),found:copy(from,highlightEnd),after:copy(highlightEnd,end),leading:start>0,trailing:end<source.length};
}
