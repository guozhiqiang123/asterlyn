import type { ProjectFile } from "../../models";

export const RECENT_FILE_LIMIT = 50;
export const NAVIGATION_RESULT_LIMIT = 100;

export type NavigationMode = "files" | "recent" | "workspace" | "commands";

export interface NavigationCommand {
  id: string;
  label: string;
  detail: string;
  keywords?: string;
  shortcut?: string;
  enabled: boolean;
}

export interface CommandSurfaceState {
  mode: NavigationMode | null;
  query: string;
  selectedIndex: number;
}

export function createCommandSurfaceState(): CommandSurfaceState {
  return { mode: null, query: "", selectedIndex: 0 };
}

export function openCommandSurface(
  state: CommandSurfaceState,
  mode: NavigationMode,
  query = "",
): CommandSurfaceState {
  return { ...state, mode, query, selectedIndex: 0 };
}

export function closeCommandSurface(
  state: CommandSurfaceState,
): CommandSurfaceState {
  return { ...state, mode: null, query: "", selectedIndex: 0 };
}

export function updateCommandSurfaceQuery(
  state: CommandSurfaceState,
  query: string,
): CommandSurfaceState {
  return { ...state, query, selectedIndex: 0 };
}

export function moveCommandSurfaceSelection(
  state: CommandSurfaceState,
  delta: number,
  resultCount: number,
): CommandSurfaceState {
  if (resultCount <= 0) return { ...state, selectedIndex: 0 };
  const selectedIndex =
    (state.selectedIndex + delta % resultCount + resultCount) % resultCount;
  return { ...state, selectedIndex };
}

export function clampCommandSurfaceSelection(
  state: CommandSurfaceState,
  resultCount: number,
): CommandSurfaceState {
  return {
    ...state,
    selectedIndex:
      resultCount <= 0 ? 0 : Math.min(state.selectedIndex, resultCount - 1),
  };
}

interface StoredFileIdentity {
  repositoryId: string;
  path: string;
}

interface StoredRecentFiles {
  version: 1;
  repositories: Record<string, StoredFileIdentity[]>;
}

interface IndexedProjectFile {
  readonly file: ProjectFile;
  readonly key: string;
  readonly normalizedPath: string;
  readonly basenameStart: number;
}

interface RankedProjectFile {
  readonly entry: IndexedProjectFile;
  readonly score: number;
}

export class ProjectFileSearchIndex {
  private readonly entries: readonly IndexedProjectFile[];
  private readonly filesByKey: ReadonlyMap<string, ProjectFile>;

  constructor(files: readonly ProjectFile[]) {
    const seen = new Set<string>();
    const entries: IndexedProjectFile[] = [];
    const filesByKey = new Map<string, ProjectFile>();
    for (const file of files) {
      const key = projectFileKey(file);
      if (seen.has(key)) continue;
      seen.add(key);
      const normalizedPath = file.workspacePath.toLocaleLowerCase();
      const basenameStart = normalizedPath.lastIndexOf("/") + 1;
      entries.push({
        file,
        key,
        normalizedPath,
        basenameStart,
      });
      filesByKey.set(key, file);
    }
    this.entries = entries;
    this.filesByKey = filesByKey;
  }

  rank(
    query: string,
    recent: readonly ProjectFile[] = [],
    limit = NAVIGATION_RESULT_LIMIT,
  ): ProjectFile[] {
    const boundedLimit = Math.max(0, limit);
    if (boundedLimit === 0) return [];
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length === 0) return this.rankDefault(recent, boundedLimit);

