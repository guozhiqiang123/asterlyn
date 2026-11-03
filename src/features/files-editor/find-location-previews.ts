import type { EditorLanguageServiceLocation } from "../../protocol/editor-language-service.ts";
import type { FindLocationResultsSnapshot } from "./find-results-controller.ts";
import { locationPreviewLine, type FindLocationPreview } from "./find-results-view.ts";

interface PreviewFile {
  readonly location: EditorLanguageServiceLocation;
  readonly indices: number[];
}

interface PreviewSession {
  readonly snapshot: FindLocationResultsSnapshot;
  readonly files: Map<string, PreviewFile>;
  readonly queued: Map<string, PreviewFile>;
  readonly running: Set<string>;
  readonly completed: Set<string>;
}

export interface FindPreviewSummary {
  readonly files: number;
  readonly loaded: number;
  readonly ready: number;
  readonly unavailable: number;
}

interface FindPreviewPorts {
  current(snapshot: FindLocationResultsSnapshot): boolean;
  read(root: string, location: EditorLanguageServiceLocation): Promise<string | null>;
  changed(indices: readonly number[]): void;
  idle(summary: FindPreviewSummary): void;
}

/** Preview strings are bounded by the location snapshot; full source text is never cached. */
export class FindLocationPreviews {
  readonly values = new Map<number, FindLocationPreview | null>();
  private session: PreviewSession | null = null;
  // Keep the limit across snapshot replacement, including reads whose replies are now stale.
  private active = 0;
  private readonly ports: FindPreviewPorts;

  constructor(ports: FindPreviewPorts) { this.ports = ports; }

  reset(snapshot: FindLocationResultsSnapshot | null): void {
    this.values.clear();
    this.session = snapshot ? {
      snapshot, files: new Map(), queued: new Map(), running: new Set(), completed: new Set(),
    } : null;
    snapshot?.locations.forEach((location, index) => {
      const files = this.session!.files;
      const file = files.get(location.uri) ?? { location, indices: [] };
      file.indices.push(index);
      files.set(location.uri, file);
    });
  }

  request(indices: readonly number[]): void {
    const session = this.session;
    if (!session || !this.ports.current(session.snapshot)) return;
    // Fast scrolling replaces queued off-screen work; already started reads remain bounded.
    session.queued.clear();
    for (const index of indices) {
      const uri = session.snapshot.locations[index]?.uri;
      if (uri && !session.completed.has(uri) && !session.running.has(uri)) {
        session.queued.set(uri, session.files.get(uri)!);
      }
    }
    this.pump();
  }

  private pump(): void {
    const session = this.session;
    if (!session || !this.ports.current(session.snapshot)) return;
    while (this.active < 3 && session.queued.size) {
      const [uri, file] = session.queued.entries().next().value!;
      session.queued.delete(uri);
      session.running.add(uri);
      this.active++;
      void this.load(session, file).finally(() => {
        this.active--;
        session.running.delete(uri);
        this.pump();
        if (this.session === session && this.ports.current(session.snapshot) && !session.running.size && !session.queued.size) {
          const ready = [...this.values.values()].filter(Boolean).length;
          this.ports.idle({ files: session.files.size, loaded: session.completed.size, ready, unavailable: this.values.size - ready });
        }
      });
    }
  }

  private async load(session: PreviewSession, file: PreviewFile): Promise<void> {
    let text: string | null = null;
    try {
      text = file.location.readonlySource?.text ?? await this.ports.read(session.snapshot.repositoryRoot, file.location);
    } catch { /* A preview failure must not revoke navigation to its source location. */ }
    if (this.session !== session || !this.ports.current(session.snapshot)) return;
    const lines = text !== null && text.length <= 512 * 1024 ? text.split("\n") : [];
    for (const index of file.indices) {
      const target = session.snapshot.locations[index]!, { start, end } = target.range;
      this.values.set(index, locationPreviewLine(lines[start.line], start.character,
        start.line === end.line ? end.character : lines[start.line]?.length ?? 0));
    }
    session.completed.add(file.location.uri);
    this.ports.changed(file.indices);
  }
}
