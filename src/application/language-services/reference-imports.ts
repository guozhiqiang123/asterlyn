import type {EditorLanguageServiceLocation,EditorReferenceAnalysis} from "../../protocol/editor-language-service.ts";
import {locationPreviewLine} from "./location-preview.ts";
import {diagnostics} from "../diagnostics.ts";

type Family="script"|"java"|"kotlin"|"groovy"|"rust";
interface Token {value:string;start:number;end:number;line:number;kind:"word"|"string"|"punct";closed?:boolean;}
export function importLanguage(path:string,languageId?:string):Family|null {
  const id=languageId??path.split(/[?#]/u)[0]!.match(/\.([^./]+)$/u)?.[1]?.toLowerCase();
  if(id&&["ts","tsx","mts","cts","js","jsx","mjs","cjs","typescript","typescriptreact","javascript","javascriptreact"].includes(id))return "script";
  if(id==="java")return "java";
  if(id&&["kt","kts","kotlin"].includes(id))return "kotlin";
  if(id&&["groovy","gradle"].includes(id))return "groovy";
  return id==="rs"||id==="rust"?"rust":null;
}

/** Small bounded lexical pass, not a symbol index. Unknown/ambiguous statements stay visible. */
function tokens(text:string,family:Family):Token[] {
  const out:Token[]=[];let i=0,line=0;
  const advance=(end:number)=>{for(;i<end;i++)if(text[i]==="\n")line++;};
  while(i<text.length&&out.length<131072){
    const start=i,atLine=line,c=text[i]!,next=text[i+1];
    if(/\s|\uFEFF/u.test(c)){advance(i+1);continue;}
    if(c==="/"&&next==="/"){const end=text.indexOf("\n",i+2);advance(end<0?text.length:end);continue;}
    if(c==="/"&&next==="*"){
      let depth=1,j=i+2;for(;j<text.length&&depth;j++){if(text.slice(j,j+2)==="/*"&&family==="rust"){depth++;j++;}else if(text.slice(j,j+2)==="*/"){depth--;j++;}}
      advance(j);continue;
    }
    const raw=family==="rust"?text.slice(i).match(/^(?:br|r)(#{0,32})"/u):null;
    if(raw){const stop='"'+raw[1],end=text.indexOf(stop,i+raw[0].length);advance(end<0?text.length:end+stop.length);out.push({value:"",start,end:i,line:atLine,kind:"string"});continue;}
    if(family==="groovy"&&c==="$"&&next==="/"){const end=text.indexOf('/$',i+2);advance(end<0?text.length:end+2);out.push({value:"",start,end:i,line:atLine,kind:"string"});continue;}
    const lifetime=family==="rust"&&c==="'"&&/^'[\p{ID_Start}_][\p{ID_Continue}_]*(?!')/u.test(text.slice(i))&&!/^'[^'\n]'|^'\\[^\n]*?'/u.test(text.slice(i));
    if((c==='"'||c==="'"&&!lifetime||c==='`')){
      const triple=(c==='"'||c==="'")&&text.slice(i,i+3)===c.repeat(3),delimiter=triple?c.repeat(3):c;
      let j=i+delimiter.length,closed=false;while(j<text.length){if(text[j]==="\\"){j+=2;continue;}if(text.startsWith(delimiter,j)){j+=delimiter.length;closed=true;break;}if(family==="script"&&c!=='`'&&text[j]==="\n")break;j++;}
      advance(Math.min(j,text.length));out.push({value:"",start,end:i,line:atLine,closed,kind:family==="kotlin"&&c==='`'?"word":"string"});continue;
    }
    // Regex/slashy strings can contain apparent import declarations on later lines.
    if(c==="/"&&family!=="rust"&&family!=="java"&&family!=="kotlin"&&(!out.length||/[=(:,[!;{?]/u.test(out.at(-1)!.value)||["return","throw","case"].includes(out.at(-1)!.value))){
      let j=i+1,bracket=false;for(;j<text.length;j++){if(text[j]==="\\"){j++;continue;}if(text[j]==="[")bracket=true;if(text[j]==="]")bracket=false;if(text[j]==="/"&&!bracket){j++;break;}if(text[j]==="\n"&&family==="script")break;}
      advance(j);out.push({value:"",start,end:i,line:atLine,kind:"string"});continue;
    }
    const word=text.slice(i).match(/^(?:r#)?[\p{ID_Start}_$][\p{ID_Continue}$]*/u);
    if(word){advance(i+word[0].length);out.push({value:word[0],start,end:i,line:atLine,kind:"word"});continue;}
    advance(i+1);out.push({value:c,start,end:i,line:atLine,kind:"punct"});
  }
  return out;
}

export function importRanges(text:string,path:string,languageId?:string):readonly {from:number;to:number}[]{
  const family=importLanguage(path,languageId);if(!family||text.length>512*1024)return [];
  const list=tokens(text,family),ranges:{from:number;to:number}[]=[];
  for(let i=0;i<list.length;i++){
    const token=list[i]!,prev=list[i-1];
    if(prev?.value===".")continue;
    if(family==="rust"){
      if(token.value!=="use"&&!(token.value==="extern"&&list[i+1]?.value==="crate"))continue;
      let j=i+1;for(;j<list.length&&list[j]!.value!==";";j++)if(list[j]!.kind==="string"||!/[\p{ID_Continue}_#*,{}:]/u.test(list[j]!.value))break;
      if(list[j]?.value===";"){ranges.push({from:token.start,to:list[j]!.end});i=j;}continue;
    }
    if(token.value!=="import"||prev&&prev.line===token.line&&![";","}","{"].includes(prev.value))continue;
    if(family==="script"){
      if(["(",".",":"].includes(list[i+1]?.value??""))continue;
      let j=i+1,depth=0,requireImport=false,complete=false;
      for(;j<list.length;j++){
        const t=list[j]!;
        if(t.value==="=")requireImport=true;
        if(["{","[","("].includes(t.value))depth++;
        if(["}","]",")"].includes(t.value))depth--;
        if(t.kind==="string"&&(j===i+1||list[j-1]?.value==="from")){complete=t.closed!==false;break;}
        if(requireImport&&t.value===")"&&depth===0){complete=true;break;}
        if(t.value===";"||depth<0)break;
      }
      if(!complete)continue;
      if(["with","assert"].includes(list[j+1]?.value??"")&&list[j+2]?.value==="{"){
        j+=2;let braces=1;while(braces&&j+1<list.length){j++;if(list[j]!.value==="{")braces++;if(list[j]!.value==="}")braces--;}
        if(braces)continue;
      }
      if(list[j+1]?.value===";")j++;
      ranges.push({from:token.start,to:list[j]!.end});i=j;continue;
    }
    let j=i+1;if(list[j]?.value==="static")j++;
    if(list[j]?.kind!=="word")continue;
    j++;while(list[j]?.value==="."&&(list[j+1]?.kind==="word"||list[j+1]?.value==="*"))j+=2;
    if(list[j]?.value==="as"&&list[j+1]?.kind==="word")j+=2;
    if(list[j]?.value===";"){ranges.push({from:token.start,to:list[j]!.end});i=j;}
    else if(family!=="java"&&(!list[j]||list[j]!.line>list[j-1]!.line)){ranges.push({from:token.start,to:list[j-1]!.end});i=j-1;}
  }
  return ranges;
}

/** One file read/classification per query, with only detached preview strings retained. */
export async function analyzeReferenceLocations(locations:readonly EditorLanguageServiceLocation[],read:(location:EditorLanguageServiceLocation)=>Promise<string|null>,current:()=>boolean):Promise<EditorReferenceAnalysis|null>{
  const started=performance.now();
  const groups=new Map<string,number[]>();locations.slice(0,512).forEach((l,i)=>{const indices=groups.get(l.uri)??[];indices.push(i);groups.set(l.uri,indices);});
  const files=[...groups.values()],imports:number[]=[],previews:EditorReferenceAnalysis["previews"][number][]=[];let next=0;
  await Promise.all(Array.from({length:Math.min(3,files.length)},async()=>{while(next<files.length&&current()){
    const indices=files[next++]!,location=locations[indices[0]!]!;let text:string|null=null;
    try{text=location.readonlySource?.text??await read(location);}catch{/* Unknown source is retained. */}
    if(!current())return;
    if(text===null||text.length>512*1024){for(const index of indices)previews.push({index,preview:null});continue;}
    const path=location.readonlySource?.path??decodeURIComponent(new URL(location.uri).pathname),ranges=importRanges(text,path,location.readonlySource?.languageId),lines=text.split("\n"),starts=[0];
    for(let at=0;at<text.length;at++)if(text[at]==="\n")starts.push(at+1);
    for(const index of indices){const {start,end}=locations[index]!.range,offset=starts[start.line];
      if(offset!==undefined&&start.character<=(lines[start.line]?.length??-1)&&ranges.some(r=>offset+start.character>=r.from&&offset+start.character<r.to))imports.push(index);
      previews.push({index,preview:locationPreviewLine(lines[start.line],start.character,start.line===end.line?end.character:lines[start.line]?.length??0)});
    }
  }}));
  if(!current())return null;
  diagnostics.report("info","language.imports.classified",`targets=${locations.length};files=${files.length};imports=${imports.length}`,{durationMs:performance.now()-started});
  return {imports:imports.sort((a,b)=>a-b),previews:previews.sort((a,b)=>a.index-b.index)};
}
