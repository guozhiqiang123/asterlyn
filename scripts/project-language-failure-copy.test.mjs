import assert from "node:assert/strict";
import test from "node:test";
import {projectLanguageFailureMessage} from "../src/localization/project-language-failure-copy.ts";

test("project failure tips explain the module, dependency and recovery in both locales",()=>{
 const detail={kind:"dependency-offline",module:":feature-push",dependency:"org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2",remaining:2};
 assert.match(projectLanguageFailureMessage(detail,"en"),/offline cache.*:feature-push.*kotlinx-coroutines-play-services:1.10.2.*\+2 more.*Restore Gradle dependencies/u);
 assert.match(projectLanguageFailureMessage(detail,"zh-CN"),/离线缓存.*:feature-push.*另有 2 项.*联网恢复 Gradle 依赖/u);
 for(const kind of ["dependency-tls","dependency-dns","dependency-unavailable","repository-credentials-missing","android-sdk-missing","project-configuration-failed","project-script-failed","model-selected-variant-missing","model-dependency-variant-missing","model-dependency-variant-ambiguous"]){assert.ok(projectLanguageFailureMessage({kind},"en"));assert.ok(projectLanguageFailureMessage({kind},"zh-CN"));}
});
test("tips never format arbitrary error messages, URLs or source paths",()=>{
 const message=projectLanguageFailureMessage({kind:"dependency-offline",module:"/private/source",dependency:"https://user:secret@repository",remaining:999999,message:"secret source code"},"en");
 assert.doesNotMatch(message,/secret|private|https|source code|999999/u);
 for(const input of [null,[],"raw secret",{kind:"unknown"},{kind:"__proto__"}])assert.equal(projectLanguageFailureMessage(input,"en"),null);
});
