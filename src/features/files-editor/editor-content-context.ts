import type { ContextMenuAnchor, ContextMenuAvailability, ContextMenuModel, ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";

export interface EditorContentHandle { readonly tabId: string; readonly path: string; readonly loadEpoch: number; }
export interface EditorContentRequest {
  readonly handle: EditorContentHandle;
  readonly anchor: ContextMenuAnchor;
  readonly selectedText: string;
  readonly hasSelection: boolean;
  readonly readOnly: boolean;
  isCurrent(): boolean;
  isTargetCurrent?(): boolean;
  replaceSelection(text: string, kind: "cut" | "paste"): void;
  replaceDocument(text: string): void;
  restoreFocus(): void;
}
export interface EditorContentCopy {
  readonly ariaLabel: string; readonly cut: string; readonly copy: string; readonly paste: string;
  readonly find: string; readonly reveal: string; readonly history: string; readonly diff: string;
  readonly rollback: string; readonly readOnly: string; readonly unavailable: string;
  readonly changed: string; readonly copied: string; readonly cutDone: string; readonly pasted: string; readonly emptyClipboard: string;
  readonly rollbackConfirm: (path: string) => string;
}
export interface EditorTextClipboardPort {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}
export interface EditorFileContext {
  readonly changed: boolean;
  readonly reveal: ContextMenuAvailability;
  readonly history: ContextMenuAvailability;
  readonly diff: ContextMenuAvailability;
  readonly rollback: ContextMenuAvailability;
  isCurrent(): boolean;
  showHistory(): void;
  revealFile(): void | Promise<void>;
  showDiff(): void | Promise<void>;
  rollBack(request: EditorContentRequest): void | Promise<void>;
}
export interface EditorContentContextPort { open(request: EditorContentRequest): void; }
export const EDITOR_CONTENT_CONTEXT_OWNER = "editor.content";

export function editorContentMenuModel(request: Pick<EditorContentRequest, "hasSelection" | "readOnly">, file: EditorFileContext | null, copy: EditorContentCopy): ContextMenuModel {
  const enabled = { kind: "enabled" } as const;
  const edit = request.readOnly ? { kind: "blocked" as const, reason: copy.readOnly } : enabled;
  const unavailable = { kind: "blocked" as const, reason: copy.unavailable };
  const command = (id: string, label: string, availability: ContextMenuAvailability, danger = false) => ({
    kind: "command" as const, id: `${EDITOR_CONTENT_CONTEXT_OWNER}.${id}`, actionId: id, label, availability,
    ...(danger ? { tone: "danger" as const } : {}),
  });
  return { ariaLabel: copy.ariaLabel, items: request.hasSelection ? [
    command("cut", copy.cut, edit), command("copy", copy.copy, enabled), command("paste", copy.paste, edit),
    { kind: "separator" }, command("find", copy.find, enabled),
  ] : [
    command("paste", copy.paste, edit), { kind: "separator" },
    command("reveal", copy.reveal, file?.reveal ?? unavailable),
    command("history", copy.history, file?.history ?? unavailable),
    ...(file?.changed ? [command("diff", copy.diff, file.diff), command("rollback", copy.rollback, file.rollback, true)] : []),
  ] };
}

export interface EditorContentContextOptions {
  readonly host: ContextMenuPort;
  readonly clipboard: EditorTextClipboardPort;
  readonly file: (handle: EditorContentHandle) => EditorFileContext | null;
  readonly copy: () => EditorContentCopy;
  readonly find: (text: string) => void;
  readonly status: (text: string) => void;
  readonly error: (error: unknown) => void;
}

/** Feature policy and captured selections stay outside the generic window menu host. */
export class EditorContentContextRuntime implements EditorContentContextPort {
  private readonly options: EditorContentContextOptions;
  constructor(options: EditorContentContextOptions) { this.options = options; }

  open(request: EditorContentRequest): void {
    const file = this.options.file(request.handle), copy = this.options.copy();
    const current = () => request.isCurrent() && (!file || file.isCurrent());
    const targetCurrent = () => (request.isTargetCurrent?.() ?? request.isCurrent()) && (!file || file.isCurrent());
    if (!current()) return;
    const model = editorContentMenuModel(request, file, copy);
    this.options.host.open(request.anchor, {
      ownerId: EDITOR_CONTENT_CONTEXT_OWNER, model, isCurrent: targetCurrent,
      restoreFocus: request.restoreFocus, blocked: this.options.status,
      invoke: async id => {
        if (!current()) { this.options.status(copy.changed); return; }
        const item = model.items.find(item => item.kind === "command" && item.actionId === id);
        if (!item || item.kind !== "command" || item.availability.kind !== "enabled") return;
        try {
          if (id === "cut" || id === "copy") {
            await this.options.clipboard.writeText(request.selectedText);
            if (id === "cut") {
              if (!current()) { this.options.status(copy.changed); return; }
              request.replaceSelection("", "cut");
            }
            this.options.status(id === "cut" ? copy.cutDone : copy.copied);
          } else if (id === "paste") {
            const text = await this.options.clipboard.readText();
            if (!current()) { this.options.status(copy.changed); return; }
            if (text) { request.replaceSelection(text, "paste"); this.options.status(copy.pasted); }
            else this.options.status(copy.emptyClipboard);
          } else if (id === "find") this.options.find(request.selectedText);
          else if (id === "reveal") await file?.revealFile();
          else if (id === "history") file?.showHistory();
          else if (id === "diff") await file?.showDiff();
          else if (id === "rollback") await file?.rollBack(request);
        } catch (error) { this.options.error(error); }
      },
    });
  }
}
