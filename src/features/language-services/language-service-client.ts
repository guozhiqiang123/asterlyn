import type { EditorDefinitionEvent, EditorLanguageServiceDiagnostic, EditorLanguageServiceHandle, EditorLanguageServiceLocation, EditorLanguageServicePort, EditorLanguageServicePortFactory, EditorLanguageServiceSnapshot } from "../../protocol/editor-language-service.ts";
import { LanguageServiceIndexingError } from "../../protocol/editor-language-service.ts";

export interface LanguageDocumentIdentity {
  readonly workspaceRoot: string; readonly workspaceGeneration: number; readonly uri: string;
  readonly languageId: string; readonly pluginId: string; readonly providerVersion?: string;
  readonly serverId?: string;
}
export type { NativeLanguageServiceBridge, LanguageServiceEvent } from "../../protocol/language-service.ts";
import type { NativeLanguageServiceBridge, LanguageServiceEvent, LanguageServiceApprovalEvent } from "../../protocol/language-service.ts";
export type LanguageConsentScope = Pick<LanguageDocumentIdentity, "workspaceRoot" | "workspaceGeneration" | "pluginId" | "providerVersion" | "serverId">;
export type LanguageServiceFactory = EditorLanguageServicePortFactory & { dispose(): void; reconcile(retainConsent?: (identity: LanguageConsentScope) => boolean): void; revoke(pluginId: string): void };
interface Consent { readonly scope: LanguageConsentScope; approvedIdentity: string | null; denied: boolean; }
type Listener = Parameters<EditorLanguageServicePort["subscribeDiagnostics"]>[0];
interface Document {
  handle: EditorLanguageServiceHandle; info: LanguageDocumentIdentity; latest: EditorLanguageServiceSnapshot;
  sent: number; opened: boolean; closed: boolean; port: EditorLanguageServicePort; timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<Listener>; requests: Map<string, number>;
}
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const handleKey = (h: EditorLanguageServiceHandle) => JSON.stringify([h.tabId, h.path, h.loadEpoch]);
const sessionKey = (i: LanguageDocumentIdentity) => JSON.stringify([i.workspaceRoot, i.workspaceGeneration, i.pluginId, i.providerVersion, i.serverId ?? "typescript"]);
const validSnapshot = (s: EditorLanguageServiceSnapshot) => Number.isSafeInteger(s.version) && s.version > 0 && s.text.length <= MAX_TEXT_BYTES && new TextEncoder().encode(s.text).length <= MAX_TEXT_BYTES;

