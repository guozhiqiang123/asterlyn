import type { NavigationCommand, ProjectFileMatchOptions } from "./navigation.ts";

/** UTF-16 offsets into the original, unescaped text shown in a result row. */
export interface NavigationHighlightRange {
  readonly from: number;
  readonly to: number;
}

export interface CommandHighlightRanges {
  readonly label: readonly NavigationHighlightRange[];
  readonly detail: readonly NavigationHighlightRange[];
  readonly keywords: readonly NavigationHighlightRange[];
  readonly id: readonly NavigationHighlightRange[];
}

/** Mirrors Quick Open's first accepted path match without changing its ranking. */
export function filePathHighlightRanges(
  path: string,
  query: string,
  options: ProjectFileMatchOptions,
): readonly NavigationHighlightRange[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (options.regexp) {
    try {
      const found = new RegExp(trimmed, options.caseSensitive ? "u" : "iu").exec(path);
      return found?.[0] ? [{ from: found.index, to: found.index + found[0].length }] : [];
    } catch {
      return [];
    }
  }

  const mapped = mappedText(path, options.caseSensitive);
  const needle = options.caseSensitive ? trimmed : trimmed.toLocaleLowerCase();
  if (options.wholeWord) {
    let index = mapped.value.indexOf(needle);
    while (index >= 0) {
      if (!isWordCharacter(mapped.value[index - 1]) &&
          !isWordCharacter(mapped.value[index + needle.length])) {
        return mappedRanges(mapped, [{ from: index, to: index + needle.length }]);
      }
      index = mapped.value.indexOf(needle, index + 1);
    }
    return [];
  }

  const basenameStart = mapped.value.lastIndexOf("/") + 1;
  const basenameMatch = mapped.value.indexOf(needle, basenameStart);
  if (basenameMatch >= 0) {
    return mappedRanges(mapped, [{ from: basenameMatch, to: basenameMatch + needle.length }]);
  }
  const pathMatch = mapped.value.indexOf(needle);
  if (pathMatch >= 0) {
    return mappedRanges(mapped, [{ from: pathMatch, to: pathMatch + needle.length }]);
  }
  return mappedRanges(mapped, subsequenceRanges(mapped.value, needle));
}

/** Commands rank against label, detail, aliases, and id as one string. */
export function commandHighlightRanges(
  command: NavigationCommand,
  query: string,
): CommandHighlightRanges {
  const fields = [command.label, command.detail, command.keywords ?? "", command.id] as const;
  const starts: number[] = [];
  let combined = "";
  for (const field of fields) {
    if (starts.length) combined += " ";
    starts.push(combined.length);
    combined += field;
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const mapped = mappedText(combined, false);
  if (!normalizedQuery) return { label: [], detail: [], keywords: [], id: [] };
  const index = mapped.value.indexOf(normalizedQuery);
  const ranges = mappedRanges(mapped, index >= 0
    ? [{ from: index, to: index + normalizedQuery.length }]
    : subsequenceRanges(mapped.value, normalizedQuery));
  const [label, detail, keywords, id] = fields.map((field, index) =>
    clipRanges(ranges, starts[index]!, starts[index]! + field.length)
  );
  return { label: label!, detail: detail!, keywords: keywords!, id: id! };
}

function mappedText(value: string, caseSensitive: boolean): { value: string; offsets: readonly NavigationHighlightRange[] | null } {
  if (caseSensitive) return { value, offsets: null };
  const folded = value.toLocaleLowerCase();
  if (folded.length === value.length) return { value: folded, offsets: null };
  const offsets: NavigationHighlightRange[] = [];
  let previous = 0;
  for (let index = 0; index < value.length;) {
    const character = String.fromCodePoint(value.codePointAt(index)!);
    const next = index + character.length;
    const prefixLength = value.slice(0, next).toLocaleLowerCase().length;
    for (let offset = previous; offset < prefixLength; offset++) {
      offsets.push({ from: index, to: next });
    }
    index = next;
    previous = prefixLength;
  }
  return { value: folded, offsets };
}

function mappedRanges(
  mapped: ReturnType<typeof mappedText>,
  ranges: readonly NavigationHighlightRange[],
): readonly NavigationHighlightRange[] {
  if (!mapped.offsets) return ranges;
  return mergeRanges(ranges.map(({ from, to }) => ({
    from: mapped.offsets![from]?.from ?? from,
    to: mapped.offsets![to - 1]?.to ?? to,
  })));
}

function subsequenceRanges(value: string, query: string): readonly NavigationHighlightRange[] {
  const ranges: NavigationHighlightRange[] = [];
  let cursor = 0;
  for (const character of query) {
    const index = value.indexOf(character, cursor);
    if (index < 0) return [];
    ranges.push({ from: index, to: index + character.length });
    cursor = index + character.length;
  }
  return mergeRanges(ranges);
}

function mergeRanges(ranges: readonly NavigationHighlightRange[]): readonly NavigationHighlightRange[] {
  const merged: NavigationHighlightRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.from <= last.to) {
      merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, range.to) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function clipRanges(
  ranges: readonly NavigationHighlightRange[],
  from: number,
  to: number,
): readonly NavigationHighlightRange[] {
  return ranges.flatMap((range) => {
    const start = Math.max(from, range.from);
    const end = Math.min(to, range.to);
    return start < end ? [{ from: start - from, to: end - from }] : [];
  });
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}
