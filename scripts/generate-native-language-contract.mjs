import {spawnSync} from "node:child_process";
import {readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
const root=fileURLToPath(new URL("../",import.meta.url));
const header="// Generated from native serde models by scripts/generate-native-language-contract.mjs. Do not edit.\n";
function reference(value){const name=value.split("/").at(-1);if(!/^[A-Za-z][A-Za-z0-9_]*$/u.test(name))throw Error("Invalid native type reference");return name;}
export function typeFor(schema){
 if(schema.$ref)return reference(schema.$ref);
 if(schema.enum)return schema.enum.map(value=>JSON.stringify(value)).join(" | ");
 if(schema.anyOf||schema.oneOf)return(schema.anyOf??schema.oneOf).map(typeFor).map(type=>`(${type})`).join(" | ");
 if(schema.allOf)return schema.allOf.map(typeFor).map(type=>`(${type})`).join(" & ");
 if(Array.isArray(schema.type))return schema.type.map(type=>typeFor({...schema,type})).join(" | ");
 switch(schema.type){
  case "object":{const required=new Set(schema.required??[]);return `{\n${Object.entries(schema.properties??{}).sort(([a],[b])=>a.localeCompare(b,"en")).map(([key,value])=>`  readonly ${JSON.stringify(key)}${required.has(key)?"":"?"}: ${typeFor(value)};`).join("\n")}\n}`;}
  case "array":return `ReadonlyArray<${typeFor(schema.items)}>`;
  case "integer":case "number":return "number";
  case "string":return "string";case "boolean":return "boolean";case "null":return "null";
  case undefined:if(Object.keys(schema).every(key=>["title","description","default","$schema"].includes(key)))return "unknown";
 }
 throw Error(`Unsupported native output schema: ${JSON.stringify(schema)}`);
}
export async function generateNativeLanguageContract(){
 const result=spawnSync("cargo",["run","--quiet","--locked","-p","asterlyn-language-service","--features","bindings","--bin","export-language-contract"],{cwd:root,encoding:"utf8",maxBuffer:4*1024*1024});
 if(result.status!==0)throw Error(`Native contract export failed: ${result.stderr.slice(-4000)}`);
 const exported=JSON.parse(result.stdout);if(exported.schema!==1)throw Error("Unknown native contract schema");
 const models={};
 const add=(name,schema)=>{const normalized={...schema};delete normalized.definitions;delete normalized.$schema;delete normalized.title;if(models[name]&&JSON.stringify(models[name])!==JSON.stringify(normalized))throw Error(`Conflicting native type: ${name}`);models[name]=normalized;};
 for(const [name,schema] of Object.entries(exported.models)){for(const [key,value] of Object.entries(schema.definitions??{}))add(key,value);add(name,schema);}
 const ordered=Object.fromEntries(Object.entries(models).sort(([a],[b])=>a.localeCompare(b,"en")));
 return {types:header+Object.entries(ordered).map(([name,schema])=>`export type ${name} = ${typeFor(schema)};`).join("\n\n")+"\n",schema:header+`export const NATIVE_LANGUAGE_SCHEMAS = ${JSON.stringify(ordered,null,2)} as const;\n`};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const generated=await generateNativeLanguageContract();
 for(const [key,name] of [["types","generated-native-language-types.ts"],["schema","generated-native-language-schema.ts"]]){
  const path=join(root,"src/protocol",name);
  if(process.argv.includes("--check")){if(await readFile(path,"utf8").catch(()=>null)!==generated[key])throw Error(`Native protocol drift: regenerate ${name}`);}else await writeFile(path,generated[key]);
 }
 console.log(process.argv.includes("--check")?"Native language protocol drift check passed.":"Native language protocol generated.");
}