    const best: RankedProjectFile[] = [];
    for (const entry of this.entries) {
      const score = fuzzyIndexedPathScore(entry, normalized);
      if (score === null) continue;
      retainBestProjectFile(best, { entry, score }, boundedLimit);
    }
    return best.sort(compareRankedProjectFiles).map(({ entry }) => entry.file);
  }

  resolve(identity: StoredFileIdentity): ProjectFile | undefined {
    return this.filesByKey.get(projectFileKey(identity));
  }

  private rankDefault(recent: readonly ProjectFile[], limit: number): ProjectFile[] {
    const ranked: ProjectFile[] = [];
    const selected = new Set<string>();
    for (const file of recent) {
      const key = projectFileKey(file);
      const available = this.filesByKey.get(key);
      if (!available || selected.has(key)) continue;
      selected.add(key);
      ranked.push(available);
      if (ranked.length === limit) return ranked;
    }
    for (const entry of this.entries) {
      if (selected.has(entry.key)) continue;
      ranked.push(entry.file);
      if (ranked.length === limit) break;
    }
    return ranked;
  }
}

export function projectFileKey(
  file: Pick<ProjectFile, "repositoryId" | "path">,
): string {
  return `${file.repositoryId}\0${file.path}`;
}

export function rankProjectFiles(
  files: readonly ProjectFile[],
  query: string,
  recent: readonly ProjectFile[] = [],
  limit = NAVIGATION_RESULT_LIMIT,
): ProjectFile[] {
  return new ProjectFileSearchIndex(files).rank(query, recent, limit);
}

export function rankCommands(
  commands: NavigationCommand[],
  query: string,
  limit = NAVIGATION_RESULT_LIMIT,
): NavigationCommand[] {
  const normalized = query.trim().toLocaleLowerCase();
  return commands
    .flatMap((command) => {
      const score = fuzzyTextScore(
        `${command.label} ${command.detail} ${command.keywords ?? ""} ${command.id}`,
        normalized,
      );
      return score === null ? [] : [{ command, score }];
    })
    .sort(
      (left, right) =>
        Number(right.command.enabled) - Number(left.command.enabled) ||
        left.score - right.score ||
        left.command.label.localeCompare(right.command.label),
    )
    .slice(0, Math.max(0, limit))
    .map(({ command }) => command);
}

export function loadRecentFiles(
  storage: Pick<Storage, "getItem">,
  storageKey: string,
  repositoryRoot: string,
  available: ProjectFile[],
): ProjectFile[] {
  return loadRecentFilesFromIndex(
    storage,
    storageKey,
    repositoryRoot,
    new ProjectFileSearchIndex(available),
  );
}

export function loadRecentFilesFromIndex(
  storage: Pick<Storage, "getItem">,
  storageKey: string,
  repositoryRoot: string,
  index: ProjectFileSearchIndex,
): ProjectFile[] {
  try {
    const parsed = parseStoredRecentFiles(storage.getItem(storageKey));
    return (parsed.repositories[repositoryRoot] ?? [])
      .flatMap((identity) => {
        const file = index.resolve(identity);
        return file ? [file] : [];
      })
      .slice(0, RECENT_FILE_LIMIT);
  } catch {
    return [];
  }
}

export function touchRecentFile(
  storage: Pick<Storage, "getItem" | "setItem">,
  storageKey: string,
  repositoryRoot: string,
  file: ProjectFile,
): void {
  try {
    const parsed = parseStoredRecentFiles(storage.getItem(storageKey));
    const current = parsed.repositories[repositoryRoot] ?? [];
    const key = projectFileKey(file);
    parsed.repositories[repositoryRoot] = [
      { repositoryId: file.repositoryId, path: file.path },
      ...current.filter((item) => projectFileKey(item) !== key),
    ].slice(0, RECENT_FILE_LIMIT);
    storage.setItem(storageKey, JSON.stringify(parsed));
  } catch {
    // A denied preference write must not prevent a file from opening.
  }
}

function parseStoredRecentFiles(raw: string | null): StoredRecentFiles {
  if (!raw) return { version: 1, repositories: {} };
  const parsed = JSON.parse(raw) as Partial<StoredRecentFiles> | null;
  if (parsed?.version !== 1 || !isRecord(parsed.repositories)) {
    return { version: 1, repositories: {} };
  }
  const repositories: Record<string, StoredFileIdentity[]> = {};
  for (const [root, value] of Object.entries(parsed.repositories)) {
    if (!Array.isArray(value)) continue;
    repositories[root] = value
      .filter(isStoredIdentity)
      .filter(
        (item, index, all) =>
          all.findIndex((candidate) => projectFileKey(candidate) === projectFileKey(item)) ===
          index,
      )
      .slice(0, RECENT_FILE_LIMIT);
  }
  return { version: 1, repositories };
}

