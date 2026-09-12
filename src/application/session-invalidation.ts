import type { RepositoryStateSlice } from "../models.ts";

export const SESSION_INVALIDATION_SLICES = [
  "workspaceCatalog",
  "openDocuments",
  "workingTree",
  "head",
  "refs",
  "history",
  "operation",
] as const satisfies readonly RepositoryStateSlice[];

export type SessionInvalidationSlice = RepositoryStateSlice;

export type SessionInvalidationCause =
  | "activation"
  | "manualRefresh"
  | "save"
  | "workspaceReplacement"
  | "gitMutation"
  | "remoteOperation"
  | "watcher"
  | "focusRecovery"
  | "overflowRecovery";

export interface SessionInvalidation {
  readonly root: string;
  readonly generation: number;
  readonly slices: readonly SessionInvalidationSlice[];
  readonly paths: readonly string[];
  readonly causes: readonly SessionInvalidationCause[];
  readonly overflowed: boolean;
}

const sliceOrder = new Map(
  SESSION_INVALIDATION_SLICES.map((slice, index) => [slice, index]),
);

export function createSessionInvalidation(
  root: string,
  generation: number,
  slices: Iterable<SessionInvalidationSlice>,
  cause: SessionInvalidationCause,
  options: { paths?: Iterable<string>; overflowed?: boolean } = {},
): SessionInvalidation {
  return {
    root,
    generation,
    slices: orderedUnique(slices, (value) => sliceOrder.get(value) ?? Number.MAX_SAFE_INTEGER),
    paths: orderedUnique(options.paths ?? [], (_, value) => value).filter(validWorkspacePath),
    causes: [cause],
    overflowed: options.overflowed ?? false,
  };
}

export function mergeSessionInvalidations(
  current: SessionInvalidation | null,
  incoming: SessionInvalidation,
): SessionInvalidation {
  if (
    !current ||
    current.root !== incoming.root ||
    current.generation !== incoming.generation
  ) {
    return incoming;
  }
  return {
    root: current.root,
    generation: current.generation,
    slices: orderedUnique(
      [...current.slices, ...incoming.slices],
      (value) => sliceOrder.get(value) ?? Number.MAX_SAFE_INTEGER,
    ),
    paths: orderedUnique([...current.paths, ...incoming.paths], (_, value) => value),
    causes: orderedUnique([...current.causes, ...incoming.causes], (_, value) => value),
    overflowed: current.overflowed || incoming.overflowed,
  };
}

export function invalidates(
  invalidation: SessionInvalidation,
  slice: SessionInvalidationSlice,
): boolean {
  return invalidation.slices.includes(slice);
}

function orderedUnique<T>(
  values: Iterable<T>,
  order: (value: T, stableValue: string) => number | string,
): T[] {
  const unique = Array.from(new Set(values));
  return unique.sort((left, right) => {
    const leftValue = order(left, String(left));
    const rightValue = order(right, String(right));
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return leftValue - rightValue;
    }
    return String(leftValue).localeCompare(String(rightValue));
  });
}

function validWorkspacePath(path: string): boolean {
  return Boolean(path) && path !== "." && !path.startsWith("/") && !path.includes("\0");
}
