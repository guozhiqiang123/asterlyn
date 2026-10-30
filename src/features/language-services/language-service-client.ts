import type { EditorDefinitionEvent, EditorLanguageServiceDiagnostic, EditorLanguageServiceHandle, EditorLanguageServiceLocation, EditorLanguageServicePort, EditorLanguageServicePortFactory, EditorLanguageServiceSnapshot } from "../../protocol/editor-language-service.ts";
import { LanguageServiceIndexingError, LanguageServiceUnavailableError } from "../../protocol/editor-language-service.ts";

export interface LanguageDocumentIdentity {
  readonly workspaceRoot: string; readonly workspaceGeneration: number; readonly uri: string;
  readonly languageId: string; readonly pluginId: string; readonly providerVersion?: string;
  readonly serverId?: string;
}
export type { NativeLanguageServiceBridge, LanguageServiceEvent } from "../../protocol/language-service.ts";
import type { NativeLanguageServiceBridge, LanguageServiceEvent, LanguageServiceApprovalEvent } from "../../protocol/language-service.ts";
import type { LanguageServiceProgress } from "../../protocol/language-service.ts";
export type LanguageConsentScope = Pick<LanguageDocumentIdentity, "workspaceRoot" | "workspaceGeneration" | "pluginId" | "providerVersion" | "serverId">;
export interface LanguageServiceStatus {
  scope: LanguageConsentScope; sessionId: string | null;
  state: "preparing" | "awaiting-approval" | "declined" | "indexing" | "ready" | "failed" | "stopped";
  progress?: LanguageServiceProgress; code?: string; startedAt: number;
}
export type LanguageServiceFactory = EditorLanguageServicePortFactory & { dispose(): void; reconcile(retainConsent?: (identity: LanguageConsentScope) => boolean, retainBackground?: (identity: LanguageConsentScope) => boolean): void; revoke(pluginId: string): void; warm(scope: LanguageConsentScope): Promise<void>; restart(): Promise<void> };
interface Consent { readonly scope: LanguageConsentScope; approvedIdentity: string | null; denied: boolean; }
type Listener = Parameters<EditorLanguageServicePort["subscribeDiagnostics"]>[0];
interface Document {
  handle: EditorLanguageServiceHandle; info: LanguageDocumentIdentity; latest: EditorLanguageServiceSnapshot;
  sent: number; opened: boolean; closed: boolean; port: EditorLanguageServicePort; timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<Listener>; requests: Map<string, number>;
}
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const handleKey = (h: EditorLanguageServiceHandle) => JSON.stringify([h.tabId, h.path, h.loadEpoch]);
const sessionKey = (i: LanguageConsentScope) => JSON.stringify([i.workspaceRoot, i.workspaceGeneration, i.pluginId, i.providerVersion, i.serverId ?? "typescript"]);
const validSnapshot = (s: EditorLanguageServiceSnapshot) => Number.isSafeInteger(s.version) && s.version > 0 && s.text.length <= MAX_TEXT_BYTES && new TextEncoder().encode(s.text).length <= MAX_TEXT_BYTES;

