import { icon } from "../../icons.ts";
import type {
  BranchSummary,
  CommitSummary,
  GitRootDescriptor,
} from "../../models.ts";
import {
  commitReferences,
  projectCommitGraph,
  type CommitGraphRow,
  type CommitGraphSegment,
  type CommitReference,
} from "../../workbench/git-presentation.ts";
import {
  collapseLinearHistory,
  type HistoryDisplayEntry,
} from "../../workbench/history-collapse.ts";
import { commitKey } from "../../workbench/history-identity.ts";

export const HISTORY_ROW_LIMIT = 3_000;

export interface HistoryListPresentation {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  loadedCommits: CommitSummary[];
  commits: CommitSummary[];
  textError: string | null;
  selectedCommit: string | null;
  collapseLinear: boolean;
  bridgeOmittedParents: boolean;
  repositoryRoots: GitRootDescriptor[];
  branches: BranchSummary[];
  loadingMore: boolean;
  pagingError: string | null;
  hasMore: boolean;
}

export interface HistoryListActions {
  selectCommit(key: string, restoreFocus: boolean): void;
  expandLinearHistory(firstKey: string | null): void;
  retryPaging(): void;
  scroll(host: HTMLElement): void;
}

export class GitHistoryListView {
  private host: HTMLElement | null = null;
  private actions: HistoryListActions | null = null;

  mount(host: HTMLElement, actions: HistoryListActions): void {
    if (this.host === host) {
      this.actions = actions;
      return;
    }
    this.unmount();
    this.host = host;
    this.actions = actions;
    host.addEventListener("click", this.handleClick);
    host.addEventListener("keydown", this.handleKeydown);
    host.addEventListener("scroll", this.handleScroll, { passive: true });
  }

  unmount(): void {
    this.host?.removeEventListener("click", this.handleClick);
    this.host?.removeEventListener("keydown", this.handleKeydown);
    this.host?.removeEventListener("scroll", this.handleScroll);
    this.host = null;
    this.actions = null;
  }

  render(presentation: HistoryListPresentation): void {
    if (this.host) this.host.innerHTML = renderHistoryList(presentation);
  }

  updateSelection(key: string): void {
    this.host?.querySelectorAll<HTMLButtonElement>("[data-commit-key]").forEach((row) => {
      const selected = row.dataset.commitKey === key;
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-selected", String(selected));
    });
  }

  focusCommit(key: string): void {
    Array.from(this.host?.querySelectorAll<HTMLButtonElement>("[data-commit-key]") ?? [])
      .find((row) => row.dataset.commitKey === key)
      ?.focus();
  }

  private readonly handleClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !this.host?.contains(target)) return;
    if (target.closest("[data-retry-history-page]")) {
      this.actions?.retryPaging();
      return;
    }
    const collapsed = target.closest<HTMLButtonElement>("[data-expand-linear-history]");
    if (collapsed) {
      this.actions?.expandLinearHistory(collapsed.dataset.firstCollapsed ?? null);
      return;
    }
    const row = target.closest<HTMLButtonElement>("[data-commit-key]");
    const key = row?.dataset.commitKey;
    if (key) this.actions?.selectCommit(key, false);
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-commit-key]")
      : null;
    if (!target || !this.host?.contains(target)) return;
    const rows = Array.from(
      this.host.querySelectorAll<HTMLButtonElement>("[data-commit-key]"),
    );
    const current = rows.indexOf(target);
    if (current < 0) return;
    event.preventDefault();
    const destination =
      event.key === "Home"
        ? rows[0]
        : event.key === "End"
          ? rows.at(-1)
          : rows[current + (event.key === "ArrowDown" ? 1 : -1)];
    const key = destination?.dataset.commitKey;
    if (key) this.actions?.selectCommit(key, true);
  };

  private readonly handleScroll = (): void => {
    if (this.host) this.actions?.scroll(this.host);
  };
}

