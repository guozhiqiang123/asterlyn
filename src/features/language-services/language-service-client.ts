import type {
  EditorLanguageServiceDiagnostic,
  EditorLanguageServiceHandle,
  EditorLanguageServiceLocation,
  EditorLanguageServicePort,
  EditorLanguageServiceSnapshot,
} from "../../protocol/editor-language-service.ts";

type Feature = "hover" | "definition" | "completion";
type Identity = {
  workspaceRoot: string;
  workspaceGeneration: number;
  uri: string;
  languageId: string;
  pluginId: string;
};
type Native = {
  prepare(
    root: string,
    pluginId: string,
  ): Promise<{ reviewId: string; pluginId: string; serverId: "typescript" }>;
  confirm(review: unknown): Promise<boolean>;
  start(root: string, reviewId: string): Promise<string>;
  open(
    root: string,
    session: string,
    uri: string,
    languageId: string,
    version: number,
    text: string,
  ): Promise<void>;
  change(
    root: string,
    session: string,
    uri: string,
    version: number,
    changes: readonly { range: unknown; text: string }[],
  ): Promise<void>;
  close(root: string, session: string, uri: string): Promise<void>;
  request(
    root: string,
    session: string,
    uri: string,
    version: number,
    requestId: string,
    feature: Feature,
    line: number,
    character: number,
  ): Promise<{
    sessionId: string;
    uri: string;
    version: number;
    result: unknown;
  }>;
  cancel(root: string, session: string, requestId: string): Promise<void>;
  stop(root: string, session: string): Promise<void>;
  subscribe(
    listener: (event: {
      sessionId: string;
      uri?: string;
      version?: number;
      kind: "diagnostics" | "terminated";
      diagnostics?: readonly EditorLanguageServiceDiagnostic[];
    }) => void,
  ): () => void;
};

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_DOCS = 32;
const MAX_REQUESTS = 64;

export function createEditorLanguageServicePort(
  identity: (handle: EditorLanguageServiceHandle) => Identity | null,
  native: Native,
  reportError: (error: unknown) => void,
  navigate?: (location: EditorLanguageServiceLocation) => void,
): EditorLanguageServicePortFactory {
  const sessions = new Map<string, Session>();
  const unsubscribe = native.subscribe((event) => {
    for (const session of sessions.values()) session.event(event);
  });
  return (handle) => {
    const info = identity(handle);
    if (!info) return null;
    const key = `${info.workspaceRoot}\0${info.pluginId}`;
    let session = sessions.get(key);
    if (!session) {
      session = new Session(info, native, reportError, () =>
        sessions.delete(key),
      );
      sessions.set(key, session);
    }
    return session.port(handle, navigate);
  };
  // Factory lifetime owns the event subscription; callers may dispose by dropping the factory.
  void unsubscribe;
}

