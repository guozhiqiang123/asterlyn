/** Semantic coverage is independent of the number of rows retained by a presentation. */
export interface LanguageResultCoverage {
  readonly state: "complete" | "partial" | "unknown";
  readonly reasons: readonly ("provider-not-reported" | "indexing" | "candidate-limit" | "files-skipped" | "backend-unavailable" | "invalid-results")[];
}
export const UNKNOWN_LANGUAGE_COVERAGE: LanguageResultCoverage = Object.freeze({state:"unknown",reasons:Object.freeze(["provider-not-reported"] as const)});
const reasons=new Set(["provider-not-reported","indexing","candidate-limit","files-skipped","backend-unavailable","invalid-results"]);
export function languageResultCoverage(value:unknown):LanguageResultCoverage {
  if(!value||typeof value!=="object"||Array.isArray(value))return UNKNOWN_LANGUAGE_COVERAGE;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(key=>key!=="state"&&key!=="reasons")||!["complete","partial","unknown"].includes(String(v.state))||!Array.isArray(v.reasons)||v.reasons.length>6||!v.reasons.every(reason=>typeof reason==="string"&&reasons.has(reason))||new Set(v.reasons).size!==v.reasons.length)return UNKNOWN_LANGUAGE_COVERAGE;
  if((v.state==="complete"&&v.reasons.length!==0)||(v.state!=="complete"&&v.reasons.length===0))return UNKNOWN_LANGUAGE_COVERAGE;
  return {state:v.state as LanguageResultCoverage["state"],reasons:[...v.reasons] as LanguageResultCoverage["reasons"]};
}