export function renderHistoryList(presentation: HistoryListPresentation): string {
  if (presentation.status === "loading") {
    return '<div class="loading-block"><span class="spinner"></span><span>Loading filtered history…</span></div>';
  }
  if (presentation.status === "error") {
    return `<div class="empty-state"><span class="empty-icon">${icon("history", 24)}</span><strong>Could not load history</strong><p>${escapeHtml(presentation.error ?? "The selected history query could not be read.")}</p><button class="secondary-button retry-button" data-retry-history-page type="button">Try again</button></div>`;
  }
  if (presentation.loadedCommits.length === 0) {
    return '<div class="history-no-results"><strong>No commits match these filters</strong><span>Clear one or more history filters to widen the query.</span></div>';
  }

  const textError = presentation.textError
    ? `<div class="history-text-error" role="status">Invalid expression: ${escapeHtml(presentation.textError)}${presentation.commits.length > 0 ? ". Showing the unfiltered result." : ""}</div>`
    : "";
  if (presentation.commits.length === 0) {
    return `${textError}<div class="history-no-results"><strong>No matching commits</strong><span>Try a message, author, decoration, or full hash.</span></div>${renderPagingStatus(presentation)}`;
  }

  const entries: HistoryDisplayEntry[] = presentation.collapseLinear
    ? collapseLinearHistory(presentation.commits, presentation.selectedCommit)
    : presentation.commits.map((commit) => ({ kind: "commit", commit, graphCommit: commit }));
  const graph = projectCommitGraph(entries.map((entry) => entry.graphCommit), {
    bridgeOmittedParents: presentation.bridgeOmittedParents,
  });
  const graphWidth = Math.max(22, 14 + (graph.laneCount - 1) * 12);
  const roots = new Map(presentation.repositoryRoots.map((root) => [root.id, root]));
  const multipleRoots = presentation.repositoryRoots.length > 1;
  const rows = entries
    .map((entry, index) => {
      if (entry.kind === "collapsed") {
        return `<button class="history-row history-collapsed-row" type="button" data-expand-linear-history data-first-collapsed="${escapeAttribute(entry.firstKey)}" title="Expand ${entry.count} linear commits">${renderCommitGraph(graph.rows[index]!, graphWidth, true)}<span class="history-subject">${entry.count} linear commits collapsed</span><span class="history-references"></span><span class="history-author">Expand</span><span class="history-date"></span></button>`;
      }
      const commit = entry.commit;
      const key = commitKey(commit);
      const selected = key === presentation.selectedCommit;
      const references = renderCommitReferenceBadges(
        commit.decorations,
        presentation.branches.filter((branch) => branch.repositoryId === commit.repositoryId),
        2,
      );
      const root = roots.get(commit.repositoryId);
      const rootBadge = multipleRoots
        ? `<span class="history-root-badge" title="Git root: ${escapeAttribute(root?.relativePath ?? commit.repositoryId)}">${escapeHtml(root?.displayName ?? commit.repositoryId)}</span>`
        : "";
      return `<button class="history-row ${selected ? "selected" : ""}" type="button" role="option" data-commit="${escapeAttribute(commit.oid)}" data-commit-key="${escapeAttribute(key)}" aria-selected="${selected}" title="${escapeAttribute(commit.subject)}">${renderCommitGraph(graph.rows[index]!, graphWidth)}<span class="history-subject">${escapeHtml(commit.subject)}</span><span class="history-references">${references}${rootBadge}</span><span class="history-author" title="${escapeAttribute(`${commit.authorName} <${commit.authorEmail}>`)}">${escapeHtml(commit.authorName)}</span><time class="history-date" datetime="${new Date(commit.authoredAt * 1000).toISOString()}">${escapeHtml(formatAbsolute(commit.authoredAt))}</time></button>`;
    })
    .join("");

  return `${textError}<div class="history-list" role="listbox" aria-label="Commit history" style="--history-graph-width:${graphWidth}px">${rows}</div>${renderPagingStatus(presentation)}`;
}

