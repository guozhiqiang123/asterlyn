import type { HistoryCopy } from "../../localization/catalog.ts";
import type { BranchSummary, RepositorySnapshot } from "../../models.ts";
import type { ContextMenuItem, ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import { branchKey } from "./history-identity.ts";
import { BranchContextActions } from "./branch-context-actions.ts";
import { resolveBranchContextTarget } from "./branch-context-binding.ts";

const OWNER_ID = "topbar.current-branch-menu";
const ENABLED = { kind: "enabled" } as const;

export interface TopbarBranchMenuSource {
  readonly snapshot: RepositorySnapshot | null;
  readonly workspaceGeneration: number;
  readonly repositoryRevision: number;
}

export class TopbarBranchMenuBinding {
  private readonly host: ContextMenuPort;
  private readonly actions: BranchContextActions;
  private readonly current: () => TopbarBranchMenuSource;
  private readonly copy: () => HistoryCopy;
  private readonly manageRemotes: () => void;
  private readonly root: HTMLElement;
  private readonly listener: (event: Event) => void;

  constructor(
    root: HTMLElement,
    host: ContextMenuPort,
    actions: BranchContextActions,
    current: () => TopbarBranchMenuSource,
    copy: () => HistoryCopy,
    manageRemotes: () => void,
  ) {
    this.host = host;
    this.actions = actions;
    this.current = current;
    this.copy = copy;
    this.manageRemotes = manageRemotes;
    this.root = root;
    this.listener = (event) => {
      if ((event.target as Element | null)?.closest?.("#current-branch-menu")) this.open();
    };
    root.addEventListener("click", this.listener);
  }

  render(snapshot: RepositorySnapshot | null): void {
    const button = this.button();
    if (!button) return;
    const label = snapshot?.branch.detached
      ? snapshot.branch.oid?.slice(0, 8) ?? this.copy().topbarBranchMenu.noBranch
      : snapshot?.branch.head ?? this.copy().topbarBranchMenu.noBranch;
    const text = button.querySelector<HTMLElement>("#current-branch-name");
    if (text) text.textContent = label;
    button.disabled = !snapshot;
    button.setAttribute("aria-expanded", "false");
  }

  dispose(): void { this.root.removeEventListener("click", this.listener); }

  private open(): void {
    const source = this.current();
    const snapshot = source.snapshot;
    const button = this.button();
    if (!snapshot || !button) return;
    const labels = this.copy();
    const branches = snapshot.branches.filter((branch) =>
      branch.repositoryId === "." && (branch.kind === "local" || branch.kind === "remote")
    );
    const commands = new Map<string, BranchSummary>();
    const items: ContextMenuItem[] = [command(`${OWNER_ID}.manage`, labels.topbarBranchMenu.manageRemotes)];
    appendBranches(items, commands, branches.filter((branch) => branch.kind === "local"), "local", labels.groups.local);
    appendBranches(items, commands, branches.filter((branch) => branch.kind === "remote"), "remote", labels.groups.remote);
    const rectangle = button.getBoundingClientRect();
    button.setAttribute("aria-expanded", "true");
    this.host.open({ x: rectangle.left, y: rectangle.bottom + 3 }, {
      ownerId: OWNER_ID,
      model: { ariaLabel: labels.topbarBranchMenu.ariaLabel, items },
      isCurrent: () => {
        const next = this.current();
        return next.snapshot?.root === snapshot.root &&
          next.workspaceGeneration === source.workspaceGeneration &&
          next.repositoryRevision === source.repositoryRevision;
      },
      invoke: (actionId) => {
        if (actionId === `${OWNER_ID}.manage`) { this.manageRemotes(); return; }
        const branch = commands.get(actionId);
        if (!branch) return;
        const latest = this.current();
        const target = resolveBranchContextTarget(
          latest.snapshot, latest.workspaceGeneration, latest.repositoryRevision,
          new Set(["."]), branchKey(branch),
        );
        if (!target) return;
        this.actions.open({
          target, trigger: button,
          anchor: { x: rectangle.left + 14, y: rectangle.bottom + 3 },
          restoreFocus: () => this.button()?.focus(),
        });
      },
      blocked: () => undefined,
      dismissed: () => this.button()?.setAttribute("aria-expanded", "false"),
      restoreFocus: () => this.button()?.focus(),
    });
  }

  private button(): HTMLButtonElement | null {
    return this.root.querySelector?.<HTMLButtonElement>("#current-branch-menu") ?? null;
  }
}

function appendBranches(
  items: ContextMenuItem[],
  commands: Map<string, BranchSummary>,
  branches: BranchSummary[],
  group: string,
  label: string,
): void {
  if (branches.length === 0) return;
  items.push({ kind: "separator" });
  items.push({ kind: "heading", label });
  branches.sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name));
  for (const [index, branch] of branches.entries()) {
    const id = `${OWNER_ID}.${group}.${index}`;
    commands.set(id, branch);
    items.push(command(id, `${branch.current ? "✓ " : ""}${branch.name}`));
  }
}

function command(id: string, label: string): ContextMenuItem {
  return { kind: "command", id, actionId: id, label, availability: ENABLED };
}
