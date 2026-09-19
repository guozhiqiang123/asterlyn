import type { EditorRuntimeTabRemap } from "../../editor-path-mutation.ts";

interface KeyedEditorEntry {
  id: string;
  path: string;
}

export type EditorCacheRemapResult =
  | { status: "applied"; activeId: string | null }
  | { status: "conflict" };

export function remapEditorCacheEntries<Entry extends KeyedEditorEntry>(
  entries: Map<string, Entry>,
  activeId: string | null,
  remaps: readonly EditorRuntimeTabRemap[],
): EditorCacheRemapResult {
  const relevant = remaps.filter((remap) => entries.has(remap.sourceId));
  const sourceIds = new Set(relevant.map((remap) => remap.sourceId));
  if (relevant.some((remap) =>
    remap.sourceId !== remap.destinationId &&
    entries.has(remap.destinationId) &&
    !sourceIds.has(remap.destinationId)
  )) return { status: "conflict" };
  const moved = relevant.map((remap) => ({
    remap,
    entry: entries.get(remap.sourceId)!,
  }));
  for (const { remap } of moved) entries.delete(remap.sourceId);
  for (const { remap, entry } of moved) {
    entry.id = remap.destinationId;
    entry.path = remap.destinationPath;
    entries.set(remap.destinationId, entry);
  }
  const active = remaps.find((remap) => remap.sourceId === activeId);
  return {
    status: "applied",
    activeId: active?.destinationId ?? activeId,
  };
}
