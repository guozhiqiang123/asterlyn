import "../../src/styles.css";
import { TextEditor } from "../../src/text-editor.ts";
import { DEFAULT_APP_PREFERENCES } from "../../src/preferences.ts";
import { EN_US } from "../../src/localization/en-US.ts";
import { ContextMenuHost } from "../../src/shared/context-menu/context-menu-host.ts";
import { createLanguageDefinitionNavigator } from "../../src/composition/language-definition-navigation.ts";
import { createLanguageServicesRuntime, workspaceFileUri } from "../../src/composition/language-services-runtime.ts";
import { PluginContributionRegistry } from "../../src/application/plugins/plugin-registry.ts";
const data = await (await fetch("/__rust/data")).json();
const files = data.files.map((entry: any) => ({ repositoryId: ".", path: entry.path, workspacePath: entry.path }));
const state: any = { active: files[0], requests: [], errors: [], statuses: [], reviews: [], starts: 0 };
const menu = new ContextMenuHost(document, window);
const editor = new TextEditor({ load: async () => null as any, openCommit() {}, status(message, kind) { state.statuses.push({ message, kind }); }, error(error) { state.errors.push(String(error)); } }, EN_US.editor, menu);
function mount(index: number) {
  state.active = files[index]; editor.setReadOnly(false);
  editor.mount(document.querySelector("#editor")!, files[index].path, 1, data.files[index].text, data.files[index].text, files[index].path, DEFAULT_APP_PREFERENCES, null, "untracked", () => {});
}
const navigate = createLanguageDefinitionNavigator({ workspace: () => ({ root: data.root, generation: 1 }), files: () => files,
  open: async (_root, file) => { mount(files.findIndex((entry: any) => entry.workspacePath === file.workspacePath)); },
  activeUri: () => workspaceFileUri(data.root, state.active.path), content: () => editor.content(), select: (from, to) => editor.selectRange(from, to),
  copy: () => EN_US.editor.languageService, status: (message, kind) => state.statuses.push({ message, kind }),
});
const registry = new PluginContributionRegistry();
registry.registerExternalBatch({ id: "dev.asterlyn.lsp", version: "0.2.0" }, [{ kind: "language-service", id: "rust", label: "Rust", serverId: "rust-analyzer", languageIds: ["rust"], extensions: [".rs"], rootMarkers: ["Cargo.toml"] }]);
let sessionSequence = 0;
const rpc = async (method: string, params: unknown) => {
  state.requests.push(method);
  const response = await fetch("/__rust/rpc", { method: "POST", body: JSON.stringify({ method, params }) });
  if (!response.ok) throw Error(await response.text()); return (await response.json()).result;
};
const runtime = createLanguageServicesRuntime({ registry, workspace: () => ({ root: data.root, generation: 1 }), document: (handle) => ({ workspacePath: handle.path, readOnly: false, loadEpoch: 1 }), bind: (factory) => editor.setLanguageServices(factory), navigate: (location) => { void navigate(location); }, reportError: (error) => state.errors.push(String(error)),
  native: { prepare: async (_root, pluginId, serverId = "typescript") => ({ reviewId: "controlled-test", pluginId, serverId, pluginVersion: "0.2.0", packageDigest: "controlled-test", resourceDigest: "controlled-test", executableIdentity: "controlled-test", expiresAt: Date.now() + 60000 }),
    confirm: async (review) => { state.reviews.push(review.serverId); return true; }, start: async () => { state.starts++; return `controlled-test-${++sessionSequence}`; }, stop: async () => {}, cancel: async () => {}, subscribe: () => () => {},
    open: async (_root, _session, uri, languageId, version, text) => { await rpc("textDocument/didOpen", { textDocument: { uri, languageId, version, text } }); },
    change: async (_root, _session, uri, version, changes) => { await rpc("textDocument/didChange", { textDocument: { uri, version }, contentChanges: changes.map(({ text }) => ({ text })) }); },
    close: async (_root, _session, uri) => { await rpc("textDocument/didClose", { textDocument: { uri } }); },
    request: async (_root, sessionId, uri, version, _id, feature, line, character) => ({ sessionId, uri, version, result: await rpc(`textDocument/${feature}`, { textDocument: { uri }, position: { line, character }, ...(feature === "references" ? { context: { includeDeclaration: false } } : {}) }) }),
  },
});
runtime.refresh(); mount(0);
(window as any).rustFixture = { state, editor,

  source() { mount(0); },
  point() { const view = (editor as any).activeEntry().view; const pos = view.state.doc.toString().indexOf("start(&TypeScriptServerProfile") + 2; editor.selectRange(pos, pos); },
  coords() { const view = (editor as any).activeEntry().view; const box = view.coordsAtPos(view.state.selection.main.head); return { x: box.left + 1, y: (box.top + box.bottom) / 2 }; },
  selection() { const view = (editor as any).activeEntry().view; return view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to); },
  dispose() { runtime.dispose(); editor.destroy(); menu.dispose(); },
};
