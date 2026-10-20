import type { CommitDetails, CommitFileChange, PushPreview } from "../../models.ts";
import { isImagePreviewPath } from "../../presentation/image-preview.ts";
import type { RemotePushGateway } from "./remote-push-contract.ts";
import type { PushDiffState } from "./remote-push-state.ts";

export function initialPushDiffState(
  preview: PushPreview,
  selectedCommitOid: string | null,
  file: CommitFileChange,
): PushDiffState {
  const parentOid = selectedCommitOid ? null : preview.comparisonBaseOid;
  const comparison = parentOid !== null;
  return {
    repositoryId: comparison ? "." : null,
    oid: comparison ? preview.headOid : null,
    parentOid,
    comparison,
    file,
    patch: null,
    image: null,
    loading: true,
    error: null,
    expandedUnchanged: false,
  };
}

export function commitPushDiffState(
  details: CommitDetails,
  file: CommitFileChange,
): PushDiffState {
  return {
    repositoryId: details.repositoryId,
    oid: details.oid,
    parentOid: details.parentOid,
    comparison: false,
    file,
    patch: null,
    image: null,
    loading: true,
    error: null,
    expandedUnchanged: false,
  };
}

export async function readPushDiffContent(
  gateway: RemotePushGateway,
  repositoryRoot: string,
  current: PushDiffState,
): Promise<Pick<PushDiffState, "patch" | "image">> {
  const { repositoryId, oid, file, expandedUnchanged } = current;
  if (!repositoryId || !oid) {
    throw new Error("Push Diff is missing its reviewed commit identity");
  }
  const image = isImagePreviewPath(file.path);
  if (current.comparison) {
    const beforeOid = current.parentOid;
    if (!beforeOid) {
      throw new Error("Push comparison is missing its reviewed destination identity");
    }
    if (image) {
      return {
        patch: null,
        image: await gateway.readCommitComparisonImageDiff(
          repositoryRoot,
          repositoryId,
          beforeOid,
          oid,
          file.path,
          file.originalPath,
        ),
      };
    }
    return {
      patch: await gateway.readCommitComparisonDiff(
        repositoryRoot,
        repositoryId,
        beforeOid,
        oid,
        file.path,
        file.originalPath,
        expandedUnchanged,
      ),
      image: null,
    };
  }
  if (image) {
    return {
      patch: null,
      image: await gateway.readCommitImageDiff(
        repositoryRoot,
        repositoryId,
        oid,
        file.path,
        file.originalPath,
      ),
    };
  }
  return {
    patch: await gateway.readCommitDiff(
      repositoryRoot,
      repositoryId,
      oid,
      file.path,
      file.originalPath,
      expandedUnchanged,
    ),
    image: null,
  };
}
