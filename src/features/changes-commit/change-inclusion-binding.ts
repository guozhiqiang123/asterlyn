import { fileChangeKey } from "../../change-identity.ts";
import type { RepositorySnapshot } from "../../models.ts";
import { changeGroup, type ChangeGroupId } from "./change-presentation.ts";

interface InclusionBindingPort {
  snapshot(): RepositorySnapshot | null;
  setIncluded(keys: string[], included: boolean): void;
}

export function bindChangeInclusionControls(
  scope: ParentNode,
  port: InclusionBindingPort,
): void {
  bind(scope, "[data-include-path]", (checkbox) => {
    const key = checkbox.dataset.includePath;
    return key ? [key] : [];
  }, port);
  bind(scope, "[data-include-repository]", (checkbox, snapshot) => {
    const repositoryId = checkbox.dataset.includeRepository;
    return repositoryId
      ? snapshot.changes
          .filter((change) => (change.repositoryId || ".") === repositoryId)
          .map(fileChangeKey)
      : [];
  }, port);
  bind(scope, "[data-include-group]", (checkbox, snapshot) => {
    const group = checkbox.dataset.includeGroup as ChangeGroupId | undefined;
    const repositoryId = checkbox.dataset.includeGroupRepository;
    return group && repositoryId
      ? snapshot.changes
          .filter((change) =>
            (change.repositoryId || ".") === repositoryId && changeGroup(change) === group
          )
          .map(fileChangeKey)
      : [];
  }, port);
  bind(scope, "[data-include-directory]", (checkbox, snapshot) => {
    const path = checkbox.dataset.includeDirectory;
    const group = checkbox.dataset.includeDirectoryGroup as ChangeGroupId | undefined;
    const repositoryId = checkbox.dataset.includeDirectoryRepository;
    return path && group && repositoryId
      ? snapshot.changes
          .filter((change) =>
            (change.repositoryId || ".") === repositoryId &&
            changeGroup(change) === group &&
            (change.path === path || change.path.startsWith(`${path}/`))
          )
          .map(fileChangeKey)
      : [];
  }, port);
}

export function syncChangeInclusionControls(
  scope: ParentNode,
  snapshot: RepositorySnapshot,
  excluded: ReadonlySet<string>,
): void {
  scope.querySelectorAll<HTMLInputElement>("[data-include-path]").forEach((checkbox) => {
    checkbox.checked = !excluded.has(checkbox.dataset.includePath!);
    checkbox.indeterminate = false;
    checkbox.closest(".change-row")?.classList.toggle("excluded", !checkbox.checked);
  });
  for (const selector of [
    "[data-include-repository]",
    "[data-include-group]",
    "[data-include-directory]",
  ]) {
    scope.querySelectorAll<HTMLInputElement>(selector).forEach((checkbox) => {
      const keys = aggregateKeys(checkbox, snapshot);
      const included = keys.filter((key) => !excluded.has(key)).length;
      checkbox.checked = keys.length > 0 && included === keys.length;
      checkbox.indeterminate = included > 0 && included < keys.length;
    });
  }
}

function bind(
  scope: ParentNode,
  selector: string,
  keys: (checkbox: HTMLInputElement, snapshot: RepositorySnapshot) => string[],
  port: InclusionBindingPort,
): void {
  scope.querySelectorAll<HTMLInputElement>(selector).forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      const snapshot = port.snapshot();
      if (!snapshot) return;
      const selected = keys(checkbox, snapshot);
      if (selected.length > 0) port.setIncluded(selected, checkbox.checked);
    });
  });
}

function aggregateKeys(
  checkbox: HTMLInputElement,
  snapshot: RepositorySnapshot,
): string[] {
  const path = checkbox.dataset.includeDirectory;
  const group = (checkbox.dataset.includeDirectoryGroup ?? checkbox.dataset.includeGroup) as
    ChangeGroupId | undefined;
  const repositoryId = checkbox.dataset.includeRepository ??
    checkbox.dataset.includeGroupRepository ?? checkbox.dataset.includeDirectoryRepository;
  return snapshot.changes.filter((change) =>
    (!repositoryId || (change.repositoryId || ".") === repositoryId) &&
    (!group || changeGroup(change) === group) &&
    (!path || change.path === path || change.path.startsWith(`${path}/`))
  ).map(fileChangeKey);
}
