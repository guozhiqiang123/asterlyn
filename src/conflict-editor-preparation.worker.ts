import {
  prepareConflictEditor,
  type ConflictEditorPreparationInput,
} from "./conflict-editor-preparation.ts";

interface ConflictPreparationRequest {
  readonly id: number;
  readonly input: ConflictEditorPreparationInput;
}

const workerScope = self as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ConflictPreparationRequest>) => void,
  ): void;
  postMessage(value: unknown): void;
};

workerScope.addEventListener("message", (event) => {
  const { id, input } = event.data;
  try {
    workerScope.postMessage({ id, result: prepareConflictEditor(input) });
  } catch (error) {
    workerScope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
