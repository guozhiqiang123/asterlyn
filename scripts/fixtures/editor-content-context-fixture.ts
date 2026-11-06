import "../../src/styles.css";
import "../../src/shared/layout.css";
import "../../src/shared/controls.css";
import "../../src/shared/context-menu/context-menu.css";
import { TextEditor } from "../../src/text-editor.ts";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { LazyContextMenuHost } from "../../src/shared/context-menu/lazy-context-menu-host.ts";
import { EditorContentContextRuntime } from "../../src/features/files-editor/editor-content-context.ts";
import { DEFAULT_APP_PREFERENCES } from "../../src/preferences.ts";
import { EN_US } from "../../src/localization/en-US.ts";
const host = new LazyContextMenuHost(document, window);
const initial = "\uFEFFconst value = '😀';\r\nconst other = value;\r\n";
const state = {clipboard:"inserted 😀",changed:false,fail:false,pending:false,claimContext:false,epoch:0,active:"a.ts",calls:[] as unknown[],errors:[] as string[],statuses:[] as string[]};
let release: (()=>void)|null=null;
const clipboardWait = async () => {if(state.pending)await new Promise<void>(resolve=>{release=resolve;});if(state.fail)throw Error("clipboard denied");};
const runtime = new EditorContentContextRuntime({
  host, copy:()=>EN_US.editor.contentContext,
  clipboard:{async readText(){await clipboardWait();return state.clipboard;},async writeText(text){await clipboardWait();state.clipboard=text;}},
  file:()=>{const epoch=state.epoch;return {changed:state.changed,reveal:{kind:"enabled"},history:{kind:"enabled"},diff:{kind:"enabled"},rollback:{kind:"enabled"},
    isCurrent:()=>epoch===state.epoch,revealFile:()=>{state.calls.push("reveal");},showHistory:()=>{state.calls.push("history");},showDiff:()=>{state.calls.push("diff");},rollBack:()=>{state.calls.push("rollback");}};},
  find:text=>state.calls.push(["find",text]),status:text=>state.statuses.push(text),error:error=>state.errors.push(String(error)),
});
const editor = new TextEditor({load:async()=>null as any,openCommit(){},status(){},error(error){state.errors.push(String(error));}},EN_US.editor,host,runtime);
const view=()=> (editor as any).activeEntry().view;
function mount(path="a.ts",readOnly=false) {
  host.close();state.epoch++;state.active=path;
  editor.destroy();editor.setReadOnly(readOnly);
  editor.mount(document.querySelector("#editor")!,path,state.epoch,initial,initial,path,DEFAULT_APP_PREFERENCES,null,"Unavailable",()=>{});
  view().contentDOM.addEventListener("contextmenu",(event:MouseEvent)=>{if(state.claimContext&&event.ctrlKey)event.preventDefault();},true);
}
(window as any).editorContextFixture={
  reset(readOnly=false){state.calls=[];state.errors=[];state.statuses=[];state.clipboard="inserted 😀";state.changed=false;state.fail=false;state.pending=false;mount("a.ts",readOnly);},
  select(text="value"){const v=view(),from=v.state.doc.toString().indexOf(text);editor.selectRange(from,from+text.length);return from;},
  caret(){editor.selectRange(0,0);},
  nativeFallbackSuppressed(){const event=new MouseEvent("contextmenu",{bubbles:true,cancelable:true});document.body.dispatchEvent(event);return event.defaultPrevented;},
  multiple(){const v=view();v.dispatch({effects:StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true))});const s=v.state.doc.toString();const first=s.indexOf("value"),last=s.lastIndexOf("value");v.dispatch({selection:EditorSelection.create([EditorSelection.range(first,first+5),EditorSelection.range(last,last+5)])});},
  point(){const v=view(),p=v.coordsAtPos(v.state.selection.main.from);return {x:p.left+2,y:(p.top+p.bottom)/2};},
  snapshot(){return {...state,content:editor.content(),selected:view().state.sliceDoc(view().state.selection.main.from,view().state.selection.main.to),focused:view().hasFocus,owner:document.querySelector<HTMLElement>(".context-menu-layer")?.dataset.contextMenuOwner ?? null};},
  configure(values:Partial<typeof state>){Object.assign(state,values);},
  switch(){const before=view();state.epoch++;state.active="b.ts";
    editor.mount(document.querySelector("#editor")!,"b.ts",state.epoch,initial,initial,"b.ts",DEFAULT_APP_PREFERENCES,null,"Unavailable",()=>{});
    state.calls.push(["viewReused",view()===before]);
  },release(){state.pending=false;release?.();release=null;},undo(){undo(view());},
  dispose(){editor.destroy();host.dispose();},
};
mount();