function renderPagingStatus(presentation: HistoryListPresentation): string {
  if (presentation.loadingMore) {
    return '<div class="history-page-status" role="status">Loading older commits…</div>';
  }
  if (presentation.pagingError) {
    return `<div class="history-page-status error" role="status"><span>${escapeHtml(presentation.pagingError)}</span><button type="button" data-retry-history-page>Retry</button></div>`;
  }
  if (presentation.loadedCommits.length >= HISTORY_ROW_LIMIT) {
    return `<div class="history-page-status">Showing the newest ${HISTORY_ROW_LIMIT.toLocaleString()} commits (session limit)</div>`;
  }
  if (presentation.hasMore) {
    return '<div class="history-page-status muted">Scroll to load older commits</div>';
  }
  const count = presentation.loadedCommits.length;
  return `<div class="history-page-status muted" title="No older commits are available for the current filters.">All history loaded · ${count.toLocaleString()} ${count === 1 ? "commit" : "commits"}</div>`;
}

function renderCommitGraph(
  row: CommitGraphRow,
  width: number,
  collapsed = false,
): string {
  const parentSummary =
    row.parentCount === 0
      ? "root commit"
      : row.parentCount === 1
        ? "one parent"
        : `merge commit with ${row.parentCount} parents`;
  const lines = row.segments
    .map(
      (segment) =>
        `<path class="commit-graph-line ${collapsed ? "collapsed" : ""} graph-color-${segment.color}" d="${commitGraphPath(segment)}" />`,
    )
    .join("");
  const nodeX = 7 + row.nodeLane * 12;
  const node = collapsed
    ? `<circle class="commit-graph-gap graph-color-${row.nodeColor}" cx="${nodeX}" cy="8" r="1.2"/><circle class="commit-graph-gap graph-color-${row.nodeColor}" cx="${nodeX}" cy="14" r="1.2"/><circle class="commit-graph-gap graph-color-${row.nodeColor}" cx="${nodeX}" cy="20" r="1.2"/>`
    : `<circle class="commit-graph-node graph-color-${row.nodeColor} ${row.parentCount > 1 ? "merge" : ""}" cx="${nodeX}" cy="14" r="${row.parentCount > 1 ? 4 : 3.5}" />`;
  const label = collapsed
    ? `Collapsed linear continuation in graph lane ${row.nodeLane + 1} of ${row.laneCount}`
    : `Graph lane ${row.nodeLane + 1} of ${row.laneCount}, ${parentSummary}`;
  return `<span class="history-graph" role="img" aria-label="${label}"><svg viewBox="0 0 ${width} 28" width="${width}" height="28" aria-hidden="true" focusable="false">${lines}${node}</svg></span>`;
}

function commitGraphPath(segment: CommitGraphSegment): string {
  const fromX = 7 + segment.fromLane * 12;
  const toX = 7 + segment.toLane * 12;
  const fromY = segment.kind === "parent" ? 14 : 0;
  const toY = segment.kind === "incoming" ? 14 : 28;
  if (fromX === toX) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  const middleY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${middleY}, ${toX} ${middleY}, ${toX} ${toY}`;
}

function renderCommitReferenceBadges(
  decorations: string[],
  branches: BranchSummary[],
  limit: number,
): string {
  const references = commitReferences(decorations, branches);
  const visible = references.slice(0, limit);
  const remaining = references.length - visible.length;
  return `${visible.map(renderCommitReferenceBadge).join("")}${remaining > 0 ? `<span class="commit-reference-more" title="${escapeAttribute(references.map((reference) => reference.label).join(", "))}">+${remaining}</span>` : ""}`;
}

function renderCommitReferenceBadge(reference: CommitReference): string {
  const iconName = reference.kind === "head"
    ? "head"
    : reference.kind === "tag" || reference.kind === "other"
      ? "tag"
      : "branch";
  return `<span class="commit-reference ${reference.kind}" title="${escapeAttribute(capitalize(reference.kind))}: ${escapeAttribute(reference.label)}">${icon(iconName, 12)}<span>${escapeHtml(reference.label)}</span></span>`;
}

function formatAbsolute(epochSeconds: number): string {
  if (!epochSeconds) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochSeconds * 1000));
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
