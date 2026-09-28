import type { StashCopy } from "../../localization/stash-copy.ts";
import type { StashEntry } from "../../models.ts";
import type { ContextMenuAvailability, ContextMenuItem, ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import { DelegatedContextBinding } from "../../shared/context-menu/delegated-context-binding.ts";
import { stashDomKey, type StashState } from "./stash-controller.ts";

const OWNER_ID = "git-stash.context-actions";
const ENABLED = { kind: "enabled" } as const;

export interface StashContextRuntime {
  state(): StashState;
  copy(): StashCopy;
  busy(): boolean;
  clean(): boolean;
  current(entry: StashEntry): boolean;
  select(entry: StashEntry): void;
  action(action: "apply" | "pop" | "unstash" | "drop" | "clear" | "show-diff" | "show-diff-new-tab", entry: StashEntry): void | Promise<void>;
  blocked(reason: string): void;
  error(error: unknown): void;
}

export class StashContextActions {
  private readonly binding: DelegatedContextBinding<StashEntry>;

  constructor(root: HTMLElement, host: ContextMenuPort, private readonly runtime: StashContextRuntime) {
    this.binding = new DelegatedContextBinding(root, {
      selector: "[data-stash-key]",
      resolve: (trigger) => {
        const key = trigger.dataset.stashKey;
        return this.runtime.state().entries.find((entry) => stashDomKey(entry) === key) ?? null;
      },
      open: (request) => {
        const entry = request.target;
        if (!this.runtime.current(entry)) return false;
        this.runtime.select(entry);
        const copy = this.runtime.copy();
        const busy: ContextMenuAvailability = this.runtime.busy()
          ? { kind: "busy", label: copy.loading }
          : ENABLED;
        const restore: ContextMenuAvailability = this.runtime.clean()
          ? busy
          : { kind: "blocked", reason: copy.cleanRequired };
        const clear: ContextMenuAvailability = this.runtime.state().truncatedRepositoryIds.includes(entry.repositoryId)
          ? { kind: "blocked", reason: copy.truncated }
          : busy;
        const command = (id: string, label: string, availability: ContextMenuAvailability = busy, tone: "normal" | "danger" = "normal"): ContextMenuItem => ({
          kind: "command", id: `${OWNER_ID}.${id}`, actionId: `${OWNER_ID}.${id}`, label, availability, tone,
        });
        host.open(request.anchor, {
          ownerId: OWNER_ID,
          model: {
            ariaLabel: `${copy.title}: ${entry.subject}`,
            items: [
              command("pop", copy.pop, restore),
              command("apply", copy.apply, restore),
              command("unstash", copy.unstash, restore),
              command("drop", copy.drop, busy, "danger"),
              command("clear", copy.clear, clear, "danger"),
              { kind: "separator" },
              command("show-diff", copy.showDiff),
              command("show-diff-new-tab", copy.showDiffNewTab),
            ],
          },
          isCurrent: () => this.runtime.current(entry),
          invoke: async (actionId) => {
            try {
              const action = actionId.slice(`${OWNER_ID}.`.length) as Parameters<StashContextRuntime["action"]>[0];
              await this.runtime.action(action, entry);
            } catch (error) {
              this.runtime.error(error);
            }
          },
          blocked: (reason) => this.runtime.blocked(reason),
          restoreFocus: request.restoreFocus,
        });
        return true;
      },
    });
  }

  dispose(): void { this.binding.dispose(); }
}
