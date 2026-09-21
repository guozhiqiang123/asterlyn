import type { WorkspaceTextSearchOptions } from "../../models";

export type DemoSearchPreview = {
  text: string;
  from: number;
  to: number;
  leadingClipped: boolean;
  trailingClipped: boolean;
};

export function demoPatternRanges(
  text: string,
  query: string,
  options: WorkspaceTextSearchOptions,
): Array<[number, number]> {
  const source = options.mode === "regex"
    ? query
    : query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const ranges = demoRegexRanges(demoCompileRegex(source, options), text);
  return options.wholeWord
    ? ranges.filter(([from, to]) => demoWholeWordMatch(text, from, to))
    : ranges;
}

export function demoDecodeSearchEscapes(query: string): string {
  return query.replace(/\\([nrt\\])/gu, (_match, escape: string) =>
    escape === "n" ? "\n" : escape === "r" ? "\r" : escape === "t" ? "\t" : "\\"
  );
}

export function demoDocumentSearchPreview(
  text: string,
  from: number,
  to: number,
): DemoSearchPreview {
  const matched = text.slice(from, to);
  if (matched.length >= 320) {
    const visible = safePrefixUtf16(matched, 320);
    return {
      text: visible,
      from: 0,
      to: visible.length,
      leadingClipped: from > 0,
      trailingClipped: true,
    };
  }
  const context = 320 - matched.length;
  const before = safeSuffixUtf16(text.slice(0, from), Math.floor(context / 2));
  const after = safePrefixUtf16(text.slice(to), context - before.length);
  return {
    text: `${before}${matched}${after}`,
    from: before.length,
    to: before.length + matched.length,
    leadingClipped: before.length < from,
    trailingClipped: after.length < text.length - to,
  };
}

export function demoSearchPreview(
  lines: string[],
  lineIndex: number,
  fromInLine: number,
  toInLine: number,
  contextLines: number,
): DemoSearchPreview {
  const firstLine = Math.max(0, lineIndex - contextLines);
  const lastLine = Math.min(lines.length - 1, lineIndex + contextLines);
  const beforeMatch = lines
    .slice(firstLine, lineIndex)
    .reduce((length, line) => length + line.length + 1, 0);
  const window = lines.slice(firstLine, lastLine + 1).join("\n");
  const from = beforeMatch + fromInLine;
  const to = beforeMatch + toInLine;
  const matched = window.slice(from, to);
  if (matched.length > 320) {
    const visible = safePrefixUtf16(matched, 320);
    return {
      text: visible,
      from: 0,
      to: visible.length,
      leadingClipped: from > 0,
      trailingClipped: true,
    };
  }
  const context = 320 - matched.length;
  const before = safeSuffixUtf16(window.slice(0, from), Math.floor(context / 2));
  const after = safePrefixUtf16(window.slice(to), context - before.length);
  return {
    text: `${before}${matched}${after}`,
    from: before.length,
    to: before.length + matched.length,
    leadingClipped: before.length < from,
    trailingClipped: after.length < window.length - to,
  };
}

export function safePrefixUtf16(value: string, limit: number): string {
  let end = Math.min(value.length, limit);
  if (end > 0 && end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}

function safeSuffixUtf16(value: string, limit: number): string {
  let start = Math.max(0, value.length - limit);
  if (start > 0 && start < value.length && /[\uDC00-\uDFFF]/u.test(value[start]!)) start += 1;
  return value.slice(start);
}

function demoCompileRegex(
  query: string,
  options: Pick<WorkspaceTextSearchOptions, "caseSensitive" | "newLine">,
): RegExp {
  let source = query;
  let flags = "gu";
  if (source.startsWith("(?i)")) {
    source = source.slice(4);
    flags += "i";
  }
  if (!options.caseSensitive && !flags.includes("i")) flags += "i";
  if (options.newLine) flags += "s";
  try {
    return new RegExp(source, flags);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw {
      kind: "invalidSearch",
      message: detail.toLocaleLowerCase().startsWith("invalid regular expression")
        ? detail
        : `Invalid regular expression: ${detail}`,
    };
  }
}

function demoWholeWordMatch(text: string, from: number, to: number): boolean {
  const word = (value: string | undefined) => Boolean(value && /[\p{L}\p{N}_]/u.test(value));
  const matched = text.slice(from, to);
  return (!word(matched[0]) || !word(text[from - 1])) &&
    (!word(matched.at(-1)) || !word(text[to]));
}

function demoRegexRanges(expression: RegExp, line: string): Array<[number, number]> {
  expression.lastIndex = 0;
  const ranges: Array<[number, number]> = [];
  let found: RegExpExecArray | null;
  while ((found = expression.exec(line)) !== null) {
    ranges.push([found.index, found.index + found[0].length]);
    if (found[0].length === 0) expression.lastIndex = nextUnicodeOffset(line, expression.lastIndex);
  }
  return ranges;
}

function nextUnicodeOffset(value: string, offset: number): number {
  if (offset >= value.length) return value.length + 1;
  const code = value.codePointAt(offset);
  return offset + (code !== undefined && code > 0xffff ? 2 : 1);
}
