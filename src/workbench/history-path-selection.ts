import type { HistoryPath, ProjectFile } from "../models";
import { historyPathKey } from "./history-identity.ts";

export interface HistoryPathCandidate extends HistoryPath {
  workspacePath: string;
  directory: boolean;
}

export interface HistoryPathResolution {
  paths: HistoryPath[];
  error: string | null;
}

export function historyPathCandidates(files: ProjectFile[]): HistoryPathCandidate[] {
  const candidates = new Map<string, HistoryPathCandidate>();
  for (const file of files) {
    const prefix = file.workspacePath.slice(0, file.workspacePath.length - file.path.length);
    const segments = file.path.split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      const path = segments.slice(0, index).join("/");
      const candidate: HistoryPathCandidate = {
        repositoryId: file.repositoryId,
        path,
        workspacePath: `${prefix}${path}`,
        directory: true,
      };
      candidates.set(historyPathKey(candidate), candidate);
    }
    candidates.set(historyPathKey(file), {
      repositoryId: file.repositoryId,
      path: file.path,
      workspacePath: file.workspacePath,
      directory: false,
    });
  }
  return Array.from(candidates.values()).sort((left, right) =>
    left.workspacePath.localeCompare(right.workspacePath),
  );
}

export function resolveHistoryPathText(
  text: string,
  candidates: HistoryPathCandidate[],
): HistoryPathResolution {
  const lines = Array.from(
    new Set(text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)),
  );
  const byWorkspacePath = new Map<string, HistoryPathCandidate[]>();
  for (const candidate of candidates) {
    const values = byWorkspacePath.get(candidate.workspacePath) ?? [];
    values.push(candidate);
    byWorkspacePath.set(candidate.workspacePath, values);
  }
  const paths: HistoryPath[] = [];
  for (const line of lines) {
    const matches = byWorkspacePath.get(line) ?? [];
    if (matches.length === 0) {
      return { paths: [], error: `Unknown tracked path: ${line}` };
    }
    if (matches.length > 1) {
      return { paths: [], error: `Path belongs to more than one Git root: ${line}` };
    }
    const match = matches[0]!;
    paths.push({ repositoryId: match.repositoryId, path: match.path });
  }
  return { paths, error: null };
}

export function historyPathWorkspaceLabel(
  path: HistoryPath,
  files: ProjectFile[],
): string {
  const exact = files.find(
    (file) => file.repositoryId === path.repositoryId && file.path === path.path,
  );
  if (exact) return exact.workspacePath;
  const descendant = files.find(
    (file) =>
      file.repositoryId === path.repositoryId && file.path.startsWith(`${path.path}/`),
  );
  if (!descendant) return path.path;
  const prefix = descendant.workspacePath.slice(
    0,
    descendant.workspacePath.length - descendant.path.length,
  );
  return `${prefix}${path.path}`;
}
