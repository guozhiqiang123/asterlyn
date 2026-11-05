import test from 'node:test';import assert from 'node:assert/strict';
import {shouldNotifyLanguageFailure} from '../src/application/language-services/failure-notification-policy.ts';
import {languageServiceFailureMessage} from '../src/localization/language-service-failure-copy.ts';
const failure={code:'unavailable',retryable:false,message:'secret=/private/source password=never-render',requestId:null};
test('settled model and unknown failures notify; running recovery and deliberate cancellation stay quiet',()=>{
 for(const state of ['failed','partial','ready'])assert.equal(shouldNotifyLanguageFailure({state,progress:{phase:'failed'},failure}),true);
 for(const state of ['preparing','recovering','indexing','stopped','declined'])assert.equal(shouldNotifyLanguageFailure({state,progress:{phase:'failed'},failure}),false);
 assert.equal(shouldNotifyLanguageFailure({state:'partial',progress:{phase:'backend'},failure}),false);
 for(const code of ['cancelled','authority-revoked'])assert.equal(shouldNotifyLanguageFailure({state:'failed',failure:{code}}),false);
 for(const code of ['requested-stop','session-ended','request-cancelled','language-approval-revoked'])assert.equal(shouldNotifyLanguageFailure({state:'failed',code}),false);
 assert.equal(shouldNotifyLanguageFailure({state:'failed'}),true);
 assert.equal(shouldNotifyLanguageFailure({state:'failed',reported:true}),false);
});
test('compatibility guidance works with older generic native envelopes and never blames valid builds',()=>{
 assert.match(languageServiceFailureMessage(failure,'gradle-model-incompatible','en'),/integration.*build-model interface.*Update.*builds may still succeed/u);
 assert.match(languageServiceFailureMessage(failure,'gradle-model-incompatible','zh-CN'),/集成插件.*构建模型接口.*编译仍可能成功/u);
 for(const code of ['gradle-version-incompatible','gradle-toolchain-incompatible','kotlin-compiler-failed','kotlin-compiler-timeout'])for(const locale of ['en','zh-CN'])assert.ok(languageServiceFailureMessage(failure,code,locale));
 for(const reason of ['secret=/private/path','https://user:secret@repo','__proto__',undefined])for(const locale of ['en','zh-CN']){
  const copy=languageServiceFailureMessage(failure,reason,locale);assert.doesNotMatch(copy,/secret|password|private|https|__proto__/u);assert.ok(copy.length>20);
 }
 const project={kind:'dependency-offline',module:':common',dependency:'org.example:library:1.0',remaining:0};
 assert.match(languageServiceFailureMessage({...failure,project},'dependency-offline','en'),/:common.*org.example:library/u);
});
