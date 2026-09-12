import type { RepositoryMutationOutcome } from "../models.ts";

export interface RepositoryOperationSession {
  beginTransition(): number;
  matches(generation: number, root?: string): boolean;
}

export type RepositoryOperationCompletion =
  | { status: "success"; outcome: RepositoryMutationOutcome }
  | { status: "failure"; error: unknown }
  | { status: "stale" };

export interface RepositoryOperationStart {
  readonly generation: number;
  readonly completion: Promise<RepositoryOperationCompletion>;
}

export class RepositoryOperationCoordinator {
  private readonly session: RepositoryOperationSession;

  constructor(session: RepositoryOperationSession) {
    this.session = session;
  }

  start(
    repositoryRoot: string,
    task: () => Promise<RepositoryMutationOutcome>,
  ): RepositoryOperationStart {
    const generation = this.session.beginTransition();
    return {
      generation,
      completion: this.complete(repositoryRoot, generation, task),
    };
  }

  private async complete(
    repositoryRoot: string,
    generation: number,
    task: () => Promise<RepositoryMutationOutcome>,
  ): Promise<RepositoryOperationCompletion> {
    try {
      const outcome = await task();
      return this.session.matches(generation, repositoryRoot)
        ? { status: "success", outcome }
        : { status: "stale" };
    } catch (error) {
      return this.session.matches(generation, repositoryRoot)
        ? { status: "failure", error }
        : { status: "stale" };
    }
  }
}
