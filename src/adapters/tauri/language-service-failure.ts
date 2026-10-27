import {LanguageServiceIndexingError} from "../../protocol/editor-language-service.ts";

/** Current native profile-neutral state plus compatibility with older Rust sessions. */
export function languageServiceFailure(error: unknown): unknown {
  return error === "Language services are loading this project. Try navigation again shortly." || error === "Rust language services are loading this project. Try navigation again shortly."
    ? new LanguageServiceIndexingError() : error;
}
