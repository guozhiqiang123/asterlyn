import {isNativeLanguageModel} from "./native-language-validation.ts";
import type {JavaToolchainSnapshot} from "./toolchain.ts";
import type {DesktopCommandName} from "./generated-desktop-protocol.ts";
import {assert,record} from "./desktop-result-validation-primitives.ts";
const text=(value:unknown,max:number):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const major=(value:unknown):value is number=>Number.isInteger(value)&&Number(value)>0&&Number(value)<=65535;
export function assertToolchains(value:unknown,command:DesktopCommandName):asserts value is readonly JavaToolchainSnapshot[]{
  assert(Array.isArray(value)&&value.length<=32,command,"toolchains must be bounded");
  for(const raw of value as unknown[]){assert(isNativeLanguageModel("ToolchainSnapshot",raw),command,"invalid native toolchain shape");const item=record(raw,command),req=record(item.requirement,command);
    assert(text(item.id,128)&&text(item.selectionReason,128),command,"invalid toolchain selection");
    assert(["build-runtime","build-model","language-server"].includes(String(item.role)),command,"invalid toolchain role");
    assert(["installed","environment","project","user","command-line"].includes(String(item.source)),command,"invalid toolchain source");
    assert(text(item.version,128)&&/^[A-Za-z0-9._+-]+$/u.test(item.version)&&major(item.major),command,"invalid toolchain version");
    const parts=String(item.version).split(/[.+-]/u);
    assert(Number(parts[0]==="1"?parts[1]:parts[0])===item.major,command,"toolchain version and major disagree");
    assert(text(item.identity,71)&&/^sha256:[a-f0-9]{64}$/u.test(item.identity),command,"invalid toolchain identity");
    for(const path of [item.home,item.executable])assert(text(path,4096)&&/^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(path),command,"invalid toolchain location");
    assert(major(req.minimumMajor)&&(req.maximumMajorExclusive===undefined||major(req.maximumMajorExclusive)&&req.maximumMajorExclusive>req.minimumMajor),command,"invalid toolchain requirement");
    assert(Number(item.major)>=Number(req.minimumMajor)&&(req.maximumMajorExclusive===undefined||Number(item.major)<Number(req.maximumMajorExclusive)),command,"incompatible toolchain snapshot");
  }
}
