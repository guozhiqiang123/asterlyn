import test from "node:test";
import assert from "node:assert/strict";
import {languageServiceFailure} from "../src/adapters/tauri/language-service-failure.ts";
import {LanguageServiceIndexingError} from "../src/protocol/editor-language-service.ts";

test("current generic and legacy native loading states remain informational", () => {
  for(const message of ["Language services are loading this project. Try navigation again shortly.", "Rust language services are loading this project. Try navigation again shortly."]) assert.ok(languageServiceFailure(message) instanceof LanguageServiceIndexingError);
  const failure = new Error("backend unavailable"); assert.equal(languageServiceFailure(failure), failure);
});
