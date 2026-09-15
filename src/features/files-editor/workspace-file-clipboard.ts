import type {
  WorkspaceEntryInspection,
  WorkspaceEntryKind,
} from "../../models.ts";

export type WorkspaceFileClipboardMode = "copy" | "cut";

export interface WorkspaceFileClipboardEntry {
  readonly mode: WorkspaceFileClipboardMode;
  readonly workspaceRoot: string;
  readonly workspaceGeneration: number;
  readonly workspacePath: string;
  readonly kind: WorkspaceEntryKind;
  readonly repositoryId: string;
  readonly repositoryPath: string;
  readonly inspection: WorkspaceEntryInspection;
}

type Listener = (entry: WorkspaceFileClipboardEntry | null) => void;

/** Window-local clipboard for safe workspace transfers. It never writes the operating-system clipboard. */
export class WorkspaceFileClipboard {
  private value: WorkspaceFileClipboardEntry | null = null;
  private readonly listeners = new Set<Listener>();

  get entry(): WorkspaceFileClipboardEntry | null {
    return this.value;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  capture(
    mode: WorkspaceFileClipboardMode,
    workspaceRoot: string,
    workspaceGeneration: number,
    repositoryId: string,
    repositoryPath: string,
    inspection: WorkspaceEntryInspection,
  ): WorkspaceFileClipboardEntry | null {
    if (!safeInspection(inspection)) return null;
    const next: WorkspaceFileClipboardEntry = {
      mode,
      workspaceRoot,
      workspaceGeneration,
      workspacePath: inspection.source.workspacePath,
      kind: inspection.source.kind,
      repositoryId,
      repositoryPath,
      inspection: structuredClone(inspection),
    };
    this.value = next;
    this.emit();
    return next;
  }

  current(workspaceRoot: string, workspaceGeneration: number): WorkspaceFileClipboardEntry | null {
    const entry = this.value;
    if (
      !entry ||
      entry.workspaceRoot !== workspaceRoot ||
      entry.workspaceGeneration !== workspaceGeneration
    ) return null;
    return entry;
  }

  consume(entry: WorkspaceFileClipboardEntry): void {
    if (this.value !== entry) return;
    this.value = null;
    this.emit();
  }

  advanceGeneration(
    entry: WorkspaceFileClipboardEntry,
    workspaceRoot: string,
    workspaceGeneration: number,
  ): WorkspaceFileClipboardEntry | null {
    if (this.value !== entry || entry.workspaceRoot !== workspaceRoot) return null;
    const next = { ...entry, workspaceGeneration };
    this.value = next;
    this.emit();
    return next;
  }

  clear(): void {
    if (!this.value) return;
    this.value = null;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.value);
  }
}

export function workspaceFileClipboardMatchesPreview(
  entry: WorkspaceFileClipboardEntry,
  preview: {
    readonly source: WorkspaceEntryInspection["source"] | null;
    readonly fingerprint: string | null;
  },
): boolean {
  const source = preview.source;
  return Boolean(
    source &&
    preview.fingerprint === entry.inspection.fingerprint &&
    source.workspacePath === entry.workspacePath &&
    source.kind === entry.kind &&
    source.revision === entry.inspection.source.revision &&
    source.mode === entry.inspection.source.mode &&
    source.byteLength === entry.inspection.source.byteLength
  );
}

function safeInspection(inspection: WorkspaceEntryInspection): boolean {
  return Boolean(
    inspection.source.workspacePath &&
    inspection.fingerprint &&
    !inspection.truncated &&
    inspection.symlinkPaths.length === 0 &&
    inspection.nestedRepositoryPaths.length === 0 &&
    inspection.multipleLinkPaths.length === 0
  );
}