function isStoredIdentity(value: unknown): value is StoredFileIdentity {
  if (!isRecord(value)) return false;
  return (
    typeof value.repositoryId === "string" &&
    value.repositoryId.length > 0 &&
    typeof value.path === "string" &&
    value.path.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fuzzyIndexedPathScore(entry: IndexedProjectFile, query: string): number | null {
  const basenameLength = entry.normalizedPath.length - entry.basenameStart;
  if (
    basenameLength === query.length &&
    entry.normalizedPath.startsWith(query, entry.basenameStart)
  ) return 0;
  if (entry.normalizedPath.startsWith(query, entry.basenameStart)) {
    return 10 + basenameLength - query.length;
  }
  const basenameIndex = entry.normalizedPath.indexOf(query, entry.basenameStart);
  if (basenameIndex >= 0) return 30 + basenameIndex - entry.basenameStart;
  if (entry.normalizedPath.startsWith(query)) {
    return 50 + entry.normalizedPath.lastIndexOf("/");
  }
  const pathIndex = entry.normalizedPath.indexOf(query);
  if (pathIndex >= 0) return 70 + pathIndex;
  const subsequence = subsequenceScore(entry.normalizedPath, query);
  return subsequence === null ? null : 120 + subsequence;
}

function retainBestProjectFile(
  heap: RankedProjectFile[],
  candidate: RankedProjectFile,
  limit: number,
): void {
  if (heap.length < limit) {
    heap.push(candidate);
    siftWorstProjectFileUp(heap, heap.length - 1);
    return;
  }
  if (compareRankedProjectFiles(candidate, heap[0]!) >= 0) return;
  heap[0] = candidate;
  siftWorstProjectFileDown(heap, 0);
}

function siftWorstProjectFileUp(heap: RankedProjectFile[], index: number): void {
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareRankedProjectFiles(heap[parent]!, heap[index]!) >= 0) return;
    [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
    index = parent;
  }
}

function siftWorstProjectFileDown(heap: RankedProjectFile[], index: number): void {
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) return;
    const right = left + 1;
    const worst = right < heap.length &&
        compareRankedProjectFiles(heap[right]!, heap[left]!) > 0
      ? right
      : left;
    if (compareRankedProjectFiles(heap[index]!, heap[worst]!) >= 0) return;
    [heap[index], heap[worst]] = [heap[worst]!, heap[index]!];
    index = worst;
  }
}

function compareRankedProjectFiles(
  left: RankedProjectFile,
  right: RankedProjectFile,
): number {
  return left.score - right.score ||
    left.entry.file.workspacePath.localeCompare(right.entry.file.workspacePath) ||
    left.entry.key.localeCompare(right.entry.key);
}

function fuzzyTextScore(value: string, query: string): number | null {
  if (query.length === 0) return 0;
  const normalized = value.toLocaleLowerCase();
  if (normalized.startsWith(query)) return 0;
  const index = normalized.indexOf(query);
  if (index >= 0) return 20 + index;
  const subsequence = subsequenceScore(normalized, query);
  return subsequence === null ? null : 80 + subsequence;
}

function subsequenceScore(value: string, query: string): number | null {
  let cursor = 0;
  let first = -1;
  let previous = -1;
  let gaps = 0;
  for (const character of query) {
    const index = value.indexOf(character, cursor);
    if (index < 0) return null;
    if (first < 0) first = index;
    if (previous >= 0) gaps += index - previous - 1;
    previous = index;
    cursor = index + character.length;
  }
  return first + gaps + Math.max(0, value.length - query.length) / 100;
}
