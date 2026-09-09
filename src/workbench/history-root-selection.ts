export function effectiveHistoryRootIds(
  availableRepositoryIds: readonly string[],
  selectedRepositoryIds: ReadonlySet<string>,
): Set<string> {
  const available = new Set(availableRepositoryIds);
  if (selectedRepositoryIds.size === 0) return available;
  const selected = new Set(
    Array.from(selectedRepositoryIds).filter((repositoryId) => available.has(repositoryId)),
  );
  return selected.size > 0 ? selected : available;
}

export function toggleHistoryRootSelection(
  availableRepositoryIds: readonly string[],
  selectedRepositoryIds: ReadonlySet<string>,
  repositoryId: string,
  checked: boolean,
): Set<string> {
  const available = Array.from(new Set(availableRepositoryIds));
  if (!available.includes(repositoryId)) return new Set(selectedRepositoryIds);

  const selected = effectiveHistoryRootIds(available, selectedRepositoryIds);
  if (checked) {
    selected.add(repositoryId);
  } else if (selected.size > 1) {
    selected.delete(repositoryId);
  }

  return selected.size === available.length ? new Set() : selected;
}
