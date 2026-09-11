import assert from "node:assert/strict";
import test from "node:test";

import { foldable } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";

import {
  LEGACY_STRUCTURAL_FOLD_MAX_CODE_UNITS,
  withEditorFolding,
} from "../src/editor-folding.ts";

async function languageState(name, doc) {
  const description = languages.find((language) => language.name === name);
  assert.ok(description, `${name} language description is unavailable`);
  const support = withEditorFolding(name, await description.load());
  return EditorState.create({ doc, extensions: [support] });
}

function foldAtLine(state, number) {
  const line = state.doc.line(number);
  return foldable(state, line.from, line.to);
}

test("Kotlin folding follows structural braces and ignores tokenized literals", async () => {
  const state = await languageState(
    "Kotlin",
    `class Main {
  val sample = "not a block { }"
  // neither is this {
  fun render() {
    if (true) {
      println(sample)
    }
  }
}`,
  );

  assert.ok(foldAtLine(state, 1));
  assert.equal(foldAtLine(state, 2), null);
  assert.equal(foldAtLine(state, 3), null);
  assert.ok(foldAtLine(state, 4));
  assert.ok(foldAtLine(state, 5));
});

test("Groovy and Gradle blocks receive brace folds without comment false positives", async () => {
  const state = await languageState(
    "Groovy",
    `plugins {
  id 'com.android.application'
}
// ignored {
android {
  defaultConfig {
    applicationId "dev.asterlyn"
  }
}`,
  );

  assert.ok(foldAtLine(state, 1));
  assert.equal(foldAtLine(state, 4), null);
  assert.ok(foldAtLine(state, 5));
  assert.ok(foldAtLine(state, 6));
});

test("XML fold controls anchor to the first line of a multiline opening tag", async () => {
  const state = await languageState(
    "XML",
    `<?xml version="1.0"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <TextView android:layout_width="wrap_content" />
</androidx.constraintlayout.widget.ConstraintLayout>`,
  );

  const range = foldAtLine(state, 2);
  assert.ok(range);
  assert.equal(state.sliceDoc(range.from, range.to).includes("TextView"), true);
  assert.equal(foldAtLine(state, 5), null);
});

test("legacy structural folding fails closed above its synchronous budget", async () => {
  const state = await languageState(
    "Kotlin",
    `fun oversized() {\n${" ".repeat(LEGACY_STRUCTURAL_FOLD_MAX_CODE_UNITS)}\n}`,
  );
  assert.equal(foldAtLine(state, 1), null);
});
