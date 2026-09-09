import type { BranchSummary, CommitFileChange, CommitSummary } from "../models";
import { commitKey, parentCommitKey } from "./history-identity.ts";

export type CommitFileView = "tree" | "flat";
export type CommitReferenceKind = "head" | "local" | "remote" | "tag" | "other";

export interface CommitReference {
  kind: CommitReferenceKind;
  label: string;
}

export interface CommitFileTreeNode {
  kind: "directory" | "file";
  name: string;
  path: string;
  children: CommitFileTreeNode[];
  file: CommitFileChange | null;
}

export interface RemoteBranchGroup {
  name: string;
  branches: Array<{ branch: BranchSummary; displayName: string }>;
}

export type CommitGraphSegmentKind = "incoming" | "parent" | "through";

export interface CommitGraphSegment {
  kind: CommitGraphSegmentKind;
  fromLane: number;
  toLane: number;
  color: number;
}

export interface CommitGraphRow {
  oid: string;
  nodeLane: number;
  nodeColor: number;
  laneCount: number;
  parentCount: number;
  startsLane: boolean;
  segments: CommitGraphSegment[];
}

export interface CommitGraphProjection {
  laneCount: number;
  rows: CommitGraphRow[];
}

interface ActiveGraphLane {
  key: string;
  color: number;
}

const GRAPH_COLOR_COUNT = 8;

export function projectCommitGraph(
  commits: Pick<CommitSummary, "repositoryId" | "oid" | "parents">[],
): CommitGraphProjection {
  let lanes: ActiveGraphLane[] = [];
  let nextColor = 0;
  let laneCount = 1;
  const rows: CommitGraphRow[] = [];

  const allocateColor = (active: ActiveGraphLane[]): number => {
    const used = new Set(active.map((lane) => lane.color));
    for (let offset = 0; offset < GRAPH_COLOR_COUNT; offset += 1) {
      const candidate = (nextColor + offset) % GRAPH_COLOR_COUNT;
      if (used.has(candidate)) continue;
      nextColor = (candidate + 1) % GRAPH_COLOR_COUNT;
      return candidate;
    }
    const candidate = nextColor;
    nextColor = (nextColor + 1) % GRAPH_COLOR_COUNT;
    return candidate;
  };

  for (const commit of commits) {
    const key = commitKey(commit);
    const before = [...lanes];
    let nodeLane = before.findIndex((lane) => lane.key === key);
    const startsLane = nodeLane < 0;
    if (startsLane) {
      nodeLane = before.length;
      before.push({ key, color: allocateColor(before) });
    }
    const nodeColor = before[nodeLane]!.color;
    const parents = commit.parents.map((parent) => parentCommitKey(commit.repositoryId, parent)).filter(
      (parent, index, values) => parent.length > 0 && values.indexOf(parent) === index,
    );
    const after = before.filter((_, index) => index !== nodeLane);

    for (const [parentIndex, parent] of parents.entries()) {
      if (after.some((lane) => lane.key === parent)) continue;
      const previousParent = parentIndex > 0 ? parents[parentIndex - 1] : null;
      const previousLane = previousParent
        ? after.findIndex((lane) => lane.key === previousParent)
        : -1;
      const insertAt =
        parentIndex === 0
          ? Math.min(nodeLane, after.length)
          : Math.min(previousLane >= 0 ? previousLane + 1 : nodeLane + parentIndex, after.length);
      after.splice(insertAt, 0, {
        key: parent,
        color: parentIndex === 0 ? nodeColor : allocateColor(after),
      });
    }

    const segments: CommitGraphSegment[] = [];
    if (!startsLane) {
      segments.push({
        kind: "incoming",
        fromLane: nodeLane,
        toLane: nodeLane,
        color: nodeColor,
      });
    }
    for (const [fromLane, lane] of before.entries()) {
      if (fromLane === nodeLane) continue;
      const toLane = after.findIndex((candidate) => candidate.key === lane.key);
      if (toLane < 0) continue;
      segments.push({
        kind: "through",
        fromLane,
        toLane,
        color: lane.color,
      });
    }
    for (const [parentIndex, parent] of parents.entries()) {
      const toLane = after.findIndex((lane) => lane.key === parent);
      if (toLane < 0) continue;
      segments.push({
        kind: "parent",
        fromLane: nodeLane,
        toLane,
        color: parentIndex === 0 ? nodeColor : after[toLane]!.color,
      });
    }

    const rowLaneCount = Math.max(before.length, after.length, 1);
    laneCount = Math.max(laneCount, rowLaneCount);
    rows.push({
      oid: commit.oid,
      nodeLane,
      nodeColor,
      laneCount: rowLaneCount,
      parentCount: parents.length,
      startsLane,
      segments,
    });
    lanes = after;
  }

  return { laneCount, rows };
}

export function commitReferences(
  decorations: string[],
  branches: Pick<BranchSummary, "kind" | "name">[] = [],
): CommitReference[] {
  const references: CommitReference[] = [];
  for (const decoration of decorations) {
    const value = decoration.trim();
    if (!value) continue;
    if (value.startsWith("HEAD -> ")) {
      references.push({ kind: "head", label: "HEAD" });
      references.push({ kind: "local", label: value.slice("HEAD -> ".length) });
      continue;
    }
    if (value === "HEAD") {
      references.push({ kind: "head", label: value });
      continue;
    }
    if (value.startsWith("tag: ")) {
      references.push({ kind: "tag", label: value.slice("tag: ".length) });
      continue;
    }
    const symbolic = value.split(" -> ");
    for (const label of symbolic) {
      references.push({ kind: decorationKind(label, branches), label });
    }
  }
  return references.filter(
    (reference, index) =>
      references.findIndex(
        (candidate) =>
          candidate.kind === reference.kind && candidate.label === reference.label,
      ) === index,
  );
}

function decorationKind(
  label: string,
  branches: Pick<BranchSummary, "kind" | "name">[],
): CommitReferenceKind {
  return branches.find((branch) => branch.name === label)?.kind ?? "other";
}

export function buildCommitFileTree(files: CommitFileChange[]): CommitFileTreeNode[] {
  const root: CommitFileTreeNode[] = [];
  const directories = new Map<string, CommitFileTreeNode>();
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let children = root;
    let parentPath = "";
    for (const [index, name] of segments.entries()) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      if (index === segments.length - 1) {
        children.push({ kind: "file", name, path: file.path, children: [], file });
      } else {
        let directory = directories.get(path);
        if (!directory) {
          directory = {
            kind: "directory",
            name,
            path,
            children: [],
            file: null,
          };
          directories.set(path, directory);
          children.push(directory);
        }
        children = directory.children;
      }
      parentPath = path;
    }
  }
  sortCommitTree(root);
  return root;
}

export function groupRemoteBranches(branches: BranchSummary[]): RemoteBranchGroup[] {
  const groups = new Map<string, RemoteBranchGroup>();
  for (const branch of branches.filter((candidate) => candidate.kind === "remote")) {
    const separator = branch.name.indexOf("/");
    const remote = separator < 0 ? branch.name : branch.name.slice(0, separator);
    const displayName = separator < 0 ? branch.name : branch.name.slice(separator + 1);
    const group = groups.get(remote) ?? { name: remote, branches: [] };
    group.branches.push({ branch, displayName });
    groups.set(remote, group);
  }
  return Array.from(groups.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((group) => ({
      ...group,
      branches: group.branches.sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    }));
}

function sortCommitTree(nodes: CommitFileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortCommitTree(node.children);
}
