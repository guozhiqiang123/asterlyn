import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { JvmLspProbeSession, FRAME_LIMIT, HEADER_LIMIT } from "./probes/jvm-lsp-session.mjs";

function parser() {
  const value = Object.create(JvmLspProbeSession.prototype);
  Object.assign(value, { bytes: Buffer.alloc(0), pending: new Map(), events: [], counts: {}, diagnostics: new Map(), configuration: { java: { safe: true } }, replies: [] });
  value.send = (reply) => value.replies.push(reply);
  return value;
}
function frame(value) { const bytes = Buffer.from(JSON.stringify(value)); return Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`), bytes]); }

test("probe frames reject duplicate/oversized headers and mixed JSON-RPC; UTF-8 fragmented frames work", () => {
  for (const input of [Buffer.from("Content-Length: 1\r\ncontent-length: 1\r\n\r\nx"), Buffer.from(`Content-Length: ${FRAME_LIMIT + 1}\r\n\r\n`), Buffer.from("a".repeat(HEADER_LIMIT) + "\r\n\r\n"), frame({ jsonrpc: "2.0", method: "x", result: null })]) assert.throws(() => parser().consume(input));
  const value = parser(), bytes = frame({ jsonrpc: "2.0", method: "window/logMessage", params: { message: "secret-source-😀" } });
  for (const byte of bytes) value.consume(Buffer.from([byte]));
  assert.equal(value.events.length, 1);
  assert.equal(value.events[0].messageBytes, Buffer.byteLength("secret-source-😀"));
  assert.ok(!JSON.stringify(value.events).includes("secret-source"));
});

test("probe rejects mutations, dynamic registrations and unknown requests; configuration cannot read inherited properties", () => {
  const value = parser();
  const request = (id, method, params) => value.accept({ jsonrpc: "2.0", id, method, params });
  request(1, "workspace/applyEdit", {});
  request(2, "client/registerCapability", {});
  request(3, "workspace/configuration", { items: [{ section: "java.safe" }, { section: "constructor" }] });
  assert.equal(value.replies[0].result.applied, false);
  assert.equal(value.replies[1].error.code, -32601);
  assert.deepEqual(value.replies[2].result, [true, null]);
});

test("probe spawn failure rejects pending initialization and shutdown completes", async () => {
  const value = new JvmLspProbeSession("/asterlyn-nonexistent-jvm-probe", [], { cwd: tmpdir(), env: {}, configuration: {} });
  await assert.rejects(value.request("initialize", {}, 5000), /server-exited/u);
  await value.stop();
  assert.equal(value.pending.size, 0);
  assert.equal(value.exited.spawnFailed, true);
});

test("50 imported project nodes and ServiceReady cannot pass acceptance with empty definitions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "asterlyn-jvm-probe-test-"));
  try {
    await writeFile(join(dir, "Source.java"), "class Source { Target target; }\n");
    await writeFile(join(dir, "server.mjs"), `let buffer=Buffer.alloc(0);process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);for(;;){const end=buffer.indexOf('\\r\\n\\r\\n');if(end<0)return;const length=Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0,end).toString())[1]);if(buffer.length<end+4+length)return;const message=JSON.parse(buffer.subarray(end+4,end+4+length));buffer=buffer.subarray(end+4+length);if(message.id){const result=message.method==='initialize'?{capabilities:{definitionProvider:true}}:message.method==='workspace/executeCommand'?Array(50).fill('node'):[];send({id:message.id,result});}if(message.method==='initialized')send({method:'language/status',params:{type:'ServiceReady'}});}});function send(message){const body=Buffer.from(JSON.stringify({jsonrpc:'2.0',...message}));process.stdout.write(Buffer.concat([Buffer.from('Content-Length: '+body.length+'\\r\\n\\r\\n'),body]));}`);
    await writeFile(join(dir, "config.json"), JSON.stringify({ profile: "jdtls", executable: process.execPath, arguments: [join(dir, "server.mjs")], workspace: dir, timeoutMs: 5000, readyStatus: "ServiceReady", documents: [{ path: "Source.java", languageId: "java", definitions: [{ needle: "Target", offset: 1, expectedWorkspacePath: "Target.java" }] }] }));
    const code = await new Promise((done) => { const child = spawn(process.execPath, [resolve("scripts/probes/jvm-language-service-probe.mjs"), join(dir, "config.json"), join(dir, "summary.json")], { stdio: "ignore" }); child.once("exit", done); });
    const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8"));
    assert.equal(code, 1);
    assert.equal(summary.ready, true);
    assert.equal(summary.projectCount, 50);
    assert.equal(summary.passed, false);
    assert.equal(summary.failure, "semantic-acceptance-failed");
    assert.equal(summary.documents[0].definitions[0].matched, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
