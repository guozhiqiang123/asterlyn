import type { OpenedProject } from "../models.ts";

export interface WorkspaceSessionIdentity {
  readonly root: string;
  readonly generation: number;
}

export interface WorkspaceSessionState {
  readonly root: string | null;
  readonly generation: number;
  readonly gitAvailable: boolean;
}

export interface WorkspaceActivation {
  readonly identity: WorkspaceSessionIdentity;
  readonly rootChanged: boolean;
  readonly gitChanged: boolean;
}

export class WorkspaceSession {
  private value: WorkspaceSessionState = {
    root: null,
    generation: 0,
    gitAvailable: false,
  };

  get state(): WorkspaceSessionState {
    return this.value;
  }

  activate(project: OpenedProject): WorkspaceActivation {
    const rootChanged = this.value.root !== project.root;
    const gitAvailable = project.repository !== null;
    const gitChanged = this.value.gitAvailable !== gitAvailable;
    const generation = rootChanged ? this.value.generation + 1 : this.value.generation;
    this.value = { root: project.root, generation, gitAvailable };
    return {
      identity: { root: project.root, generation },
      rootChanged,
      gitChanged,
    };
  }

  identity(): WorkspaceSessionIdentity | null {
    return this.value.root
      ? { root: this.value.root, generation: this.value.generation }
      : null;
  }

  matches(identity: WorkspaceSessionIdentity): boolean {
    return this.value.root === identity.root && this.value.generation === identity.generation;
  }

  clear(): void {
    this.value = {
      root: null,
      generation: this.value.generation + 1,
      gitAvailable: false,
    };
  }
}