/** Owns current overlays, ordered synchronization and result identity independently of editor UI. */
export function createEditorLanguageServicePort(resolve: (handle: EditorLanguageServiceHandle) => LanguageDocumentIdentity | null, native: NativeLanguageServiceBridge, reportError: (error: unknown) => void, navigate?: (location: EditorLanguageServiceLocation) => void, definitionTrace?: (event: EditorDefinitionEvent) => void, approvalTrace?: (event: LanguageServiceApprovalEvent) => void): LanguageServiceFactory {
  const sessions = new Map<string, Session>();
  const consents = new Map<string, Consent>();
  const invalidate = (key: string, reason: "scope-changed" | "shutdown") => {
    const consent = consents.get(key); consents.delete(key);
    if (consent && (consent.approvedIdentity !== null || consent.denied)) {
      try { approvalTrace?.({ outcome: "invalidated", reason }); } catch { /* Logging cannot change consent. */ }
    }
  };
  let disposed = false;
  const unsubscribe = native.subscribe((event) => { if (!disposed) for (const session of sessions.values()) session.event(event); });
  const factory = ((handle: EditorLanguageServiceHandle) => {
    const info = resolve(handle);
    if (disposed || !info) return null;
    const key = sessionKey(info);
    let session = sessions.get(key);
    if (!session) {
      let consent = consents.get(key);
      if (!consent) {
        if (consents.size >= 32) { reportError(new Error("Language consent scope limit reached")); return null; }
        consent = {
          scope: { workspaceRoot: info.workspaceRoot, workspaceGeneration: info.workspaceGeneration, pluginId: info.pluginId, providerVersion: info.providerVersion, serverId: info.serverId },
          approvedIdentity: null, denied: false,
        };
        consents.set(key, consent);
      }
      const created = new Session(info, native, resolve, reportError, consent, () => {
        if (sessions.get(key) === created) { sessions.delete(key); created.dispose(); }
      }, navigate, definitionTrace, approvalTrace);
      session = created; sessions.set(key, session);
    }
    return session.port(handle, info);
  }) as LanguageServiceFactory;
  factory.reconcile = (retainConsent) => {
    for (const [key, session] of sessions) {
      if (!session.reconcile()) { session.dispose(); sessions.delete(key); }
    }
    for (const [key, consent] of consents) if (!sessions.has(key) && retainConsent?.(consent.scope) !== true) invalidate(key, "scope-changed");
  };
  factory.revoke = (pluginId) => {
    for (const [key, consent] of consents) if (consent.scope.pluginId === pluginId) {
      sessions.get(key)?.dispose(); sessions.delete(key); invalidate(key, "scope-changed");
    }
  };
  factory.dispose = () => {
    if (disposed) return; disposed = true; unsubscribe();
    for (const session of sessions.values()) session.dispose(); sessions.clear();
    for (const key of consents.keys()) invalidate(key, "shutdown"); native.dispose?.();
  };
  return factory;
}
class Session {
  private readonly docs = new Map<string, Document>();
  private sessionId: string | null = null;
  private starting: Promise<string | null> | null = null;
  private serial: Promise<void> = Promise.resolve();
  private dead = false; private failed = false; private sequence = 0;
  private readonly consent: Consent;
  private readonly idle: () => void;
  private readonly info: LanguageDocumentIdentity;
  private readonly native: NativeLanguageServiceBridge;
  private readonly resolve: (handle: EditorLanguageServiceHandle) => LanguageDocumentIdentity | null;
  private readonly reportError: (error: unknown) => void;
  private readonly navigate: ((location: EditorLanguageServiceLocation) => void) | undefined;
  private readonly trace: ((event: EditorDefinitionEvent) => void) | undefined;
  private readonly approvalTrace: ((event: LanguageServiceApprovalEvent) => void) | undefined;
  constructor(info: LanguageDocumentIdentity, native: NativeLanguageServiceBridge, resolve: (handle: EditorLanguageServiceHandle) => LanguageDocumentIdentity | null, reportError: (error: unknown) => void, consent: Consent, idle: () => void, navigate?: (location: EditorLanguageServiceLocation) => void, trace?: (event: EditorDefinitionEvent) => void, approvalTrace?: (event: LanguageServiceApprovalEvent) => void) { this.idle = idle; this.consent = consent; this.approvalTrace = approvalTrace; this.trace = trace; this.info = info; this.native = native; this.resolve = resolve; this.reportError = reportError; this.navigate = navigate; }
  private approval(event: LanguageServiceApprovalEvent): void { try { this.approvalTrace?.(event); } catch { /* Logging cannot change consent. */ } }
  port(handle: EditorLanguageServiceHandle, info: LanguageDocumentIdentity): EditorLanguageServicePort | null {
    const key = handleKey(handle); const existing = this.docs.get(key);
    if (existing && !existing.closed) return existing.port;
    if (this.dead || this.docs.size >= 32) return null;
    const doc = { handle: { ...handle }, info, latest: { version: 0, text: "" }, sent: 0, opened: false, closed: false, timer: null, listeners: new Set<Listener>(), requests: new Map<string, number>() } as unknown as Document;
    doc.port = {
      documentUri: info.uri,
      definitionEvent: (event) => { try { this.trace?.(event); } catch { /* Diagnostics cannot block navigation. */ } },
      open: (_handle, snapshot) => { this.accept(doc, snapshot); this.enqueue(() => this.flush(doc)); },
      update: (_handle, snapshot) => {
        if (!this.accept(doc, snapshot)) return;
        if (doc.timer) clearTimeout(doc.timer);
        doc.timer = setTimeout(() => { doc.timer = null; this.enqueue(() => this.flush(doc)); }, 50);
      },
      close: () => this.close(doc),
      request: <T>(_handle: EditorLanguageServiceHandle, method: string, params: unknown, version: number) => this.request(doc, method, params, version) as Promise<T | null>,
      navigate: (location) => { if (this.current(doc)) this.navigate?.(location); },
      subscribeDiagnostics: (listener) => { doc.listeners.add(listener); return () => doc.listeners.delete(listener); },
    };
    this.docs.set(key, doc); return doc.port;
  }
  private current(doc: Document): boolean { const identity = this.resolve(doc.handle); return !this.dead && !doc.closed && identity !== null && sessionKey(identity) === sessionKey(doc.info) && identity.uri === doc.info.uri; }
  private accept(doc: Document, snapshot: EditorLanguageServiceSnapshot): boolean {
    if (!this.current(doc) || !validSnapshot(snapshot) || snapshot.version <= doc.latest.version) return false;
    doc.latest = snapshot;
    for (const [id] of doc.requests) { if (this.sessionId) void this.native.cancel(this.info.workspaceRoot, this.sessionId, id).catch(() => undefined); }
    this.publish(doc, []); return true;
  }
  private enqueue(action: () => Promise<void>): Promise<void> {
    this.serial = this.serial.then(action).catch((error) => { if (!this.dead && !this.consent.denied && !this.failed) { this.failed = true; this.reportError(error); } });
    return this.serial;
  }
  private async ensure(): Promise<string | null> {
    if (this.dead || this.consent.denied || this.failed || ![...this.docs.values()].some((doc) => this.current(doc))) return null;
    if (this.sessionId) return this.sessionId;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const review = await this.native.prepare(this.info.workspaceRoot, this.info.pluginId, this.info.serverId ?? "typescript");
      if (review.serverId !== (this.info.serverId ?? "typescript")) throw Error("Language execution profile changed");
      const identity = JSON.stringify([review.pluginId, review.serverId, review.pluginVersion, review.packageDigest, review.resourceDigest, review.executableIdentity]);
      if (this.dead || ![...this.docs.values()].some((doc) => this.current(doc))) return null;
      if (review.remembered === true) {
        this.consent.approvedIdentity = identity; this.approval({ outcome: "reused" });
      } else if (review.remembered === false || this.consent.approvedIdentity !== identity) {
        this.approval({ outcome: "requested", reason: this.consent.approvedIdentity === null ? "first-use" : "identity-changed" });
        const approved = await this.native.confirm(review);
        if (this.dead || ![...this.docs.values()].some((doc) => this.current(doc))) { this.approval({ outcome: "discarded" }); return null; }
        if (!approved) { this.consent.denied = true; this.approval({ outcome: "declined" }); return null; }
        this.consent.approvedIdentity = identity; this.approval({ outcome: "approved" });
      } else this.approval({ outcome: "reused" });
      const session = await this.native.start(this.info.workspaceRoot, review.reviewId, this.info.serverId ?? "typescript", true);
      if (this.dead || ![...this.docs.values()].some((doc) => this.current(doc))) { await this.native.stop(this.info.workspaceRoot, session).catch(() => undefined); return null; }
      this.sessionId = session; return session;
    })().finally(() => { this.starting = null; });
    return this.starting;
  }
  private async flush(doc: Document): Promise<void> {
    if (!this.current(doc) || doc.latest.version === doc.sent || doc.latest.version === 0) return;
    const session = await this.ensure(); if (!session || !this.current(doc)) return;
    const snapshot = doc.latest;
    if (!doc.opened) {
      // Server versions begin at one for each freshly opened URI, then follow the editor clock.
      await this.native.open(this.info.workspaceRoot, session, doc.info.uri, doc.info.languageId, 1, snapshot.text);
      doc.opened = true; doc.sent = 1;
      if (!this.current(doc)) return;
    }
    if (snapshot.version > doc.sent) await this.native.change(this.info.workspaceRoot, session, doc.info.uri, snapshot.version, [{ range: null, text: snapshot.text }]);
    doc.sent = snapshot.version;
  }
  private close(doc: Document): void {
    if (doc.closed) return; doc.closed = true;
    if (doc.timer) clearTimeout(doc.timer); doc.timer = null;
    for (const [id] of doc.requests) if (this.sessionId) void this.native.cancel(this.info.workspaceRoot, this.sessionId, id).catch(() => undefined);
    doc.listeners.clear(); this.docs.delete(handleKey(doc.handle));
    this.enqueue(async () => {
      const session = this.sessionId;
      if (session && doc.opened) await this.native.close(this.info.workspaceRoot, session, doc.info.uri).catch(() => undefined);
      if (!this.docs.size && session) { this.sessionId = null; await this.native.stop(this.info.workspaceRoot, session).catch(() => undefined); }
      if (!this.docs.size) this.idle();
    });
  }
  private async request(doc: Document, method: string, params: unknown, version: number): Promise<unknown | null> {
    const feature = ({ "textDocument/hover": "hover", "textDocument/definition": "definition", "textDocument/completion": "completion", "textDocument/references": "references", hover: "hover", definition: "definition", completion: "completion", references: "references" } as const)[method as "hover"];
    const pos = (params as { position?: { line?: unknown; character?: unknown } } | null)?.position;
    if (!feature || !pos || !Number.isSafeInteger(pos.line) || !Number.isSafeInteger(pos.character) || Number(pos.line) < 0 || Number(pos.character) < 0 || !this.current(doc) || doc.latest.version !== version || doc.requests.size >= 16 || [...this.docs.values()].reduce((count, item) => count + item.requests.size, 0) >= 64) return null;
    if (doc.timer) { clearTimeout(doc.timer); doc.timer = null; }
    await this.enqueue(() => this.flush(doc));
    const session = this.sessionId;
    if (!session || !doc.opened || !this.current(doc) || doc.latest.version !== version || doc.sent !== version) return null;
    const id = `${++this.sequence}`; doc.requests.set(id, version);
    try {
      const envelope = await this.native.request(this.info.workspaceRoot, session, doc.info.uri, version, id, feature, Number(pos.line), Number(pos.character));
      return this.current(doc) && this.sessionId === session && doc.latest.version === version && envelope.sessionId === session && envelope.uri === doc.info.uri && envelope.version === version ? envelope.result : null;
    } catch (error) {
      // Preserve a host loading state only for this exact live document/session/version.
      if (error instanceof LanguageServiceIndexingError
        && this.current(doc)
        && this.sessionId === session
        && doc.latest.version === version) throw error;
      return null;
    } finally { doc.requests.delete(id); }
  }
  event(event: LanguageServiceEvent): void {
    if (event.sessionId !== this.sessionId) return;
    if (event.kind === "terminated") { this.sessionId = null; this.failed = true; for (const doc of this.docs.values()) this.publish(doc, []); return; }
    for (const doc of this.docs.values()) if (this.current(doc) && event.uri === doc.info.uri && event.version === doc.latest.version && event.diagnostics) this.publish(doc, event.diagnostics);
  }
  private publish(doc: Document, diagnostics: readonly EditorLanguageServiceDiagnostic[]): void { for (const listener of doc.listeners) listener({ handle: doc.handle, version: doc.latest.version, diagnostics }); }
  reconcile(): boolean { for (const doc of [...this.docs.values()]) if (!this.current(doc)) this.close(doc); return this.docs.size > 0; }
  dispose(): void {
    if (this.dead) return;
    for (const doc of [...this.docs.values()]) this.close(doc); this.dead = true;
    const session = this.sessionId; this.sessionId = null;
    if (session) void this.native.stop(this.info.workspaceRoot, session).catch(() => undefined);
  }
}
