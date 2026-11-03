import test from "node:test";
import assert from "node:assert/strict";
import {LanguageRecoveryPolicy} from "../src/application/language-services/recovery-policy.ts";

test("only classified unexpected exits receive three bounded exponential restart attempts",()=>{
 const policy=new LanguageRecoveryPolicy();
 for(const [index,delay]of [500,1000,2000].entries())assert.deepEqual(policy.reserve("backend-exited"),{attempt:index+1,maximum:3,delayMs:delay,reason:"backend-exited"});
 assert.equal(policy.reserve("backend-exited"),null);assert.equal(policy.exhausted(),true);
});
test("authorization, tool changes, quarantine, protocol, resource and user stops never restart",()=>{
 for(const code of ["authority-revoked","language-approval-revoked","language-execution-identity-changed","resource-limit","protocol-failed","transport-failed","session-ended","timeout","quarantined","user-stop","model-integrity","repository-credentials-missing",""]){
  const policy=new LanguageRecoveryPolicy();assert.equal(policy.reserve(code),null,code);assert.equal(policy.exhausted(),false);
 }
});
test("brief ready events cannot reset crash-loop protection; only continuous stable readiness resets it",()=>{
 let now=0;const policy=new LanguageRecoveryPolicy(()=>now);
 policy.reserve("backend-exited");policy.healthy(true);now=179999;
 assert.equal(policy.reserve("backend-exited").attempt,2);
 policy.healthy(true);now+=180000;assert.equal(policy.reserve("backend-exited").attempt,1);
 policy.healthy(true);now+=90000;policy.healthy(false);now+=180000;
 assert.equal(policy.reserve("backend-exited").attempt,2);
});
