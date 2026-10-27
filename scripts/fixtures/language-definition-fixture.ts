import { LanguageServiceIndexingError } from "../../src/protocol/editor-language-service.ts";
import "../../src/styles.css";
import "../../src/features/files-editor/language-location-picker.css";
import { TextEditor } from "../../src/text-editor.ts";
import { DEFAULT_APP_PREFERENCES } from "../../src/preferences.ts";
import { EN_US } from "../../src/localization/en-US.ts";
import { ContextMenuHost } from "../../src/shared/context-menu/context-menu-host.ts";
import { createLanguageDefinitionNavigator } from "../../src/composition/language-definition-navigation.ts";
import { workspaceFileUri } from "../../src/composition/language-services-runtime.ts";
const source = 'import { target } from "./目录/target file";\nconst emoji = "😀";\nconst result = target();\n';
const files = [
  { repositoryId: ".", path: "source.ts", workspacePath: "source.ts" },
  { repositoryId: ".", path: "目录/target file.ts", workspacePath: "目录/target file.ts" },
  { repositoryId: ".", path: "other.ts", workspacePath: "other.ts" },
];
const contents = [source, "\uFEFFexport function target() { return 1; }\r\n", "export const target = 2;\n"];
const state: any = { mode: "link", active: files[0], requests: [], statuses: [], outcomes: [], pending: [], epoch: 1 };
const menu = new ContextMenuHost(document, window);
const editor = new TextEditor({ load: async () => null as any, openCommit() {}, status(message, kind) { state.statuses.push({ message, kind }); }, error(error) { throw error; } }, EN_US.editor, menu);
const range = (line: number, from: number, to: number) => ({ start: { line, character: from }, end: { line, character: to } });
const definition = () => ({ targetUri: workspaceFileUri("/repo", files[1]!.workspacePath), targetRange: range(0, 0, 0), targetSelectionRange: range(1, 17, 23) });
const second = () => ({ uri: workspaceFileUri("/repo", files[2]!.workspacePath), range: range(0, 13, 19) });
const readonlyTarget = () => ({uri: `asterlyn-source://${"a".repeat(64)}/SDK.java`, range: range(0, 13, 19), readonlySource: {text: "public class Target {}\n", path: "SDK.java", languageId: "java"}});
function mount(index: number, epoch = index === 0 ? state.epoch : 1) {
  state.active = files[index]; editor.setReadOnly(false);
  editor.mount(document.querySelector("#editor")!, files[index]!.workspacePath, epoch, contents[index]!, contents[index]!, files[index]!.path, DEFAULT_APP_PREFERENCES, null, "untracked", () => {});
}
const navigate = createLanguageDefinitionNavigator({ workspace: () => ({ root: "/repo", generation: 1 }), files: () => files,
  open: async (_root, file) => { mount(files.findIndex((entry) => entry.workspacePath === file.workspacePath)); },
  openSource: async (_root, location) => {state.active = {workspacePath: "SDK.java", uri: location.uri}; editor.setReadOnly(true); const source = location.readonlySource!; editor.mount(document.querySelector("#editor")!, location.uri, 1, source.text, source.text, source.path, DEFAULT_APP_PREFERENCES, null, "untracked", () => {});},
  activeUri: () => state.active.uri ?? workspaceFileUri("/repo", state.active.workspacePath), content: () => editor.content(), select: (from, to) => editor.selectRange(from, to),
  copy: () => EN_US.editor.languageService, status: (message, kind) => state.statuses.push({ message, kind }), diagnostic: (outcome) => state.outcomes.push(outcome),
});
const port: any = { open() {}, update() {}, close() {}, subscribeDiagnostics: () => () => {},
  get documentUri() { return workspaceFileUri("/repo", state.active.workspacePath); },
  definitionEvent(event) { state.outcomes.push(event); }, navigate: (location) => { void navigate(location); },
  request(_handle, method, params, version) {
    if (!["textDocument/definition", "textDocument/references"].includes(method)) return Promise.resolve(null);
    state.requests.push({ method, params, version });
    if (state.mode === "indexing") return Promise.reject(new LanguageServiceIndexingError());
    if (method === "textDocument/references") {
      if (state.mode === "deferredReferences") return new Promise((resolve) => state.pending.push(resolve));
      if (state.mode === "noReferences") return Promise.resolve([]);
      if (state.mode === "oneReference") return Promise.resolve([second()]);
      if (state.mode === "manyReferences") return Promise.resolve(Array.from({ length: 600 }, (_, line) => ({ ...second(), range: range(line, 13, 19) })));
      return Promise.resolve([definition(), second()]);
    }
    if (state.mode === "deferred") return new Promise((resolve) => state.pending.push(resolve));
    if (state.mode === "empty") return Promise.resolve(null);
    if (state.mode === "outside") return Promise.resolve({ uri: "file:///outside/secret.ts", range: range(0, 0, 3) });
    if (state.mode === "readonly") return Promise.resolve(readonlyTarget());
    if (state.mode === "multiple") return Promise.resolve([definition(), second()]);
    if (state.mode === "same") return Promise.resolve({ uri: workspaceFileUri("/repo", files[0]!.workspacePath), range: range(0, 9, 15) });
    if (["self", "deferredReferences", "oneReference", "noReferences"].includes(state.mode)) return Promise.resolve({ uri: workspaceFileUri("/repo", files[0]!.workspacePath), range: range(2, 15, 21) });
    return Promise.resolve(definition());
  },
};
editor.setLanguageServices(() => port);
mount(1);
(editor as any).activeEntry().view.dispatch({ changes: { from: 0, insert: "// unsaved 😀\n" } });
mount(0);
const fixture = { state, editor, menu, definition, second,
  reset(mode = "link") { state.mode = mode; state.epoch++; mount(0); state.requests.length = 0; state.statuses.length = 0; state.outcomes.length = 0; state.pending.length = 0; },
  otherTab() { mount(2); },
  resolve(index = 0) { state.pending[index]?.(definition()); },
  point(which = "use") { const view = (editor as any).activeEntry().view; const text = view.state.doc.toString(); const pos = which === "use" ? text.lastIndexOf("target") + 2 : 1; const bounds = view.coordsAtPos(pos); if (!bounds) throw Error("symbol has no coordinates"); return { x: bounds.left + 1, y: (bounds.top + bounds.bottom) / 2, pos }; },
  snapshot() { const view = (editor as any).activeEntry().view; return { active: state.active.workspacePath, text: view.state.doc.toString(), exact: editor.content(), selection: view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to), head: view.state.selection.main.head, focused: view.hasFocus, requests: state.requests, statuses: state.statuses, outcomes: state.outcomes }; },
  destroy() { editor.destroy(); menu.dispose(); },
};
(window as any).definitionFixture = fixture;
