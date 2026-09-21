import type {
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchReport,
} from "../../models.ts";
import type {
  WorkspaceOperationCompletion,
  WorkspaceOperationIdentity,
  WorkspaceOperationStart,
} from "../../application/workspace-operation-coordinator.ts";
import {
  beginWorkspaceSearch,
  completeWorkspaceSearch,
  createWorkspaceSearchControls,
  createWorkspaceSearchState,
  failWorkspaceSearch,
  invalidateWorkspaceSearch,
  sameWorkspaceSearchOptions,
  workspaceSearchOptions,
  type WorkspaceSearchControls,
  type WorkspaceSearchRequest,
  type WorkspaceSearchState,
} from "./workspace-search.ts";

export interface WorkspaceSearchOperations {
  startSearch(
    identity: WorkspaceOperationIdentity,
    query: string,
    options: WorkspaceTextSearchOptions,
  ): WorkspaceOperationStart<WorkspaceTextSearchReport>;
  cancelSearch(): void;
}

export interface WorkspaceSearchControllerState {
  readonly search: WorkspaceSearchState;
  readonly controls: WorkspaceSearchControls;
}

export class WorkspaceSearchController {
  private readonly operations: WorkspaceSearchOperations;
  private value: WorkspaceSearchControllerState = {
    search: createWorkspaceSearchState(),
    controls: createWorkspaceSearchControls(),
  };

  constructor(operations: WorkspaceSearchOperations) {
    this.operations = operations;
  }

  get state(): WorkspaceSearchControllerState {
    return this.value;
  }

  updateControls(controls: WorkspaceSearchControls): void {
    this.operations.cancelSearch();
    this.value = {
      controls: { ...this.value.controls, ...controls },
      search: invalidateWorkspaceSearch(this.value.search),
    };
  }

  invalidate(): void {
    this.operations.cancelSearch();
    this.value = {
      ...this.value,
      search: invalidateWorkspaceSearch(this.value.search),
    };
  }

  requestIsCurrent(query: string): boolean {
    const request = this.value.search.request;
    return Boolean(
      request &&
      request.query === query &&
      sameWorkspaceSearchOptions(
        request.options,
        workspaceSearchOptions(this.value.controls),
      ),
    );
  }

  hasCurrentResults(query: string): boolean {
    return this.value.search.status === "ready" &&
      this.value.search.report !== null &&
      this.requestIsCurrent(query);
  }

  async run(
    identity: WorkspaceOperationIdentity,
    query: string,
    describeError: (error: unknown) => string,
  ): Promise<boolean> {
    if (query.trim().length === 0) return false;
    const options = workspaceSearchOptions(this.value.controls);
    const operation = this.operations.startSearch(identity, query, options);
    const started = beginWorkspaceSearch(
      this.value.search,
      identity.generation,
      identity.root,
      operation.operationId,
      query,
      options,
    );
    this.value = { ...this.value, search: started.state };
    const completion = await operation.completion;
    return this.acceptCompletion(started.request, completion, describeError);
  }

  dispose(): void {
    this.operations.cancelSearch();
  }

  private acceptCompletion(
    request: WorkspaceSearchRequest,
    completion: WorkspaceOperationCompletion<WorkspaceTextSearchReport>,
    describeError: (error: unknown) => string,
  ): boolean {
    if (completion.status === "stale") return false;
    const previous = this.value.search;
    const search = completion.status === "success"
      ? completeWorkspaceSearch(previous, request, completion.value)
      : failWorkspaceSearch(previous, request, describeError(completion.error));
    if (search === previous) return false;
    this.value = { ...this.value, search };
    return true;
  }
}
