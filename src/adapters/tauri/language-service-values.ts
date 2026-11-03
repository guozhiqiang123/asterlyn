/** Feature-scoped wire parsing, independent of Tauri loading and window globals. */
import type {LanguageServiceReview,LanguageServiceEvent} from "../../protocol/language-service.ts";
import {assertLanguageServiceReview,languageServiceProgress} from "../../protocol/validate-language-service.ts";
import {languageFailure} from "../../protocol/native-language-validation.ts";
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid language service result");return value as Record<string,unknown>;};
const text=(value:unknown,max=16384):value is string=>typeof value==="string"&&value.length>0&&value.length<=max;
export function validateLanguageReview(value: unknown): LanguageServiceReview {
  assertLanguageServiceReview(value);
  return value;
}
export function eventValue(value: unknown): LanguageServiceEvent | null {
  const item = record(value); if (!text(item.sessionId, 128)) return null;
  if (item.kind === "terminated" || item.kind === "indexing" || item.kind === "ready" || item.kind === "degraded" || item.kind === "recovering") return { kind: item.kind, sessionId: item.sessionId,
    ...(typeof item.code==="string"&&/^[a-z][a-z0-9.-]{0,79}$/u.test(item.code)?{code:item.code}:{}),progress:languageServiceProgress(item.progress),failure:languageFailure(item.failure) };
  if (item.kind !== "diagnostics" || !text(item.uri) || !Number.isSafeInteger(item.version) || !Array.isArray(item.diagnostics) || item.diagnostics.length > 512) return null;
  const position = (p: unknown) => { const v = record(p); return Number.isSafeInteger(v.line) && Number(v.line) >= 0 && Number.isSafeInteger(v.character) && Number(v.character) >= 0; };
  if (!item.diagnostics.every((d) => { const v = record(d); const range = record(v.range); return text(v.message, 8192) && position(range.start) && position(range.end) && (v.severity === undefined || [1, 2, 3, 4].includes(Number(v.severity))); })) return null;
  return item as unknown as LanguageServiceEvent;
}