/** Owns current overlays, ordered synchronization and result identity independently of editor UI. */
export function createEditorLanguageServicePort(resolve: (handle: EditorLanguageServiceHandle) => LanguageDocumentIdentity | null, native: NativeLanguageServiceBridge, reportError: (error: unknown) => void, navigate?: (location: EditorLanguageServiceLocation) => void, definitionTrace?: (event: EditorDefinitionEvent) => void, approvalTrace?: (event: LanguageServiceApprovalEvent) => void, lifecycle?: (state:LanguageServiceStatus)=>void, openInWindow?: (results:import("../../protocol/editor-language-service.ts").EditorLanguageLocationsPublication)=>void): LanguageServiceFactory {
  const sessions = new Map<string, Session>();
  const refreshProfiles=new Set<string>();
  const consents = new Map<string, Consent>();
  const invalidate = (key: string, reason: "scope-changed" | "shutdown") => {
    const consent = consents.get(key); consents.delete(key);
    if (consent && (consent.approvedIdentity !== null || consent.denied)) {
      try { approvalTrace?.({ outcome: "invalidated", reason }); } catch { /* Logging cannot change consent. */ }
    }
  };
  let disposed = false;
  const unsubscribe = native.subscribe((event) => { if (!disposed) for (const session of sessions.values()) session.event(event); });
  const sessionFor = (info: LanguageConsentScope) => {
    if (disposed) return null;
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
      }, navigate, definitionTrace, approvalTrace, lifecycle,refreshProfiles.delete(key),openInWindow);
      session = created; sessions.set(key, session);
    }
    return session;
  };
  const factory = ((handle: EditorLanguageServiceHandle) => {
    const info=resolve(handle);return disposed || !info ? null : sessionFor(info)?.port(handle,info) ?? null;
  }) as LanguageServiceFactory;
  factory.warm = async info => { await sessionFor(info)?.warm(); };
  factory.restart = async () => {
    const old=[...sessions.values()];sessions.clear();
    refreshProfiles.clear();for(const session of old)refreshProfiles.add(sessionKey(session.scope));
    for(const consent of consents.values())consent.denied=false;
    await Promise.allSettled(old.map(session=>session.dispose()));
  };
  factory.reconcile = (retainConsent,retainBackground) => {
    for (const [key, session] of sessions) {
      if (!session.reconcile(retainBackground?.(session.scope)===true)) { void session.dispose(); sessions.delete(key); }
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
    refreshProfiles.clear();
    for (const key of consents.keys()) invalidate(key, "shutdown"); native.dispose?.();
  };
  return factory;
}
class Session {
  private warmed=false;
  private startedAt=Date.now();
  private working=false;
  private lastState:LanguageServiceStatus["state"]="stopped";
  private readonly earlyEvents=new Map<string,LanguageServiceEvent>();
  private readonly docs = new Map<string, Document>();
  private sessionId: string | null = null;
  private starting: Promise<string | null> | null = null;
  private serial: Promise<void> = Promise.resolve();
  private dead = false; private failed = false; private sequence = 0;
  private readonly consent: Consent;
  private readonly idle: () => void;
  private readonly info: LanguageConsentScope;
  private readonly native: NativeLanguageServiceBridge;
  private readonly resolve: (handle: EditorLanguageServiceHandle) => LanguageDocumentIdentity | null;
  private readonly reportError: (error: unknown) => void;
  private readonly navigate: ((location: EditorLanguageServiceLocation) => void) | undefined;
  private readonly trace: ((event: EditorDefinitionEvent) => void) | undefined;
  private readonly approvalTrace: ((event: LanguageServiceApprovalEvent) => void) | undefined;
  private readonly lifecycle: ((state:LanguageServiceStatus)=>void) | undefined;
  private readonly openInWindow:((results:import("../../protocol/editor-language-service.ts").EditorLanguageLocationsPublication)=>void)|undefined;
  private readonly refreshModel:boolean;
  constructor(info: LanguageConsentScope, native: NativeLanguageServiceBridge, resolve: (handle: EditorLanguageServiceHandle) => LanguageDocumentIdentity | null, reportError: (error: unknown) => void, consent: Consent, idle: () => void, navigate?: (location: EditorLanguageServiceLocation) => void, trace?: (event: EditorDefinitionEvent) => void, approvalTrace?: (event: LanguageServiceApprovalEvent) => void, lifecycle?: (state:LanguageServiceStatus)=>void, refreshModel=false,openInWindow?: (results:import("../../protocol/editor-language-service.ts").EditorLanguageLocationsPublication)=>void) { this.openInWindow=openInWindow;this.refreshModel=refreshModel;this.lifecycle=lifecycle; this.idle = idle; this.consent = consent; this.approvalTrace = approvalTrace; this.trace = trace; this.info = info; this.native = native; this.resolve = resolve; this.reportError = reportError; this.navigate = navigate; }
  get scope():LanguageConsentScope{return this.info;}
  private live():boolean{return !this.dead && (this.warmed || [...this.docs.values()].some(doc=>this.current(doc)));}
  private status(state:LanguageServiceStatus["state"],code?:string,progress?:LanguageServiceProgress):void {
    const working=["preparing","awaiting-approval","indexing"].includes(state)||(state==="ready"&&progress!==undefined&&!["ready","failed"].includes(progress.phase));
    if(working&&(!this.working||(this.lastState==="awaiting-approval"&&state!=="awaiting-approval")))this.startedAt=Date.now();
    this.working=working;this.lastState=state;
    try{this.lifecycle?.({scope:this.info,sessionId:this.sessionId,state,code,progress,startedAt:this.startedAt});}catch{/* Status cannot change authority. */}
  }
  async warm():Promise<void>{this.warmed=true;try{await this.ensure();}catch{this.failed=true;/* ensure publishes the failed state; retry is explicit. */}}
  private approval(event: LanguageServiceApprovalEvent): void { try { this.approvalTrace?.(event); } catch { /* Logging cannot change consent. */ } }
  private operation(doc:Document,operation:string,outcome:string,extra:Partial<import("../../protocol/language-service.ts").LanguageServiceTrace>={}):void {
    try{this.native.trace?.({workspaceRoot:this.info.workspaceRoot,uri:doc.info.uri,sessionId:this.sessionId??undefined,version:doc.latest.version,operation,outcome,...extra});}catch{/* Tracing is observational only. */}
  }
  port(handle: EditorLanguageServiceHandle, info: LanguageDocumentIdentity): EditorLanguageServicePort | null {
    const key = handleKey(handle); const existing = this.docs.get(key);
    if (existing && !existing.closed) return existing.port;
    if (this.dead || this.docs.size >= 32) return null;
    const doc = { handle: { ...handle }, info, latest: { version: 0, text: "" }, sent: 0, opened: false, closed: false, timer: null, listeners: new Set<Listener>(), requests: new Map<string, number>() } as unknown as Document;
    doc.port = {
      documentUri: info.uri,
      definitionEvent: (event) => { this.operation(doc,event.kind??"definition",event.outcome,{resultCount:event.targetCount});try { this.trace?.(event); } catch { /* Diagnostics cannot block navigation. */ } },
      open: (_handle, snapshot) => { if(this.accept(doc, snapshot)){this.operation(doc,"document-open","accepted");this.enqueue(() => this.flush(doc));} },
      update: (_handle, snapshot) => {
        if (!this.accept(doc, snapshot)){this.operation(doc,"document-change","discarded",{reason:"stale-or-ineligible"});return;}
        this.operation(doc,"document-change","accepted");
        if (doc.timer) clearTimeout(doc.timer);
        doc.timer = setTimeout(() => { doc.timer = null; this.enqueue(() => this.flush(doc)); }, 50);
      },
      close: () => this.close(doc),
      request: <T>(_handle: EditorLanguageServiceHandle, method: string, params: unknown, version: number) => this.request(doc, method, params, version) as Promise<T | null>,
      ...(this.openInWindow?{openInWindow:(results:import("../../protocol/editor-language-service.ts").EditorLanguageLocationResults,version:number)=>{
        if(this.current(doc)&&doc.latest.version===version)this.openInWindow?.({...results,workspaceRoot:this.info.workspaceRoot,workspaceGeneration:this.info.workspaceGeneration});
      }}:{}),
      navigate: (location) => { if (this.current(doc)) {this.operation(doc,"navigate","selected",{targetUri:location.uri});this.navigate?.(location);} },
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
    if (this.dead || this.consent.denied || this.failed || !this.live()) return null;
    if (this.sessionId) return this.sessionId;
    if (this.starting) return this.starting;
    this.status("preparing");
    this.starting = (async () => {
      let review = await this.native.prepare(this.info.workspaceRoot, this.info.pluginId, this.info.serverId ?? "typescript");
      let explicitlyApproved=false;
      if (review.serverId !== (this.info.serverId ?? "typescript")) throw Error("Language execution profile changed");
      const identity = JSON.stringify([review.pluginId, review.serverId, review.pluginVersion, review.packageDigest, review.resourceDigest, review.executableIdentity]);
      if (this.dead || !this.live()) return null;
      if (review.remembered === true) {
        this.consent.approvedIdentity = identity; this.approval({ outcome: "reused" });
      } else if (review.remembered === false || this.consent.approvedIdentity !== identity) {
        this.approval({ outcome: "requested", reason: this.consent.approvedIdentity === null ? "first-use" : "identity-changed" });
        this.status("awaiting-approval");
        const approved = await this.native.confirm(review);
        if (this.dead || !this.live()) { this.approval({ outcome: "discarded" }); return null; }
        if (!approved) { this.consent.denied = true; this.status("declined"); this.approval({ outcome: "declined" }); return null; }
        this.consent.approvedIdentity = identity; explicitlyApproved=true;this.approval({ outcome: "approved" });
      } else this.approval({ outcome: "reused" });
      // A dialog may outlive its one-use review while the screen is locked. Refresh authority,
      // but never reuse a confirmation for a changed package/tool identity or a revoked grant.
      if(review.expiresAt<=Date.now()+1000){
        const fresh=await this.native.prepare(this.info.workspaceRoot,this.info.pluginId,this.info.serverId??"typescript");
        if(this.dead||!this.live())return null;
        if(JSON.stringify([fresh.pluginId,fresh.serverId,fresh.pluginVersion,fresh.packageDigest,fresh.resourceDigest,fresh.executableIdentity])!==identity)throw Error("language-execution-identity-changed");
        if(!explicitlyApproved&&review.remembered===true&&fresh.remembered!==true)throw Error("language-approval-revoked");
        review=fresh;
      }
      const session = await this.native.start(this.info.workspaceRoot, review.reviewId, this.info.serverId ?? "typescript", true,this.refreshModel);
      if (this.dead || !this.live()) { await this.native.stop(this.info.workspaceRoot, session).catch(() => undefined); return null; }
      this.sessionId = session; this.status((this.info.serverId ?? "typescript") === "typescript" ? "ready" : "indexing");
      const early=this.earlyEvents.get(session);this.earlyEvents.clear();if(early)this.event(early); return session;
    })().catch(error=>{if(!this.dead)this.status("failed",/^[a-z][a-z0-9.-]{0,79}$/u.test(error?.message) ? error.message : "language-start-failed");throw error;}).finally(() => { this.starting = null; });
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
    if(!doc.closed)this.operation(doc,"document-close","accepted");
    if (doc.closed) return; doc.closed = true;
    if (doc.timer) clearTimeout(doc.timer); doc.timer = null;
    for (const [id] of doc.requests) if (this.sessionId) void this.native.cancel(this.info.workspaceRoot, this.sessionId, id).catch(() => undefined);
    doc.listeners.clear(); this.docs.delete(handleKey(doc.handle));
    this.enqueue(async () => {
      const session = this.sessionId;
      if (session && doc.opened) await this.native.close(this.info.workspaceRoot, session, doc.info.uri).catch(() => undefined);
      if (!this.warmed && !this.docs.size && session) { this.sessionId = null; await this.native.stop(this.info.workspaceRoot, session).catch(() => undefined); }
      if (!this.warmed && !this.docs.size) this.idle();
    });
  }
  private async request(doc: Document, method: string, params: unknown, version: number): Promise<unknown | null> {
    const feature = ({ "textDocument/hover": "hover", "textDocument/definition": "definition", "textDocument/completion": "completion", "textDocument/references": "references", hover: "hover", definition: "definition", completion: "completion", references: "references" } as const)[method as "hover"];
    const pos = (params as { position?: { line?: unknown; character?: unknown } } | null)?.position;
    if (!feature || !pos || !Number.isSafeInteger(pos.line) || !Number.isSafeInteger(pos.character) || Number(pos.line) < 0 || Number(pos.character) < 0 || !this.current(doc) || doc.latest.version !== version || doc.requests.size >= 16 || [...this.docs.values()].reduce((count, item) => count + item.requests.size, 0) >= 64) {this.operation(doc,"request","discarded",{reason:"stale-or-ineligible"});return null;}
    if(this.failed)throw new LanguageServiceUnavailableError();
    if (doc.timer) { clearTimeout(doc.timer); doc.timer = null; }
    await this.enqueue(() => this.flush(doc));
    const session = this.sessionId;
    if (!session || !doc.opened || !this.current(doc) || doc.latest.version !== version || doc.sent !== version) return null;
    const id = `${++this.sequence}`; doc.requests.set(id, version);
    const started=performance.now();this.operation(doc,"request","requested",{feature,requestId:id});
    try {
      const envelope = await this.native.request(this.info.workspaceRoot, session, doc.info.uri, version, id, feature, Number(pos.line), Number(pos.character));
      const current=this.current(doc) && this.sessionId === session && doc.latest.version === version && envelope.sessionId === session && envelope.uri === doc.info.uri && envelope.version === version;
      this.operation(doc,"request",current?"completed":"discarded",{feature,requestId:id,durationMs:performance.now()-started,resultCount:Array.isArray(envelope.result)?envelope.result.length:undefined});
      return current ? envelope.result : null;
    } catch (error) {
      this.operation(doc,"request",error instanceof LanguageServiceIndexingError?"indexing":"failed",{feature,requestId:id,durationMs:performance.now()-started});
      // Preserve a host loading state only for this exact live document/session/version.
      if ((error instanceof LanguageServiceIndexingError||error instanceof LanguageServiceUnavailableError)
        && this.current(doc)
        && this.sessionId === session
        && doc.latest.version === version) throw error;
      return null;
    } finally { doc.requests.delete(id); }
  }
  event(event: LanguageServiceEvent): void {
    if (event.sessionId !== this.sessionId) {
      if(this.starting && !this.sessionId && event.kind!=="diagnostics"){if(this.earlyEvents.size>=16)this.earlyEvents.clear();this.earlyEvents.set(event.sessionId,event);}
      return;
    }
    if(event.kind!=="diagnostics")this.status(event.kind==="terminated"||event.kind==="degraded"?"failed":event.kind,event.code,event.progress);
    if (event.kind === "terminated") { this.sessionId = null; this.failed = true; for (const doc of this.docs.values()) this.publish(doc, []); return; }
    for (const doc of this.docs.values()) if (this.current(doc) && event.uri === doc.info.uri && event.version === doc.latest.version && event.diagnostics) this.publish(doc, event.diagnostics);
  }
  private publish(doc: Document, diagnostics: readonly EditorLanguageServiceDiagnostic[]): void { for (const listener of doc.listeners) listener({ handle: doc.handle, version: doc.latest.version, diagnostics }); }
  reconcile(retainWarm=false): boolean { this.warmed=this.warmed && retainWarm;for (const doc of [...this.docs.values()]) if (!this.current(doc)) this.close(doc); return this.warmed || this.docs.size > 0; }
  async dispose(): Promise<void> {
    if (this.dead) return;
    this.dead = true; this.warmed=false; this.status("stopped"); this.earlyEvents.clear();
    for (const doc of [...this.docs.values()]) this.close(doc);
    const session = this.sessionId; this.sessionId = null;
    await Promise.allSettled([this.starting,session ? this.native.stop(this.info.workspaceRoot, session) : null]);
  }
}
