export type LineSeparator = "\n" | "\r\n";

export interface ExactTextContent {
  text: string;
  separators: LineSeparator[];
  dominantSeparator: LineSeparator;
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export function decodeExactText(content: string): ExactTextContent {
  const separators: LineSeparator[] = [];
  let text = "";
  let cursor = 0;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\r" && content[index + 1] === "\n") {
      text += `${content.slice(cursor, index)}\n`;
      separators.push("\r\n");
      index += 1;
      cursor = index + 1;
    } else if (character === "\n") {
      text += `${content.slice(cursor, index)}\n`;
      separators.push("\n");
      cursor = index + 1;
    }
  }
  text += content.slice(cursor);
  return {
    text,
    separators,
    dominantSeparator: dominantSeparator(separators),
  };
}

export function encodeExactText(content: ExactTextContent): string {
  let output = "";
  let separatorIndex = 0;
  let cursor = 0;
  for (let index = 0; index < content.text.length; index += 1) {
    if (content.text[index] !== "\n") continue;
    output += content.text.slice(cursor, index);
    output += content.separators[separatorIndex] ?? content.dominantSeparator;
    separatorIndex += 1;
    cursor = index + 1;
  }
  return output + content.text.slice(cursor);
}

export function applyExactTextChanges(
  content: ExactTextContent,
  changes: readonly TextChange[],
): ExactTextContent {
  let exact = encodeExactText(content);
  const ordered = [...changes].sort((left, right) => right.from - left.from);
  for (const change of ordered) {
    if (
      change.from < 0 ||
      change.to < change.from ||
      change.to > content.text.length
    ) {
      throw new RangeError("Text changes must address the current normalized document.");
    }
    const from = exactOffset(content, change.from);
    const to = exactOffset(content, change.to);
    const inserted = decodeExactText(change.insert).text.replaceAll(
      "\n",
      content.dominantSeparator,
    );
    exact = `${exact.slice(0, from)}${inserted}${exact.slice(to)}`;
  }
  return decodeExactText(exact);
}

function exactOffset(content: ExactTextContent, normalizedOffset: number): number {
  let exact = 0;
  let separatorIndex = 0;
  for (let index = 0; index < normalizedOffset; index += 1) {
    if (content.text[index] === "\n") {
      exact += (content.separators[separatorIndex] ?? content.dominantSeparator).length;
      separatorIndex += 1;
    } else {
      exact += 1;
    }
  }
  return exact;
}

function dominantSeparator(separators: LineSeparator[]): LineSeparator {
  let lf = 0;
  let crlf = 0;
  for (const separator of separators) {
    if (separator === "\r\n") crlf += 1;
    else lf += 1;
  }
  if (crlf === lf) return separators[0] ?? "\n";
  return crlf > lf ? "\r\n" : "\n";
}
