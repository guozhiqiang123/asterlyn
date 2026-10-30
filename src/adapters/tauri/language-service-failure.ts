import {LanguageServiceIndexingError,LanguageServiceUnavailableError} from "../../protocol/editor-language-service.ts";
export const isLanguageServiceIndexingFailure=(error:unknown):boolean=>error === "Language services are loading this project. Try navigation again shortly." || error === "Rust language services are loading this project. Try navigation again shortly.";

/** Current native profile-neutral state plus compatibility with older Rust sessions. */
export function languageServiceFailure(error: unknown): unknown {
  if(isLanguageServiceIndexingFailure(error))return new LanguageServiceIndexingError();
  if(typeof error==="string"&&(error==="Language services could not load this project. Check language service status and retry."||/^Language services are unavailable \([a-z][a-z0-9.-]{0,79}\)\. Check language service status and retry\.$/u.test(error)))return new LanguageServiceUnavailableError();
  return error;
}
