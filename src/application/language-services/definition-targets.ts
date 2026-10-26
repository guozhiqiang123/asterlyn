import type { EditorLanguageServiceLocation, EditorLanguageServicePosition } from "../../protocol/editor-language-service.ts";
export const MAX_DEFINITION_TARGETS = 16;
/** File identity comparison for catalog lookup; only the catalog file is ever opened. */
export function definitionFileKey(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16384 || /[\u0000-\u001f\u007f]/u.test(value) || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "file:" || url.search || url.hash || (url.host && url.host !== "localhost")) return null;
    const path = decodeURIComponent(url.pathname);
    if (path.includes("\u0000") || path.includes("\\")) return null;
    return path.replace(/^\/([a-z]):/u, (_, drive: string) => `/${drive.toUpperCase()}:`);
  } catch { return null; }
}
function point(value: unknown): EditorLanguageServicePosition | null {
  const p = value as Partial<EditorLanguageServicePosition> | null;
  return p && Number.isSafeInteger(p.line) && Number.isSafeInteger(p.character) && Number(p.line) >= 0 && Number(p.character) >= 0 && Number(p.line) <= 0xffff_ffff && Number(p.character) <= 0xffff_ffff ? { line: p.line!, character: p.character! } : null;
}
export function normalizeDefinitionTargets(value: unknown, kind: "definition" | "references" = "definition"): { locations: readonly EditorLanguageServiceLocation[]; limited: boolean; invalid: boolean } {
  const maxTargets = kind === "references" ? 512 : MAX_DEFINITION_TARGETS, maxScan = kind === "references" ? 512 : 128;
  const raw = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
  const locations: EditorLanguageServiceLocation[] = [], seen = new Set<string>();
  let invalid = false, limited = raw.length > maxScan;
  for (const item of raw.slice(0, maxScan)) {
    if (!item || typeof item !== "object") { invalid = true; continue; }
    const uri = "targetUri" in item ? item.targetUri : item.uri;
    const range = "targetUri" in item ? item.targetSelectionRange ?? item.targetRange : item.range;
    const start = point(range?.start), end = point(range?.end), file = definitionFileKey(uri);
    if (!file || !start || !end || end.line < start.line || (end.line === start.line && end.character < start.character)) { invalid = true; continue; }
    const key = JSON.stringify([file, start.line, start.character, end.line, end.character]);
    if (seen.has(key)) continue; seen.add(key);
    if (locations.length === maxTargets) { limited = true; continue; }
    locations.push({ uri: new URL(uri).href, range: { start, end } });
  }
  return { locations, limited, invalid };
}
export function isCurrentSymbolDefinition(location: EditorLanguageServiceLocation, uri: string | undefined, symbol: EditorLanguageServiceLocation["range"] | null): boolean {
  if (!uri || !symbol || definitionFileKey(location.uri) !== definitionFileKey(uri)) return false;
  const { start, end } = location.range;
  return start.line === symbol.start.line && start.character === symbol.start.character
    && end.line === symbol.end.line && end.character === symbol.end.character;
}
/** UTF-16 offsets with normalized line separators; a BOM remains a code unit. */
export function definitionOffsets(content: string, location: EditorLanguageServiceLocation): { from: number; to: number } | null {
  const text = content.replace(/\r\n?/gu, "\n"), lines = text.split("\n");
  const offset = (value: EditorLanguageServicePosition): number | null => {
    const p = point(value); if (!p || p.line >= lines.length) return null;
    const line = lines[p.line]!; if (p.character > line.length) return null;
    const before = line.charCodeAt(p.character - 1), after = line.charCodeAt(p.character);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return null;
    return lines.slice(0, p.line).reduce((sum, item) => sum + item.length + 1, 0) + p.character;
  };
  const from = offset(location.range.start), to = offset(location.range.end);
  return from !== null && to !== null && from <= to ? { from, to } : null;
}
