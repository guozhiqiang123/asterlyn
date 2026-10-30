import "../../src/styles.css";
import { TextEditor } from "../../src/text-editor.ts";
import { EditorNavigationHistory } from "../../src/features/files-editor/editor-navigation-history.ts";
import { editorDocumentKey, type ProjectFileDocument } from "../../src/editor-document.ts";
import { DEFAULT_APP_PREFERENCES } from "../../src/preferences.ts";
import { EN_US } from "../../src/localization/en-US.ts";
import { CommandRegistry, CommandService } from "../../src/application/commands/command-service.ts";
import { registerWorkbenchCommands } from "../../src/composition/workbench-command-runtime.ts";
import { KeybindingController } from "../../src/features/keybindings/keybinding-controller.ts";
import { KeybindingStore, createSilentKeybindingSync } from "../../src/features/keybindings/keybinding-store.ts";
import { DEFAULT_KEYBINDINGS } from "../../src/features/keybindings/default-keybindings.ts";
import { WindowKeybindingBinding } from "../../src/shell/window-keybinding-binding.ts";

const documents = new Map(["a.ts", "b.ts", "c.ts"].map(path => [path, {
  kind: "project-file", repositoryRoot: "/repo", repositoryId: ".", path, workspacePath: path,
} as ProjectFileDocument]));
const contents = new Map([...documents.keys()].map(path => [path, Array.from({length:80}, (_, i) => `const ${path[0]}${i + 1} = ${i + 1};`).join("\n")]));
let active = "a.ts", now = 1000;
const outcomes: unknown[] = [];
const editor = new TextEditor({ load: async () => null as any, openCommit() {}, status() {}, error(error) {throw error;} }, EN_US.editor);
function mount(path: string) {
  active = path; const doc = documents.get(path)!;
  editor.mount(document.querySelector("#editor")!, editorDocumentKey(doc), 1, contents.get(path)!, contents.get(path)!, path,
    DEFAULT_APP_PREFERENCES, null, "untracked", () => {});
}
const history = new EditorNavigationHistory({
  open: async document => {if(!documents.has(document.path))return "missing"; mount(document.path); return "opened";},
  select: (anchor, head) => editor.restoreNavigationSelection(anchor, head),
  diagnostic: (direction, outcome) => outcomes.push({direction, outcome}),
}, () => now);
history.reset("/repo");
editor.setNavigationObserver(update => {const doc = documents.get(active)!; if(update.tabId===editorDocumentKey(doc))history.observe(doc, update);});
const registry = new CommandRegistry();
const releaseCommands = registerWorkbenchCommands(registry, {
  root: document, catalog: () => EN_US, workspaceOpen: () => true, gitAvailable: () => false,
  settingsOpen: () => false, leftToolVisible: () => false, bottomToolVisible: () => false,
  editorFindAvailable: () => true, historyFindAvailable: () => false, saveAvailable: () => true,
  refreshAvailable: () => true, openCommandSurface() {}, openRepository() {}, openEditorFind() {},
  focusHistoryFilter() {}, saveFile() {}, refresh() {}, openSettings() {}, closeSettings() {},
  toggleTool() {}, hideLeftTool() {}, hideBottomTool() {}, navigationHistory: history,
});
const keys = new KeybindingController(registry, new KeybindingStore({getItem:()=>null,setItem(){}}, createSilentKeybindingSync()),
  DEFAULT_KEYBINDINGS.filter(rule => rule.id.startsWith("workbench.navigation.")), "macos");
const service = new CommandService(registry, {blocked: reason => outcomes.push({blocked:reason}), error(error) {throw error;}});
const binding = new WindowKeybindingBinding(window, keys, service, {scope:()=>"editor",pending(){},blocked(){},error(error){throw error;}});
binding.bind(); mount("a.ts");
const view = () => (editor as any).activeEntry().view;
const offset = (line: number) => view().state.doc.line(line).from + 2;
(window as any).navigationFixture = {
  jump(path: string, line: number) {now+=1000;mount(path);const pos=offset(line);editor.selectRange(pos,pos+3);},
  insert(text: string) {view().dispatch({changes:{from:0,insert:text}});contents.set(active,editor.content());},
  close(path: string) {editor.dispose(editorDocumentKey(documents.get(path)!));},
  async back() {await history.navigate(-1);},
  snapshot() {const v=view(),selection=v.state.selection.main;return {active,head:selection.head,anchor:selection.anchor,
    line:v.state.doc.lineAt(selection.head).number,selected:v.state.doc.sliceString(selection.from,selection.to),
    focused:v.hasFocus,size:history.size,back:history.available(-1),forward:history.available(1),outcomes};},
  destroy() {binding.dispose();keys.dispose();releaseCommands();editor.destroy();},
};
