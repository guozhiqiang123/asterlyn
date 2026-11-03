import test from "node:test";
import assert from "node:assert/strict";
import {assertToolchains} from "../src/protocol/validate-toolchain.ts";
import {toolchainDescription,EN_TOOLCHAINS,ZH_TOOLCHAINS} from "../src/localization/toolchain-copy.ts";
import {languageExecutionConfirmation} from "../src/composition/language-execution-confirmation.ts";
const tool={id:"serverJava",role:"language-server",source:"installed",version:"25.0.5+8",major:25,home:"/opt/jdk25",executable:"/opt/jdk25/bin/java",identity:`sha256:${"a".repeat(64)}`,requirement:{minimumMajor:25,maximumMajorExclusive:26},selectionReason:"lowest-compatible"};
test("validates selected Java roles, versions, requirements and bounded identities",()=>{
  assertToolchains([tool],"prepare_language_service");
  assertToolchains([{...tool,role:"build-model",home:"C:\\JDK",executable:"C:\\JDK\\bin\\java.exe"}],"prepare_language_service");
  for(const invalid of [null,{},Array(33).fill(tool),[{...tool,role:"source-target"}],[{...tool,source:"shell"}],[{...tool,major:17}],[{...tool,identity:"sha256:bad"}],[{...tool,home:"relative"}],[{...tool,version:"17\n"}],[{...tool,major:Number.MAX_SAFE_INTEGER+1}],[{...tool,requirement:{minimumMajor:25,maximumMajorExclusive:25}}]])assert.throws(()=>assertToolchains(invalid,"prepare_language_service"));
});
test("explains separate runtime roles without confusing source target or changing consent",()=>{
  assert.throws(()=>assertToolchains([{...tool,version:"17.0.14"}],"prepare_language_service"));
  assert.match(toolchainDescription(tool,EN_TOOLCHAINS),/Language server JVM.*serverJava.*25\.0\.5/u);
  assert.match(toolchainDescription({...tool,role:"build-model"},ZH_TOOLCHAINS),/项目模型工作进程 JVM/u);
  const review={reviewId:"r",pluginId:"dev.asterlyn.lsp",serverId:"android-jvm",pluginVersion:"0.3.12",packageDigest:"package",resourceDigest:"resource",executableIdentity:"node",expiresAt:1,toolchains:[tool]};
  const prompt=languageExecutionConfirmation(review,false);assert.match(prompt.message,/Requires Java 25/u);assert.match(prompt.message,/\/opt\/jdk25/u);assert.match(prompt.message,/Changed plugins/u);
  const legacy=languageExecutionConfirmation({...review,toolchains:undefined},false);assert.doesNotMatch(legacy.message,/Java toolchains/u);
});