class Session {
  private readonly info: Identity;
  private readonly native: Native;
  private readonly reportError: (error: unknown) => void;
  private readonly removed: () => void;
  private sessionId: string | null = null;
  private review: unknown = null;
  private approved = false;
  private docs = new Map<
    string,
    { version: number; text: string; queue: Promise<void> }
  >();
  private requests = new Map<
    string,
    { handle: EditorLanguageServiceHandle; version: number }
  >();
  private listeners = new Set<
    (event: {
      readonly handle: EditorLanguageServiceHandle;
      readonly version: number;
      readonly diagnostics: readonly EditorLanguageServiceDiagnostic[];
    }) => void
  >();
  constructor(info: Identity, native: Native, reportError: (error: unknown) => void, removed: () => void) { this.info = info; this.native = native; this.reportError = reportError; this.removed = removed; }
  port(
    handle: EditorLanguageServiceHandle,
    navigate?: (location: EditorLanguageServiceLocation) => void,
  ): EditorLanguageServicePort {
    return {
      open: (_, snapshot) =>
        void this.enqueue(handle, () => this.open(handle, snapshot)),
      update: (_, snapshot) =>
        void this.enqueue(handle, () => this.update(handle, snapshot)),
      close: () => void this.enqueue(handle, () => this.close(handle)),
      request: <T>(
        _: unknown,
        method: string,
        params: unknown,
        version: number,
      ) =>
        this.request(
          handle,
          method,
          params,
          version,
          navigate,
        ) as Promise<T | null>,
      subscribeDiagnostics: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      navigate,
    };
  }
  event(event: {
    sessionId: string;
    uri?: string;
    version?: number;
    kind: "diagnostics" | "terminated";
    diagnostics?: readonly EditorLanguageServiceDiagnostic[];
  }) {
    if (event.sessionId !== this.sessionId) return;
    if (event.kind === "terminated") {
      this.sessionId = null;
      this.docs.clear();
      return;
    }
    if (!event.uri || event.version === undefined || !event.diagnostics) return;
    const doc = this.docs.get(event.uri);
    if (!doc || doc.version !== event.version) return;
    for (const listener of this.listeners)
      listener({
        handle: {
          tabId: "",
          path: event.uri,
          loadEpoch: this.info.workspaceGeneration,
        },
        version: event.version,
        diagnostics: event.diagnostics,
      });
  }
  private async ensure(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    if (!this.approved) {
      this.review = await this.native.prepare(
        this.info.workspaceRoot,
        this.info.pluginId,
      );
      this.approved = await this.native.confirm(this.review);
      if (!this.approved)
        throw new Error("language-service execution was denied");
    }
    this.sessionId = await this.native.start(
      this.info.workspaceRoot,
      (this.review as { reviewId: string }).reviewId,
    );
    return this.sessionId;
  }
  private enqueue(
    handle: EditorLanguageServiceHandle,
    operation: () => Promise<void>,
  ) {
    const info = identitySafe(handle, this.info);
    if (!info) return;
    const doc = this.docs.get(info.uri) ?? {
      version: 0,
      text: "",
      queue: Promise.resolve(),
    };
    doc.queue = doc.queue.then(operation).catch(this.reportError);
    this.docs.set(info.uri, doc);
  }
  private async open(
    _handle: EditorLanguageServiceHandle,
    snapshot: EditorLanguageServiceSnapshot,
  ) {
    if (snapshot.text.length > MAX_TEXT || this.docs.size > MAX_DOCS)
      throw new Error("language-service document limit exceeded");
    const session = await this.ensure();
    await this.native.open(
      this.info.workspaceRoot,
      session,
      this.info.uri,
      this.info.languageId,
      snapshot.version,
      snapshot.text,
    );
    this.docs.set(this.info.uri, {
      version: snapshot.version,
      text: snapshot.text,
      queue: Promise.resolve(),
    });
  }
  private async update(
    _handle: EditorLanguageServiceHandle,
    snapshot: EditorLanguageServiceSnapshot,
  ) {
    const doc = this.docs.get(this.info.uri);
    if (!doc || snapshot.version <= doc.version) return;
    const session = await this.ensure();
    await this.native.change(
      this.info.workspaceRoot,
      session,
      this.info.uri,
      snapshot.version,
      [{ range: null, text: snapshot.text }],
    );
    doc.version = snapshot.version;
    doc.text = snapshot.text;
  }
  private async close(_handle: EditorLanguageServiceHandle) {
    const session = this.sessionId;
    if (session)
      await this.native.close(this.info.workspaceRoot, session, this.info.uri);
    this.docs.delete(this.info.uri);
    if (!this.docs.size && session) {
      await this.native.stop(this.info.workspaceRoot, session);
      this.sessionId = null;
      this.removed();
    }
  }
  private async request(
    handle: EditorLanguageServiceHandle,
    method: string,
    params: unknown,
    version: number,
    navigate?: (location: EditorLanguageServiceLocation) => void,
  ) {
    void navigate;
    const feature =
      method === "hover"
        ? "hover"
        : method === "definition"
          ? "definition"
          : method === "completion"
            ? "completion"
            : null;
    if (!feature || this.requests.size >= MAX_REQUESTS) return null;
    const doc = this.docs.get(this.info.uri);
    if (!doc || doc.version !== version) return null;
    const session = await this.ensure();
    const requestId = `${Date.now()}-${this.requests.size}`;
    this.requests.set(requestId, { handle, version });
    try {
      const result = await this.native.request(
        this.info.workspaceRoot,
        session,
        this.info.uri,
        version,
        requestId,
        feature,
        Number((params as any)?.position?.line ?? 0),
        Number((params as any)?.position?.character ?? 0),
      );
      return result.version === doc.version ? result.result : null;
    } finally {
      this.requests.delete(requestId);
    }
  }
}
function identitySafe(handle: EditorLanguageServiceHandle, info: Identity) {
  return handle.path === info.uri ||
    handle.path === info.uri.replace(/^file:\/\//, "")
    ? info
    : null;
}
export type EditorLanguageServicePortFactory = (
  handle: EditorLanguageServiceHandle,
) => EditorLanguageServicePort | null;
