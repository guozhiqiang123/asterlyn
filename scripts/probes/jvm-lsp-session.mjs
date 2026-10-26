// Developer probe only. This is not a production process launcher or plugin capability.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

export const FRAME_LIMIT = 4 * 1024 * 1024;
export const HEADER_LIMIT = 8192;
const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

export class ProbeFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

export class JvmLspProbeSession {
  pending = new Map();
  events = [];
  diagnostics = new Map();
  counts = {};
  sequence = 0;
  bytes = Buffer.alloc(0);
  stderrBytes = 0;
  protocolFailed = false;

  constructor(binary, args, { cwd, env, configuration }) {
    this.configuration = configuration;
    this.child = spawn(binary, args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    this.exit = new Promise((resolve) => {
      const finish = (exit) => {
        if (this.exited) return;
        this.exited = exit;
        for (const value of this.pending.values()) {
          clearTimeout(value.timer);
          value.reject(new ProbeFailure("server-exited"));
        }
        this.pending.clear();
        resolve();
      };
      this.child.once("error", () => finish({ code: null, signal: null, spawnFailed: true }));
      this.child.once("exit", (code, signal) => finish({ code, signal }));
    });
    this.child.stdin.on("error", () => {});
    this.child.stderr.on("data", (chunk) => { this.stderrBytes += chunk.length; });
    this.child.stdout.on("data", (chunk) => {
      try { this.consume(chunk); }
      catch { this.protocolFailed = true; void this.stop(); }
    });
  }

  consume(chunk) {
    this.bytes = Buffer.concat([this.bytes, chunk]);
    for (;;) {
      const header = this.bytes.indexOf("\r\n\r\n");
      if (header < 0) {
        if (this.bytes.length > HEADER_LIMIT) throw new ProbeFailure("header-bound");
        return;
      }
      if (header + 4 > HEADER_LIMIT) throw new ProbeFailure("header-bound");
      let length;
      for (const line of this.bytes.subarray(0, header).toString("ascii").split("\r\n")) {
        const match = /^([^:]+):\s*(.*?)\s*$/u.exec(line);
        if (!match) throw new ProbeFailure("invalid-header");
        if (match[1].toLowerCase() === "content-length") {
          if (length !== undefined || !/^\d+$/u.test(match[2])) throw new ProbeFailure("invalid-length");
          length = Number(match[2]);
        }
      }
      if (length === undefined) throw new ProbeFailure("missing-length");
      if (length > FRAME_LIMIT) throw new ProbeFailure("frame-bound");
      if (this.bytes.length < header + 4 + length) return;
      const value = JSON.parse(this.bytes.subarray(header + 4, header + 4 + length));
      this.bytes = this.bytes.subarray(header + 4 + length);
      this.accept(value);
    }
  }

  accept(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.jsonrpc !== "2.0") throw new ProbeFailure("protocol");
    const has = (key) => Object.hasOwn(value, key);
    if (!has("method")) {
      if (!has("id") || has("result") === has("error")) throw new ProbeFailure("response-shape");
      const pending = this.pending.get(value.id);
      if (pending) {
        this.pending.delete(value.id);
        clearTimeout(pending.timer);
        pending.resolve(value);
      }
      return;
    }
    if (typeof value.method !== "string" || value.method.length > 256 || has("result") || has("error")) throw new ProbeFailure("request-shape");
    if (!Object.hasOwn(this.counts, value.method) && Object.keys(this.counts).length >= 64) throw new ProbeFailure("method-bound");
    this.counts[value.method] = (this.counts[value.method] ?? 0) + 1;
    const params = value.params ?? {};
    if (has("id")) {
      if (!(Number.isSafeInteger(value.id) && value.id >= 0) && !(typeof value.id === "string" && value.id.length <= 128)) throw new ProbeFailure("request-id");
      let result = null;
      if (value.method === "workspace/configuration") {
        if (!Array.isArray(params.items) || params.items.length > 64) throw new ProbeFailure("configuration-bound");
        result = params.items.map((item) => {
          if (!item.section) return this.configuration;
          if (typeof item.section !== "string" || item.section.length > 256) throw new ProbeFailure("configuration-section");
          return item.section.split(".").reduce((object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined, this.configuration) ?? null;
        });
      } else if (value.method === "workspace/applyEdit") result = { applied: false, failureReason: "Probe does not apply edits" };
      else if (!["window/workDoneProgress/create", "window/showMessageRequest", "workspace/diagnostic/refresh"].includes(value.method)) {
        this.send({ id: value.id, error: { code: -32601, message: "Unsupported probe request" } });
        return;
      }
      this.send({ id: value.id, result });
      return;
    }
    if (value.method === "textDocument/publishDiagnostics" && typeof params.uri === "string" && Array.isArray(params.diagnostics)) {
      if (this.diagnostics.size >= 128 && !this.diagnostics.has(params.uri)) this.diagnostics.delete(this.diagnostics.keys().next().value);
      this.diagnostics.set(params.uri, { version: params.version ?? null, count: params.diagnostics.length, receivedAt: Date.now(), ranges: params.diagnostics.slice(0, 512).map((d) => d.range) });
    }
    const event = { method: value.method, time: Date.now() };
    if (value.method === "language/status") event.type = String(params.type).slice(0, 64);
    if (value.method === "$/progress") { event.kind = params.value?.kind; event.tokenHash = hash(String(params.token)); }
    if (["window/logMessage", "window/showMessage"].includes(value.method)) { event.messageHash = hash(String(params.message ?? "")); event.messageBytes = Buffer.byteLength(String(params.message ?? "")); event.level = params.type; }
    this.events.push(event);
    if (this.events.length > 512) this.events.shift();
  }

  send(value) {
    if (this.exited) throw new ProbeFailure("server-exited");
    const bytes = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...value }));
    if (bytes.length > FRAME_LIMIT || this.child.stdin.writableLength > FRAME_LIMIT) throw new ProbeFailure("writer-bound");
    this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`), bytes]));
  }

  notify(method, params) { this.send({ method, params }); }

  request(method, params, timeoutMs = 30000) {
    if (this.pending.size >= 64) return Promise.reject(new ProbeFailure("pending-bound"));
    if (this.exited) return Promise.reject(new ProbeFailure("server-exited"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (!this.exited) { try { this.notify("$/cancelRequest", { id }); } catch {} }
        reject(new ProbeFailure("request-deadline"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (this.exited) return;
      const signal = (value) => { if (this.child.pid && !this.exited) { try { process.kill(-this.child.pid, value); } catch {} } };
      signal("SIGTERM");
      const timer = setTimeout(() => signal("SIGKILL"), 2500);
      await this.exit;
      clearTimeout(timer);
    })();
    return this.stopping;
  }
}
