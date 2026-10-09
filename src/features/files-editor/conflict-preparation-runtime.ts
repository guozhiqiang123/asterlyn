import { Change } from "@codemirror/merge";
import type {
  ConflictEditorPreparation,
  ConflictEditorPreparationInput,
} from "../../conflict-editor-preparation.ts";

interface PendingPreparation {
  readonly input: ConflictEditorPreparationInput;
  readonly resolve: (result: ConflictEditorPreparation) => void;
}

interface PreparationResponse {
  readonly id: number;
  readonly result?: ConflictEditorPreparation;
  readonly error?: string;
}

/**
 * Keeps expensive visual Diff preparation off the UI thread. Failure is recoverable: one dynamic
 * fallback performs the same pure calculation on the current thread rather than losing the editor.
 */
export class ConflictPreparationRuntime {
  private worker: Worker | null = null;
  private unavailable = false;
  private sequence = 0;
  private readonly pending = new Map<number, PendingPreparation>();

  prepare(input: ConflictEditorPreparationInput): Promise<ConflictEditorPreparation> {
    if (this.unavailable || typeof Worker === "undefined") return fallbackPreparation(input);
    const worker = this.ensureWorker();
    if (!worker) return fallbackPreparation(input);
    const id = ++this.sequence;
    return new Promise((resolve) => {
      this.pending.set(id, { input, resolve });
      worker.postMessage({ id, input });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.unavailable = true;
    this.pending.clear();
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(
        new URL("../../conflict-editor-preparation.worker.ts", import.meta.url),
        { type: "module", name: "asterlyn-conflict-preparation" },
      );
      worker.addEventListener("message", this.handleMessage);
      worker.addEventListener("error", this.handleWorkerFailure);
      worker.addEventListener("messageerror", this.handleWorkerFailure);
      this.worker = worker;
      return worker;
    } catch {
      this.unavailable = true;
      return null;
    }
  }

  private readonly handleMessage = (event: MessageEvent<PreparationResponse>): void => {
    const request = this.pending.get(event.data.id);
    if (!request) return;
    this.pending.delete(event.data.id);
    if (event.data.result) request.resolve(rehydratePreparation(event.data.result));
    else void fallbackPreparation(request.input).then(request.resolve);
  };

  private readonly handleWorkerFailure = (): void => {
    this.worker?.terminate();
    this.worker = null;
    this.unavailable = true;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) void fallbackPreparation(request.input).then(request.resolve);
  };
}

/** Structured clone preserves fields but not CodeMirror's Change prototype. */
function rehydratePreparation(
  result: ConflictEditorPreparation,
): ConflictEditorPreparation {
  const changes = (items: readonly Change[]) => items.map((item) => new Change(
    item.fromA,
    item.toA,
    item.fromB,
    item.toB,
  ));
  return {
    analysis: {
      ours: changes(result.analysis.ours),
      result: changes(result.analysis.result),
      theirs: changes(result.analysis.theirs),
    },
    oursToResult: changes(result.oursToResult),
    theirsToResult: changes(result.theirsToResult),
  };
}

async function fallbackPreparation(
  input: ConflictEditorPreparationInput,
): Promise<ConflictEditorPreparation> {
  const { prepareConflictEditor } = await import("../../conflict-editor-preparation.ts");
  return prepareConflictEditor(input);
}
