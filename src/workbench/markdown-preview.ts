import type { LanguageSupport } from "@codemirror/language";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { editorLanguageDescriptionByName } from "../editor-language.ts";

export const MARKDOWN_PREVIEW_MAX_BYTES = 512 * 1024;
export const MARKDOWN_HIGHLIGHT_MAX_LANGUAGES = 8;
export const MARKDOWN_HIGHLIGHT_MAX_CODE_UNITS = 256 * 1024;

export interface MarkdownPreviewResult {
  status: "ready" | "too-large";
  html: string;
  byteLength: number;
}

interface MarkdownToken {
  content: string;
  attrGet(name: string): string | null;
}

interface MarkdownRenderer {
  rules: Record<
    string,
    ((tokens: MarkdownToken[], index: number) => string) | undefined
  >;
}

interface MarkdownParser {
  renderer: MarkdownRenderer;
  render(source: string): string;
}

type MarkdownParserConstructor = new (options: {
  html: boolean;
  linkify: boolean;
  typographer: boolean;
  highlight(source: string, language: string): string;
}) => MarkdownParser;

let parserConstructorPromise: Promise<MarkdownParserConstructor> | null = null;
const MARKDOWN_LANGUAGE_CACHE_LIMIT = 24;

interface AsyncCacheEntry<T> {
  promise: Promise<T | null>;
  settled: boolean;
}

export class BoundedAsyncCache<T> {
  private readonly entries = new Map<string, AsyncCacheEntry<T>>();
  private readonly limit: number;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("cache limit must be positive");
    this.limit = limit;
  }

  load(key: string, loader: () => Promise<T | null>): Promise<T | null> {
    const cached = this.entries.get(key);
    if (cached) return cached.promise;
    if (this.entries.size >= this.limit) {
      const settled = [...this.entries].find(([, entry]) => entry.settled)?.[0];
      if (!settled) return Promise.resolve(null);
      this.entries.delete(settled);
    }
    const entry: AsyncCacheEntry<T> = {
      promise: Promise.resolve(null),
      settled: false,
    };
    entry.promise = Promise.resolve()
      .then(loader)
      .catch(() => null)
      .then((value) => {
        entry.settled = true;
        return value;
      });
    this.entries.set(key, entry);
    return entry.promise;
  }

  get size(): number {
    return this.entries.size;
  }

  get pending(): number {
    return [...this.entries.values()].filter((entry) => !entry.settled).length;
  }
}

const languageSupportCache = new BoundedAsyncCache<LanguageSupport>(
  MARKDOWN_LANGUAGE_CACHE_LIMIT,
);

const markdownCodeHighlighter = tagHighlighter([
  { tag: tags.comment, class: "md-code-comment" },
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
    ],
    class: "md-code-keyword",
  },
  {
    tag: [tags.string, tags.character, tags.attributeValue],
    class: "md-code-string",
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    class: "md-code-literal",
  },
  {
    tag: [
      tags.typeName,
      tags.className,
      tags.namespace,
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.variableName),
    ],
    class: "md-code-type",
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    class: "md-code-property",
  },
  { tag: [tags.tagName, tags.labelName], class: "md-code-tag" },
  { tag: [tags.operator, tags.punctuation], class: "md-code-punctuation" },
  { tag: [tags.regexp, tags.escape, tags.url, tags.link], class: "md-code-link" },
  {
    tag: [tags.meta, tags.processingInstruction, tags.annotation],
    class: "md-code-meta",
  },
  { tag: tags.invalid, class: "md-code-invalid" },
]);

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown|mdown|mkd)$/iu.test(path);
}

export async function renderMarkdownPreview(
  source: string,
): Promise<MarkdownPreviewResult> {
  const byteLength = new TextEncoder().encode(source).byteLength;
  if (byteLength > MARKDOWN_PREVIEW_MAX_BYTES) {
    return { status: "too-large", html: "", byteLength };
  }
  const parser = await markdownParser(source);
  return { status: "ready", html: parser.render(source), byteLength };
}

async function markdownParser(source: string): Promise<MarkdownParser> {
  parserConstructorPromise ??= import("markdown-it").then(
    (module) => module.default as unknown as MarkdownParserConstructor,
  );
  const MarkdownIt = await parserConstructorPromise;
  const languages = await loadFenceLanguages(source);
  let remainingHighlightUnits = MARKDOWN_HIGHLIGHT_MAX_CODE_UNITS;
  const parser = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    highlight: (code, language) => {
      const normalized = normalizeFenceLanguage(language);
      const support = normalized ? languages.get(normalized) : null;
      if (!support || code.length > remainingHighlightUnits) return escapeHtml(code);
      remainingHighlightUnits -= code.length;
      return highlightCode(code, support);
    },
  });
  parser.renderer.rules.image = (tokens, index) => {
    const label = tokens[index]?.content.trim() || "image";
    return `<span class="markdown-image-placeholder" role="img" aria-label="Image preview blocked">[Image: ${escapeHtml(label)}]</span>`;
  };
  parser.renderer.rules.link_open = (tokens, index) => {
    const href = tokens[index]?.attrGet("href") ?? "";
    return `<span class="markdown-link" title="Link opening is not available in preview" data-markdown-href="${escapeAttribute(href)}">`;
  };
  parser.renderer.rules.link_close = () => "</span>";
  return parser;
}

async function loadFenceLanguages(source: string): Promise<Map<string, LanguageSupport>> {
  const names = new Set<string>();
  const fence = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\s`~]+)?[^\n]*$/gmu;
  for (const match of source.matchAll(fence)) {
    const normalized = normalizeFenceLanguage(match[1] ?? "");
    if (normalized) names.add(normalized);
    if (names.size >= MARKDOWN_HIGHLIGHT_MAX_LANGUAGES) break;
  }
  const loaded = await Promise.all(
    [...names].map(async (name) => [name, await loadLanguageSupport(name)] as const),
  );
  return new Map(
    loaded.flatMap(([name, support]) => support ? [[name, support] as const] : []),
  );
}

function loadLanguageSupport(name: string): Promise<LanguageSupport | null> {
  return languageSupportCache.load(name, () =>
    editorLanguageDescriptionByName(name).then(
      (description) => description?.load() ?? null,
    ),
  );
}

function normalizeFenceLanguage(language: string): string | null {
  const value = language.trim().split(/\s/u, 1)[0]?.toLowerCase() ?? "";
  return /^[a-z0-9_+.#-]{1,40}$/u.test(value) ? value : null;
}

function highlightCode(code: string, support: LanguageSupport): string {
  const tree = support.language.parser.parse(code);
  let cursor = 0;
  let html = "";
  highlightTree(tree, markdownCodeHighlighter, (from, to, classes) => {
    html += escapeHtml(code.slice(cursor, from));
    html += `<span class="${classes}">${escapeHtml(code.slice(from, to))}</span>`;
    cursor = to;
  });
  return html + escapeHtml(code.slice(cursor));
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>]/gu,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!,
  );
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/gu, "&quot;");
}
