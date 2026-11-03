import {NATIVE_LANGUAGE_SCHEMAS} from "./generated-native-language-schema.ts";
import type {NativeLanguageServiceFailure} from "./generated-native-language-types.ts";
type Schema={readonly [key:string]:unknown};
const models=NATIVE_LANGUAGE_SCHEMAS as Readonly<Record<string,Schema>>;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
/** Structural output checks derive from serde. Unknown output fields remain forward compatible. */
export function isNativeLanguageModel(name:keyof typeof NATIVE_LANGUAGE_SCHEMAS,value:unknown,optionalFields:readonly string[]=[]):boolean {
 let nodes=0;
 const check=(schema:Schema,value:unknown,depth:number,optional:readonly string[]=[]):boolean=>{
  if(++nodes>16384||depth>32)return false;
  if(typeof schema.$ref==="string"){const target=models[schema.$ref.split("/").at(-1)!];return !!target&&check(target,value,depth+1);}
  if(Array.isArray(schema.enum))return schema.enum.includes(value);
  if(Array.isArray(schema.anyOf))return schema.anyOf.some(item=>record(item)&&check(item,value,depth+1));
  if(Array.isArray(schema.oneOf))return schema.oneOf.filter(item=>record(item)&&check(item,value,depth+1)).length===1;
  if(Array.isArray(schema.allOf))return schema.allOf.every(item=>record(item)&&check(item,value,depth+1));
  if(Array.isArray(schema.type))return schema.type.some(type=>check({...schema,type},value,depth+1));
  switch(schema.type){
   case "object":{
    if(!record(value))return false;
    const required=Array.isArray(schema.required)?schema.required:[],properties=record(schema.properties)?schema.properties:{};
    if(!required.every(key=>typeof key==="string"&&(optional.includes(key)||Object.hasOwn(value,key)&&value[key]!==undefined)))return false;
    for(const [key,type] of Object.entries(properties))if(value[key]!==undefined&&(!record(type)||!check(type,value[key],depth+1)))return false;
    if(record(schema.additionalProperties))for(const [key,item] of Object.entries(value))if(!Object.hasOwn(properties,key)&&!check(schema.additionalProperties,item,depth+1))return false;
    return true;
   }
   case "array":return Array.isArray(value)&&value.length>=(typeof schema.minItems==="number"?schema.minItems:0)&&value.length<=Math.min(typeof schema.maxItems==="number"?schema.maxItems:4096,4096)&&record(schema.items)&&value.every(item=>check(schema.items as Schema,item,depth+1));
   case "integer":case "number":return typeof value==="number"&&Number.isFinite(value)&&(schema.type!=="integer"||Number.isSafeInteger(value))&&(typeof schema.minimum!=="number"||value>=schema.minimum)&&(typeof schema.maximum!=="number"||value<=schema.maximum);
   case "string":return typeof value==="string"&&(typeof schema.minLength!=="number"||value.length>=schema.minLength)&&(typeof schema.maxLength!=="number"||value.length<=schema.maxLength);
   case "boolean":return typeof value==="boolean";case "null":return value===null;
   case undefined:return Object.keys(schema).every(key=>["description","default"].includes(key));
  }
  return false;
 };
 return !!models[name]&&check(models[name],value,0,optionalFields);
}
export function languageFailure(value:unknown):NativeLanguageServiceFailure|undefined {
 if(!isNativeLanguageModel("NativeLanguageServiceFailure",value)||!record(value))return;
 if(value.retryable!==(value.code==="backend-exited")||typeof value.message!=="string"||value.message.length>512||/[\u0000-\u001f\u007f]/u.test(value.message))return;
 if(value.requestId!==undefined&&value.requestId!==null&&(typeof value.requestId!=="string"||value.requestId.length>128))return;
 return value as unknown as NativeLanguageServiceFailure;
}
