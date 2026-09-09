import type { ProjectFile } from "../models";

export const RECENT_FILE_LIMIT = 50;
export const NAVIGATION_RESULT_LIMIT = 100;

export type NavigationMode = "files" | "recent" | "workspace" | "commands";

export interface NavigationCommand {
  id: string;
  label: string;
  detail: string;
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

export function projectFileKey(
  file: Pick<ProjectFile, "repositoryId" | "path">,
): string {
  return `${file.repositoryId}\0${file.path}`;
}

export function rankProjectFiles(
  files: ProjectFile[],
  query: string,
  recent: ProjectFile[] = [],
  limit = NAVIGATION_RESULT_LIMIT,
): ProjectFile[] {
  const recentOrder = new Map(
    recent.map((file, index) => [projectFileKey(file), index]),
  );
  const normalized = query.trim().toLocaleLowerCase();
  return uniqueProjectFiles(files)
    .flatMap((file) => {
      const score = fuzzyPathScore(file.workspacePath, normalized);
      return score === null ? [] : [{ file, score }];
    })
    .sort((left, right) => {
      if (normalized.length === 0) {
        const leftRecent = recentOrder.get(projectFileKey(left.file));
        const rightRecent = recentOrder.get(projectFileKey(right.file));
        if (leftRecent !== undefined || rightRecent !== undefined) {
          return (leftRecent ?? Number.MAX_SAFE_INTEGER) -
            (rightRecent ?? Number.MAX_SAFE_INTEGER);
        }
      }
      return (
        left.score - right.score ||
        left.file.workspacePath.localeCompare(right.file.workspacePath) ||
        projectFileKey(left.file).localeCompare(projectFileKey(right.file))
      );
    })
    .slice(0, Math.max(0, limit))
    .map(({ file }) => file);
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
        `${command.label} ${command.detail} ${command.id}`,
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
  try {
    const parsed = parseStoredRecentFiles(storage.getItem(storageKey));
    const availableByKey = new Map(
      uniqueProjectFiles(available).map((file) => [projectFileKey(file), file]),
    );
    return (parsed.repositories[repositoryRoot] ?? [])
      .flatMap((identity) => {
        const file = availableByKey.get(projectFileKey(identity));
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

function uniqueProjectFiles(files: ProjectFile[]): ProjectFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = projectFileKey(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fuzzyPathScore(path: string, query: string): number | null {
  if (query.length === 0) return 0;
  const normalizedPath = path.toLocaleLowerCase();
  const slash = normalizedPath.lastIndexOf("/");
  const basename = normalizedPath.slice(slash + 1);
  if (basename === query) return 0;
  if (basename.startsWith(query)) return 10 + basename.length - query.length;
  const basenameIndex = basename.indexOf(query);
  if (basenameIndex >= 0) return 30 + basenameIndex;
  if (normalizedPath.startsWith(query)) return 50 + slash;
  const pathIndex = normalizedPath.indexOf(query);
  if (pathIndex >= 0) return 70 + pathIndex;
  const subsequence = subsequenceScore(normalizedPath, query);
  return subsequence === null ? null : 120 + subsequence;
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
