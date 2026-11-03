/** Preferences select an admitted contribution; they never grant execution authority. */
export interface LanguageProviderCandidate {readonly qualifiedId:string;readonly label:string;}
export function selectLanguageProvider<T extends LanguageProviderCandidate>(candidates:readonly T[],preferred:string|null):{provider:T|null;conflict:boolean} {
  if(preferred){const provider=candidates.find(item=>item.qualifiedId===preferred)??null;return {provider,conflict:provider===null};}
  return {provider:candidates.length===1?candidates[0]!:null,conflict:candidates.length>1};
}
export interface ProviderPreferenceStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;}
const STORAGE_KEY="language-provider-preferences.v1";
export class LanguageProviderPreferences {
  private entries: {root:string;language:string;id:string}[]=[];
  private readonly storage?:ProviderPreferenceStorage;
  constructor(storage?:ProviderPreferenceStorage){
    this.storage=storage;
    try{const raw=storage?.getItem(STORAGE_KEY);if(!raw||raw.length>256*1024)return;const parsed:unknown=JSON.parse(raw);
      if(Array.isArray(parsed)&&parsed.length<=128&&parsed.every(item=>item&&typeof item==="object"&&typeof item.root==="string"&&item.root.length<=16384&&/^[a-z][a-z0-9-]{0,63}$/u.test(item.language)&&typeof item.id==="string"&&item.id.length<=256))this.entries=parsed;
    }catch{/* Invalid or unavailable preference storage grants nothing. */}
  }
  get(root:string,language:string):string|null{return this.entries.find(item=>item.root===root&&item.language===language)?.id??null;}
  set(root:string,language:string,id:string|null):void{
    this.entries=this.entries.filter(item=>item.root!==root||item.language!==language);
    if(id)this.entries.push({root,language,id});this.entries=this.entries.slice(-128);
    try{while(JSON.stringify(this.entries).length>256*1024)this.entries.shift();this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.entries));}catch{/* The current-window choice remains usable without persistence. */}
  }
}
