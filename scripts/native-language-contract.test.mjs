import test from "node:test";
import assert from "node:assert/strict";
import {isNativeLanguageModel,languageFailure} from "../src/protocol/native-language-validation.ts";
import {validateLanguageReview,eventValue} from "../src/adapters/tauri/language-service-values.ts";
import {typeFor} from "./generate-native-language-contract.mjs";
const review={reviewId:"r",pluginId:"dev.asterlyn.lsp",serverId:"typescript",pluginVersion:"0.3.12",packageDigest:"sha256:package",resourceDigest:"sha256:resource",executableIdentity:"node",expiresAt:1800000000000};
const failure={code:"resource-limit",retryable:false,message:"Resource limit reached.",requestId:null};
test("native model output validates nullable, optional, enums and safe integers",()=>{
  assert.equal(isNativeLanguageModel("NativeLanguageServiceFailure",failure),true);
  assert.equal(isNativeLanguageModel("NativeLanguageServiceFailure",{...failure,requestId:"r-1",futureField:3}),true);
  for(const bad of [{...failure,code:undefined},{...failure,code:"invented"},{...failure,retryable:"no"},{...failure,requestId:42}])assert.equal(isNativeLanguageModel("NativeLanguageServiceFailure",bad),false);
  assert.equal(isNativeLanguageModel("NativeLanguageServiceReview",{...review,remembered:true,toolchains:[]}),true);
  assert.equal(isNativeLanguageModel("NativeLanguageServiceReview",{...review,remembered:true,toolchains:[],expiresAt:Number.MAX_SAFE_INTEGER+1}),false);
});
test("the actual native bridge uses the shared schema and accepts legacy optional omissions",()=>{
  assert.deepEqual(validateLanguageReview({...review,extraFutureOutput:true}),{...review,extraFutureOutput:true});
  assert.throws(()=>validateLanguageReview({...review,reviewId:undefined,review_id:"r"}));
  assert.throws(()=>validateLanguageReview({...review,toolchains:[{id:"bad"}]}));
  assert.throws(()=>validateLanguageReview({...review,expiresAt:Number.MAX_SAFE_INTEGER+1}));
});
test("typed failure cannot grant retry and malformed new metadata retains legacy termination",()=>{
  assert.equal(languageFailure({...failure,retryable:true}),undefined);
  const legacy={kind:"terminated",sessionId:"s",code:"resource-limit"};
  assert.deepEqual(eventValue({...legacy,failure:{...failure,retryable:true}}),{...legacy,progress:undefined,failure:undefined});
  assert.deepEqual(eventValue({...legacy,failure})?.failure,failure);
});
test("binding generator supports optional versus nullable and rejects unknown schema shapes",()=>{
  assert.match(typeFor({type:"object",required:["required"],properties:{required:{type:"string"},optional:{type:"integer"},nullable:{type:["string","null"]}}}),/"optional"\?: number/u);
  assert.match(typeFor({type:["string","null"]}),/string \| null/u);
  assert.throws(()=>typeFor({type:"unsupported"}));
});
