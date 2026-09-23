import assert from "node:assert/strict";
import test from "node:test";
import { EditorSessionController } from "../src/features/files-editor/editor-session-controller.ts";
import { EditorSurface } from "../src/features/files-editor/editor-surface.ts";
import { EN_US } from "../src/localization/en-US.ts";

const noBlame = { source: null, unavailableReason: null };

test("capturing an obsolete mounted revision cannot overwrite an externally reloaded buffer", async () => {
  let disk = { workspacePath: "file.txt", content: "original", utf8Bom: false, revision: "one", byteLength: 8 };
  const controller = new EditorSessionController({ async readTextFile() { return disk; } });
  controller.installWorkspace("/repo");
  await controller.openText("/repo", { repositoryId: ".", path: "file.txt", workspacePath: "file.txt" }, "source");
  const old = controller.state.session.textTabs[0];
  const { surface } = testSurface();
  surface.mountText("old", old, {}, noBlame, () => {}, () => {});

  disk = { ...disk, content: "external edit", revision: "two" };
  await controller.reconcileExternalPaths(["file.txt"]);
  surface.capture(controller.state.session, (id, content) => controller.captureText(id, content));
  assert.equal(controller.tab(old.id).content, "external edit");
  assert.equal(controller.dirtyTabs().length, 0);
  surface.mountText("new", controller.tab(old.id), {}, noBlame, () => {
    surface.capture(controller.state.session, (id, content) => controller.captureText(id, content));
  }, () => {});
  assert.equal(controller.tab(old.id).content, "external edit");
});

test("a synchronous flush that changes the active editor still captures the original document identity", () => {
  const { surface, runtime } = testSurface();
  const tab = { id: "a", loadEpoch: 1, content: "alpha", status: "ready", document: { path: "a.txt" } };
  surface.mountText("a", tab, {}, noBlame, () => {}, () => {});
  runtime.contents.set("b", "beta");
  runtime.flushChanges = () => { runtime.active = "b"; };
  const captured = [];
  surface.capture({ textTabs: [tab] }, (...args) => captured.push(args));
  assert.deepEqual(captured, [["a", "alpha"]]);
});

test("source change reveal is delegated to the mounted text editor", () => {
  const { surface, runtime } = testSurface();
  let reveals = 0;
  runtime.revealFirstChange = () => {
    reveals += 1;
    return true;
  };

  assert.equal(surface.revealFirstSourceChange(), true);
  assert.equal(reveals, 1);
});

function testSurface() {
  const body = { innerHTML: "", classList: { add() {}, remove() {} } };
  const surface = new EditorSurface(
    { querySelector() { return body; } },
    EN_US.editor,
    { async load() { throw new Error("unexpected blame request"); }, status() {}, error() {} },
    { open() {}, close() {} },
  );
  const runtime = {
    contents: new Map(), active: null,
    isMountedIn() { return false; },
    detach() {}, requestMeasure() {}, flushChanges() {},
    mount(_parent, id, _epoch, content) { this.active = id; this.contents.set(id, content); },
    content(id = this.active) { return this.contents.get(id) ?? ""; },
  };
  surface.textEditor = runtime;
  return { surface, runtime };
}
