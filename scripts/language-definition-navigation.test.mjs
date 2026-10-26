import assert from "node:assert/strict";
import test from "node:test";
import { definitionFileKey, definitionOffsets, normalizeDefinitionTargets } from "../src/application/language-services/definition-targets.ts";
import { createLanguageDefinitionNavigator } from "../src/composition/language-definition-navigation.ts";
import { workspaceFileUri } from "../src/composition/language-services-runtime.ts";
import { EN_US_LANGUAGE_SERVICE_COPY } from "../src/localization/language-service-copy.ts";
import { definitionModifier } from "../src/features/files-editor/language-definition-gesture.ts";
const point = (line, character) => ({ line, character });
const range = (line = 0, from = 0, to = 3) => ({ start: point(line, from), end: point(line, to) });
const location = (uri = "file:///repo/a.ts", value = range()) => ({ uri, range: value });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("definition modifiers accept Ctrl everywhere and Command only on macOS", () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(definitionModifier({ ...base, ctrlKey: true }, false), true);
  assert.equal(definitionModifier({ ...base, metaKey: true }, true), true);
  assert.equal(definitionModifier({ ...base, metaKey: true }, false), false);
  for (const flags of [base, { ...base, ctrlKey: true, shiftKey: true }, { ...base, ctrlKey: true, altKey: true }]) assert.equal(definitionModifier(flags, true), false);
});
test("normalizes native Location and LocationLink selection ranges and deduplicates URI aliases", () => {
  const normalized = normalizeDefinitionTargets([location("file:///repo/a%20b.ts"), location("file:///repo/a b.ts"), { targetUri: "file:///repo/types.ts", targetRange: range(0, 0, 99), targetSelectionRange: range(2, 4, 8) }]);
  assert.equal(normalized.locations.length, 2); assert.deepEqual(normalized.locations[1].range, range(2, 4, 8));
  assert.equal(normalized.invalid, false);
});
test("definition targets reject malformed ranges and authority-bearing URIs and remain bounded", () => {
  for (const value of [location("https://example.org/a.ts"), location("file://server/repo/a.ts"), location("file:///repo/a.ts#secret"), location("file:///repo/%00.ts"), location("file:///repo/%QZ.ts"), location(undefined, { start: point(1, 4), end: point(0, 3) }), location(undefined, range(0, -1, 3)), { uri: "file:///repo/a.ts" }]) {
    assert.equal(normalizeDefinitionTargets(value).locations.length, 0, JSON.stringify(value));
  }
  const result = normalizeDefinitionTargets(Array.from({ length: 200 }, (_, i) => location(`file:///repo/${i}.ts`)));
  assert.equal(result.locations.length, 16); assert.equal(result.limited, true);
  assert.deepEqual(normalizeDefinitionTargets(null), { locations: [], limited: false, invalid: false });
  assert.equal(definitionFileKey("file:///c:/x%20y.ts"), "/C:/x y.ts");
});
test("UTF-16 target positions preserve BOM/CRLF and reject split surrogates/out-of-range offsets", () => {
  const text = "\uFEFF😀 x\r\nconst value = 1;\r\n";
  assert.deepEqual(definitionOffsets(text, location(undefined, range(1, 6, 11))), { from: 12, to: 17 });
  assert.deepEqual(definitionOffsets(text, location(undefined, range(0, 1, 3))), { from: 1, to: 3 });
  for (const r of [range(0, 2, 3), range(99, 0, 1), range(0, 99, 100)]) assert.equal(definitionOffsets(text, location(undefined, r)), null);
});
function fixture() {
  const state = { workspace: { root: "/repo", generation: 1 }, active: "file:///repo/a.ts", content: "const value = 1;", selections: [], statuses: [], outcomes: [], opens: [] };
  const files = [{ repositoryId: ".", path: "a.ts", workspacePath: "a.ts" }, { repositoryId: ".", path: "目录/a b.ts", workspacePath: "目录/a b.ts", readOnly: true }];
  const ports = { workspace: () => state.workspace, files: () => files, open: async (_root, file) => { state.opens.push(file); state.active = workspaceFileUri("/repo", file.workspacePath); }, activeUri: () => state.active, content: () => state.content, select: (from, to) => { state.selections.push({ from, to }); return true; }, copy: () => EN_US_LANGUAGE_SERVICE_COPY, status: (message) => state.statuses.push(message), diagnostic: (outcome) => state.outcomes.push(outcome) };
  return { state, ports, files };
}
test("navigation uses the existing dirty target text and allows legal read-only catalog targets", async () => {
  const { state, ports, files } = fixture(); state.content = "\uFEFF// 😀\r\nconst value = 'unsaved';\r\n";
  const navigate = createLanguageDefinitionNavigator(ports); await navigate(location(workspaceFileUri("/repo", files[1].workspacePath), range(1, 6, 11)));
  assert.equal(state.opens[0].readOnly, true); assert.deepEqual(state.selections, [{ from: 13, to: 18 }]);
  assert.deepEqual(state.outcomes, ["opened"]); assert.match(state.content, /unsaved/u);
});
test("outside-catalog definitions produce feedback and cannot open arbitrary files", async () => {
  const { state, ports } = fixture(); const navigate = createLanguageDefinitionNavigator(ports);
  await navigate(location("file:///repo/../private.ts")); await navigate(location("file:///repo/node_modules/unknown.d.ts"));
  assert.equal(state.opens.length, 0); assert.equal(state.statuses.length, 2); assert.equal(state.selections.length, 0);
});
test("a delayed open cannot select the wrong active tab or another workspace generation", async () => {
  for (const mode of ["tab", "workspace"]) {
    const { state, ports } = fixture(), loading = deferred(); ports.open = async () => loading.promise;
    const navigate = createLanguageDefinitionNavigator(ports), result = navigate(location());
    if (mode === "tab") state.active = "file:///repo/other.ts"; else state.workspace = { root: "/repo", generation: 2 };
    loading.resolve(); await result; assert.equal(state.selections.length, 0); assert.deepEqual(state.outcomes, ["stale"]);
  }
});
test("the latest definition navigation wins while older file reads finish", async () => {
  const { state, ports } = fixture(), first = deferred(), second = deferred(); let call = 0;
  ports.open = async () => (++call === 1 ? first.promise : second.promise);
  const navigate = createLanguageDefinitionNavigator(ports), old = navigate(location(undefined, range(0, 0, 3))), latest = navigate(location(undefined, range(0, 6, 11)));
  second.resolve(); await latest; first.resolve(); await old;
  assert.deepEqual(state.selections, [{ from: 6, to: 11 }]); assert.deepEqual(state.outcomes, ["opened", "stale"]);
});
test("a changed target range produces feedback without clamping or selecting a different symbol", async () => {
  const { state, ports } = fixture(); state.content = "x";
  await createLanguageDefinitionNavigator(ports)(location(undefined, range(0, 2, 4)));
  assert.equal(state.selections.length, 0); assert.deepEqual(state.outcomes, ["invalid-range"]); assert.equal(state.statuses.length, 1);
});
