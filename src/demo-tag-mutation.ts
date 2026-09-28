import type { RepositorySnapshot, TagMutationRequest } from "./models.ts";

export function demoExecuteTagMutation(
  snapshot: RepositorySnapshot,
  request: TagMutationRequest,
): RepositorySnapshot {
  const name = request.tagName.trim();
  if (
    name !== request.tagName ||
    !/^(?![-.])(?!.*\.\.)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(name)
  ) throw new Error("Enter a valid literal Git tag name.");
  const commit = snapshot.commits.find((candidate) =>
    candidate.repositoryId === "." && candidate.oid === request.commitOid
  );
  if (!commit) throw new Error("The selected commit is unavailable.");
  const fullName = `refs/tags/${name}`;
  const existing = snapshot.branches.find((candidate) =>
    candidate.repositoryId === "." && candidate.kind === "tag" && candidate.fullName === fullName
  );
  if (request.kind === "deleteRemote") {
    if (!existing) throw new Error("The selected local tag no longer exists.");
    const remote = snapshot.remotes.find((candidate) => candidate.name === request.remote);
    if (!remote?.pushSupported) throw new Error("Select a configured push-capable remote.");
    return structuredClone(snapshot);
  }
  const next = structuredClone(snapshot);
  const nextCommit = next.commits.find((candidate) => candidate.oid === request.commitOid)!;
  if (request.kind === "create") {
    if (existing) throw new Error(`Tag '${name}' already exists.`);
    next.branches.push({
      repositoryId: ".", fullName, name, oid: request.commitOid, current: false, kind: "tag",
      upstream: null, tracking: null, committedAt: commit.authoredAt, subject: commit.subject,
    });
    nextCommit.decorations.push(`tag: ${name}`);
    return next;
  }
  if (!existing || existing.oid !== request.commitOid) {
    throw new Error("The selected local tag changed; open its menu again.");
  }
  next.branches = next.branches.filter((candidate) => candidate.fullName !== fullName);
  nextCommit.decorations = nextCommit.decorations.filter((value) => value !== `tag: ${name}`);
  return next;
}
